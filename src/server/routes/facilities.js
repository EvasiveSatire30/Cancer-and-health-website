import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

const FACILITY_TYPES = ['public_hospital', 'private_hospital', 'cancer_center', 'screening_clinic', 'surgical_facility', 'radiotherapy_center', 'general_clinic'];
const FACILITY_STATUS = ['operational', 'reported_unavailable', 'under_maintenance', 'status_unknown'];

export function initFacilityRoutes(app, db, validateFn, authMiddleware) {
    const validate = validateFn || validate;

    app.get('/api/facilities', (req, res, next) => {
        try {
            const { province, city, type, classification, service, search } = req.query;
            let query = `
                SELECT DISTINCT f.id, f.name, f.address, f.province, f.city, f.phone, f.email,
                       f.website, f.type, f.classification, f.referral_required,
                       f.operating_hours, f.last_verified, f.status
                FROM facilities f
                WHERE f.is_demo = 0
                  AND f.publication_status = 'published'
                  AND f.verification_status IN ('source_confirmed', 'directly_verified')
            `;
            const params = [];

            if (province) { query += ' AND f.province = ?'; params.push(province); }
            if (city) { query += ' AND f.city = ?'; params.push(city); }
            if (type) { query += ' AND f.type = ?'; params.push(type); }
            if (classification) { query += ' AND f.classification = ?'; params.push(classification); }
            if (service) {
                query += ' AND EXISTS (SELECT 1 FROM service_claims fs WHERE fs.facility_id = f.id AND fs.service_type = ? AND fs.verification_method IN (\'source_confirmed\',\'directly_verified\'))';
                params.push(service);
            }
            if (search) {
                query += ' AND (f.name LIKE ? OR f.address LIKE ? OR f.city LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            query += ' ORDER BY f.province ASC, f.name ASC';
            return res.json(db.prepare(query).all(...params));
        } catch (err) {
            return next(err);
        }
    });

    app.get('/api/facilities/:id', (req, res, next) => {
        try {
            const facility = db.prepare(`
                SELECT * FROM facilities
                WHERE id = ? AND is_demo = 0 AND publication_status = 'published'
                  AND verification_status IN ('source_confirmed', 'directly_verified')
            `).get(req.params.id);
            if (!facility) return res.status(404).json({ error: 'NOT_FOUND', message: 'Verified facility not found' });
            const services = db.prepare(`
                SELECT sc.*, sr.organisation, sr.source_url
                FROM service_claims sc LEFT JOIN source_registry sr ON sc.evidence_id = sr.id
                WHERE sc.facility_id = ? AND sc.verification_method IN ('source_confirmed','directly_verified')
            `).all(facility.id);
            return res.json({ facility, services });
        } catch (err) {
            return next(err);
        }
    });

    app.post('/api/facilities', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(z.object({
            name: z.string().min(2).max(200),
            address: z.string().min(2).max(300),
            province: z.string().min(2).max(80),
            city: z.string().min(2).max(120),
            type: z.enum(FACILITY_TYPES),
            classification: z.enum(['public', 'private']).default('public'),
            referral_required: z.boolean().default(true),
            operating_hours: z.string().max(300).optional(),
            phone: z.string().max(40).optional(),
            email: z.string().email().max(200).optional(),
            website: z.string().url().max(300).optional(),
        })), (req, res, next) => {
            try {
                const b = req.body;
                const info = db.prepare(`
                    INSERT INTO facilities (name, address, province, city, type, classification,
                        referral_required, operating_hours, phone, email, website, status, last_verified)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'status_unknown', CURRENT_TIMESTAMP)
                `).run(b.name, b.address, b.province, b.city, b.type, b.classification,
                    b.referral_required ? 1 : 0, b.operating_hours || null, b.phone || null,
                    b.email || null, b.website || null);

                createAuditLog(db, req.user, 'create_facility', 'facility', Number(info.lastInsertRowid), {}, req.ip);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Facility created' });
            } catch (err) {
                return next(err);
            }
        });

    app.post('/api/facilities/:id/services', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(z.object({
            service_type: z.enum(['screening', 'diagnostic', 'surgery', 'chemotherapy', 'radiotherapy', 'palliative_care', 'consultation']),
            available: z.boolean().default(true),
            description: z.string().max(500).optional(),
        })), (req, res, next) => {
            try {
                db.prepare(`
                    INSERT INTO facility_services (facility_id, service_type, available, description)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(facility_id, service_type) DO UPDATE SET available = excluded.available, description = excluded.description
                `).run(req.params.id, req.body.service_type, req.body.available ? 1 : 0, req.body.description || null);
                createAuditLog(db, req.user, 'upsert_facility_service', 'facility', Number(req.params.id), { service: req.body.service_type }, req.ip);
                return res.json({ message: 'Service saved' });
            } catch (err) {
                return next(err);
            }
        });

    app.put('/api/facilities/:id', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(z.object({
            status: z.enum(FACILITY_STATUS).optional(),
            last_verified: z.string().max(40).optional(),
        })), (req, res, next) => {
            try {
                const updates = [];
                const params = [];
                for (const key of ['status', 'last_verified']) {
                    if (req.body[key] !== undefined) { updates.push(`${key} = ?`); params.push(req.body[key]); }
                }
                if (updates.length === 0) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No fields to update' });

                updates.push('updated_at = CURRENT_TIMESTAMP');
                params.push(req.params.id);
                const info = db.prepare(`UPDATE facilities SET ${updates.join(', ')} WHERE id = ?`).run(...params);
                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Facility not found' });

                createAuditLog(db, req.user, 'update_facility', 'facility', Number(req.params.id), { updates }, req.ip);
                return res.json({ message: 'Facility updated', changes: info.changes });
            } catch (err) {
                return next(err);
            }
        });
}
