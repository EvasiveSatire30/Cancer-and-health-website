import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { hashPassword, verifyPassword, createAuditLog } from '../lib/crypto.js';

const PROFILE_FIELDS = ['name', 'phone_number', 'emergency_contact', 'consent_medical', 'consent_data', 'consent_notifications'];

export function initProfileRoutes(app, db, authMiddleware, validateFn) {
    const validate = validateFn || validate;

    app.get('/api/profile', authMiddleware.authenticate, (req, res, next) => {
        try {
            const user = db.prepare(`
                SELECT id, email, name, role, created_at, updated_at, phone_number,
                       emergency_contact, consent_medical, consent_data, consent_notifications
                FROM users WHERE id = ?
            `).get(req.user.id);
            return res.json({ user });
        } catch (err) {
            return next(err);
        }
    });

    app.put('/api/profile', authMiddleware.authenticate, validate(z.object({
        name: z.string().min(2).max(120).optional(),
        phone_number: z.string().max(40).optional(),
        emergency_contact: z.string().max(40).optional(),
        consent_medical: z.boolean().optional(),
        consent_data: z.boolean().optional(),
        consent_notifications: z.boolean().optional(),
    })), (req, res, next) => {
        try {
            const updates = [];
            const params = [];

            for (const field of PROFILE_FIELDS) {
                if (req.body[field] !== undefined) {
                    updates.push(`${field} = ?`); // field is from a fixed allow-list
                    params.push(typeof req.body[field] === 'boolean' ? (req.body[field] ? 1 : 0) : req.body[field]);
                }
            }
            if (updates.length === 0) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No fields to update' });

            updates.push('updated_at = CURRENT_TIMESTAMP');
            params.push(req.user.id);

            db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
            createAuditLog(db, req.user, 'update_profile', 'user', req.user.id,
                { fields: Object.keys(req.body) }, req.ip);
            return res.json({ message: 'Profile updated' });
        } catch (err) {
            return next(err);
        }
    });

    app.put('/api/profile/password', authMiddleware.authenticate, validate(z.object({
        current_password: z.string().min(1).max(200),
        new_password: z.string().min(8).max(200),
    })), (req, res, next) => {
        try {
            const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
            if (!verifyPassword(req.body.current_password, user.password_hash)) {
                return res.status(400).json({ error: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
            }

            const newHash = hashPassword(req.body.new_password);
            db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(newHash, req.user.id);
            createAuditLog(db, req.user, 'change_password', 'user', req.user.id, {}, req.ip);
            return res.json({ message: 'Password changed successfully' });
        } catch (err) {
            return next(err);
        }
    });

    app.get('/api/profile/export', authMiddleware.authenticate, (req, res, next) => {
        try {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
            delete user.password_hash;

            const appointments = db.prepare(`
                SELECT a.id, a.date, a.status, a.notes, d.specialty, f.name AS facility_name
                FROM appointments a
                JOIN doctors d ON a.doctor_id = d.id
                JOIN facilities f ON a.facility_id = f.id
                WHERE a.patient_id = ?
            `).all(req.user.id);

            const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ?').all(req.user.id);
            const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE user_id = ?').all(req.user.id);

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="cancercare-export.json"');
            return res.json({ exportedAt: new Date().toISOString(), user, appointments, notifications, auditLogs });
        } catch (err) {
            return next(err);
        }
    });

    app.delete('/api/profile', authMiddleware.authenticate, validate(z.object({
        password: z.string().min(1).max(200),
        confirmation: z.literal('DELETE'),
    })), (req, res, next) => {
        try {
            const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
            if (!verifyPassword(req.body.password, user.password_hash)) {
                return res.status(400).json({ error: 'INVALID_PASSWORD', message: 'Password is incorrect' });
            }

            // Audit first (audit_logs.user_id is nullable / SET NULL on delete).
            createAuditLog(db, req.user, 'delete_account', 'user', req.user.id, {}, req.ip);
            db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
            return res.json({ message: 'Account deleted successfully' });
        } catch (err) {
            return next(err);
        }
    });

    app.get('/api/profile/notifications', authMiddleware.authenticate, (req, res, next) => {
        try {
            return res.json(db.prepare(
                'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
            ).all(req.user.id));
        } catch (err) {
            return next(err);
        }
    });

    app.put('/api/profile/notifications/:id/read', authMiddleware.authenticate, (req, res, next) => {
        try {
            db.prepare('UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
                .run(req.params.id, req.user.id);
            return res.json({ message: 'Notification marked as read' });
        } catch (err) {
            return next(err);
        }
    });

    app.put('/api/profile/notifications/read-all', authMiddleware.authenticate, (req, res, next) => {
        try {
            db.prepare('UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE user_id = ?')
                .run(req.user.id);
            return res.json({ message: 'All notifications marked as read' });
        } catch (err) {
            return next(err);
        }
    });
}
