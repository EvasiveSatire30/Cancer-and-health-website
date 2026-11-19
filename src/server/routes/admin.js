import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

export function initAdminRoutes(app, db, authMiddleware) {
    const adminOnly = [authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin')];

    // ---- Aggregate analytics ----
    app.get('/api/admin/analytics', ...adminOnly, (req, res, next) => {
        try {
            const count = (sql, ...p) => db.prepare(sql).get(...p).count;
            const byStatus = db.prepare(`
                SELECT status, COUNT(*) AS count FROM appointments GROUP BY status
            `).all();
            const byProvince = db.prepare(`
                SELECT province, COUNT(*) AS count FROM facilities GROUP BY province ORDER BY count DESC
            `).all();

            return res.json({
                totalPatients: count("SELECT COUNT(*) AS count FROM users WHERE role = 'patient'"),
                totalDoctors: count('SELECT COUNT(*) AS count FROM doctors'),
                verifiedDoctors: count('SELECT COUNT(*) AS count FROM doctors WHERE verified = 1'),
                totalFacilities: count('SELECT COUNT(*) AS count FROM facilities'),
                totalArticles: count('SELECT COUNT(*) AS count FROM articles'),
                publishedArticles: count("SELECT COUNT(*) AS count FROM articles WHERE publication_status = 'published'"),
                pendingReviewArticles: count("SELECT COUNT(*) AS count FROM articles WHERE publication_status = 'pending_review'"),
                totalScreeningCampaigns: count('SELECT COUNT(*) AS count FROM screening_campaigns'),
                activeScreeningCampaigns: count("SELECT COUNT(*) AS count FROM screening_campaigns WHERE date_end >= date('now')"),
                totalAppointments: count('SELECT COUNT(*) AS count FROM appointments'),
                requestedAppointments: count("SELECT COUNT(*) AS count FROM appointments WHERE status = 'requested'"),
                confirmedAppointments: count("SELECT COUNT(*) AS count FROM appointments WHERE status = 'confirmed'"),
                unreadNotifications: count('SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0'),
                appointmentsByStatus: byStatus,
                facilitiesByProvince: byProvince,
            });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Users ----
    app.get('/api/admin/users', ...adminOnly, (req, res, next) => {
        try {
            const { role, search, page = '1', pageSize = '25' } = req.query;
            const limit = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
            const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

            let where = ' WHERE 1 = 1';
            const params = [];
            if (role) { where += ' AND role = ?'; params.push(role); }
            if (search) { where += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

            const total = db.prepare(`SELECT COUNT(*) AS count FROM users${where}`).get(...params).count;
            const rows = db.prepare(`
                SELECT id, email, name, role, created_at, is_verified, phone_number
                FROM users${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
            `).all(...params, limit, offset);

            return res.json({ data: rows, total, page: Number(page), pageSize: limit });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Appointments overview ----
    app.get('/api/admin/appointments', ...adminOnly, (req, res, next) => {
        try {
            const { status, page = '1', pageSize = '25' } = req.query;
            const limit = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
            const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

            let where = ' WHERE 1 = 1';
            const params = [];
            if (status) { where += ' AND a.status = ?'; params.push(status); }

            const total = db.prepare(`SELECT COUNT(*) AS count FROM appointments a${where}`).get(...params).count;
            const rows = db.prepare(`
                SELECT a.id, a.date, a.status, a.created_at,
                       p.name AS patient_name, p.email AS patient_email,
                       du.name AS doctor_name, d.specialty,
                       f.name AS facility_name
                FROM appointments a
                JOIN users p ON a.patient_id = p.id
                JOIN doctors d ON a.doctor_id = d.id
                JOIN users du ON d.user_id = du.id
                JOIN facilities f ON a.facility_id = f.id
                ${where}
                ORDER BY a.date DESC LIMIT ? OFFSET ?
            `).all(...params, limit, offset);

            return res.json({ data: rows, total, page: Number(page), pageSize: limit });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Audit logs ----
    app.get('/api/admin/audit-logs', ...adminOnly, (req, res, next) => {
        try {
            const { action, entity, limit: rawLimit = '100' } = req.query;
            const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 100, 1), 500);

            let where = ' WHERE 1 = 1';
            const params = [];
            if (action) { where += ' AND action = ?'; params.push(action); }
            if (entity) { where += ' AND entity = ?'; params.push(entity); }
            params.push(limit);

            return res.json(db.prepare(`
                SELECT al.id, al.user_id, al.action, al.entity, al.entity_id, al.details,
                       al.ip_address, al.created_at, u.name AS user_name, u.email AS user_email
                FROM audit_logs al
                LEFT JOIN users u ON al.user_id = u.id
                ${where}
                ORDER BY al.created_at DESC LIMIT ?
            `).all(...params));
        } catch (err) {
            return next(err);
        }
    });

    // ---- Doctor verification ----
    app.put('/api/admin/doctors/:id/verify', ...adminOnly, (req, res, next) => {
        try {
            const info = db.prepare(`
                UPDATE doctors SET verified = 1, verification_date = CURRENT_TIMESTAMP, verified_by = ?
                WHERE id = ?
            `).run(req.user.email, req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Doctor not found' });
            createAuditLog(db, req.user, 'admin_verify_doctor', 'doctor', Number(req.params.id), {}, req.ip);
            return res.json({ message: 'Doctor verified' });
        } catch (err) {
            return next(err);
        }
    });

    app.put('/api/admin/doctors/:id/unverify', ...adminOnly, (req, res, next) => {
        try {
            const info = db.prepare('UPDATE doctors SET verified = 0, verification_date = NULL WHERE id = ?')
                .run(req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Doctor not found' });
            createAuditLog(db, req.user, 'admin_unverify_doctor', 'doctor', Number(req.params.id), {}, req.ip);
            return res.json({ message: 'Doctor unverified' });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Articles (all statuses) ----
    app.get('/api/admin/articles', ...adminOnly, (req, res, next) => {
        try {
            const { status, category, search } = req.query;
            let where = ' WHERE 1 = 1';
            const params = [];
            if (status) { where += ' AND publication_status = ?'; params.push(status); }
            if (category) { where += ' AND category = ?'; params.push(category); }
            if (search) { where += ' AND (title LIKE ? OR summary LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

            return res.json(db.prepare(`
                SELECT id, title, category, summary, medical_reviewed, medical_reviewer_id,
                       last_reviewed, publication_status, source_refs, created_at, updated_at
                FROM articles ${where} ORDER BY created_at DESC
            `).all(...params));
        } catch (err) {
            return next(err);
        }
    });

    app.put('/api/admin/articles/:id/review', ...adminOnly, validate(z.object({
        approved: z.boolean(),
        notes: z.string().max(2000).optional().default(''),
    })), (req, res, next) => {
        try {
            const status = req.body.approved ? 'published' : 'rejected';
            const info = db.prepare(`
                UPDATE articles SET medical_reviewed = ?, publication_status = ?,
                    medical_reviewer_id = ?, last_reviewed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(req.body.approved ? 1 : 0, status, req.user.id, req.params.id);

            if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Article not found' });
            createAuditLog(db, req.user, 'admin_review_article', 'article', Number(req.params.id),
                { approved: req.body.approved, notes: req.body.notes }, req.ip);
            return res.json({ message: 'Article review updated', status });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Screening campaigns (all, including expired) ----
    app.get('/api/admin/screening', ...adminOnly, (req, res, next) => {
        try {
            return res.json(db.prepare('SELECT * FROM screening_campaigns ORDER BY date_end DESC').all());
        } catch (err) {
            return next(err);
        }
    });

    app.put('/api/admin/screening/:id', ...adminOnly, validate(z.object({
        is_active: z.boolean().optional(),
        date_end: z.string().max(40).optional(),
    })), (req, res, next) => {
        try {
            if (req.body.date_end) {
                db.prepare('UPDATE screening_campaigns SET date_end = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    .run(req.body.date_end, req.params.id);
            }
            if (req.body.is_active === false) {
                // Expire immediately: move end date to yesterday.
                db.prepare("UPDATE screening_campaigns SET date_end = date('now', '-1 day'), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .run(req.params.id);
            }
            createAuditLog(db, req.user, 'admin_update_screening', 'screening_campaign', Number(req.params.id), req.body, req.ip);
            return res.json({ message: 'Screening campaign updated' });
        } catch (err) {
            return next(err);
        }
    });
}
