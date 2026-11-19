import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

const EQUIPMENT_STATUS = ['operational', 'reported_unavailable', 'under_maintenance', 'status_unknown'];

export function initRadiotherapyRoutes(app, db, validateFn, authMiddleware) {
    const validate = validateFn || validate;

    app.get('/api/radiotherapy', (req, res, next) => {
        try {
            const { province, city, status, equipment_type } = req.query;
            let query = `
                SELECT e.id, e.facility_id, e.equipment_type, e.model, e.manufacturer,
                       e.operational_status, e.last_confirmed, e.information_source,
                       f.name AS facility_name, f.province, f.city, f.address, f.phone, f.email
                FROM radiotherapy_equipment e
                JOIN facilities f ON e.facility_id = f.id
                WHERE f.is_demo = 0 AND f.publication_status = 'published'
            `;
            const params = [];

            if (province) { query += ' AND f.province = ?'; params.push(province); }
            if (city) { query += ' AND f.city = ?'; params.push(city); }
            if (status) { query += ' AND e.operational_status = ?'; params.push(status); }
            if (equipment_type) { query += ' AND e.equipment_type LIKE ?'; params.push(`%${equipment_type}%`); }

            query += ' ORDER BY f.name, e.equipment_type';
            return res.json(db.prepare(query).all(...params));
        } catch (err) {
            return next(err);
        }
    });

    app.get('/api/radiotherapy/statuses', (_req, res) => {
        res.json([
            { value: 'operational', label: 'Operational — recently verified', tone: 'green' },
            { value: 'reported_unavailable', label: 'Reported unavailable', tone: 'pink' },
            { value: 'under_maintenance', label: 'Under maintenance', tone: 'gold' },
            { value: 'status_unknown', label: 'Status unknown', tone: 'gray' },
        ]);
    });

    app.get('/api/radiotherapy/:id', (req, res, next) => {
        try {
            const equipment = db.prepare(`
                SELECT e.*, f.name AS facility_name, f.province, f.city, f.address, f.phone, f.email
                FROM radiotherapy_equipment e
                JOIN facilities f ON e.facility_id = f.id
                WHERE e.id = ?
            `).get(req.params.id);
            if (!equipment) return res.status(404).json({ error: 'NOT_FOUND', message: 'Equipment not found' });
            return res.json(equipment);
        } catch (err) {
            return next(err);
        }
    });

    app.post('/api/radiotherapy', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(z.object({
            facility_id: z.number().int().positive(),
            equipment_type: z.string().min(2).max(120),
            model: z.string().max(120).optional(),
            manufacturer: z.string().max(120).optional(),
            operational_status: z.enum(EQUIPMENT_STATUS).default('status_unknown'),
            information_source: z.string().max(200).optional(),
        })), (req, res, next) => {
            try {
                const b = req.body;
                const facility = db.prepare('SELECT id FROM facilities WHERE id = ?').get(b.facility_id);
                if (!facility) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Facility not found' });

                const info = db.prepare(`
                    INSERT INTO radiotherapy_equipment
                        (facility_id, equipment_type, model, manufacturer, operational_status, last_confirmed, information_source)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                `).run(b.facility_id, b.equipment_type, b.model || null, b.manufacturer || null,
                    b.operational_status, b.information_source || 'manual_entry');

                createAuditLog(db, req.user, 'create_radiotherapy_equipment', 'equipment', Number(info.lastInsertRowid), {}, req.ip);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Equipment entry added' });
            } catch (err) {
                return next(err);
            }
        });

    app.put('/api/radiotherapy/:id/status', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(z.object({
            operational_status: z.enum(EQUIPMENT_STATUS),
            source: z.string().max(200).optional(),
        })), (req, res, next) => {
            try {
                const info = db.prepare(`
                    UPDATE radiotherapy_equipment
                    SET operational_status = ?, last_confirmed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(req.body.operational_status, req.params.id);

                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Equipment not found' });

                db.prepare(`
                    INSERT INTO equipment_status_updates (equipment_id, status, source, verified)
                    VALUES (?, ?, ?, 0)
                `).run(req.params.id, req.body.operational_status, req.body.source || 'admin_update');

                createAuditLog(db, req.user, 'update_equipment_status', 'equipment', Number(req.params.id),
                    { operational_status: req.body.operational_status }, req.ip);
                return res.json({ message: 'Equipment status updated' });
            } catch (err) {
                return next(err);
            }
        });

    app.get('/api/radiotherapy/:id/history', (req, res, next) => {
        try {
            return res.json(db.prepare(
                'SELECT * FROM equipment_status_updates WHERE equipment_id = ? ORDER BY updated_at DESC'
            ).all(req.params.id));
        } catch (err) {
            return next(err);
        }
    });
}
