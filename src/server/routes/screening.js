import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

export const ZIMBABWE_PROVINCES = [
    'Bulawayo', 'Harare', 'Manicaland', 'Mashonaland Central', 'Mashonaland East',
    'Mashonaland West', 'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands',
];

const campaignSchema = z.object({
    organization_name: z.string().min(2).max(200),
    service_type: z.enum(['breast_screening', 'cervical_screening', 'general_screening']),
    location: z.string().min(2).max(300),
    province: z.enum(ZIMBABWE_PROVINCES),
    city: z.string().min(1).max(120),
    date_start: z.string().min(8).max(40),
    date_end: z.string().min(8).max(40),
    is_free: z.boolean().default(true),
    eligibility_criteria: z.string().max(2000).optional().default(''),
    registration_instructions: z.string().max(2000).optional().default(''),
    contact_name: z.string().max(160).optional().default(''),
    contact_email: z.string().email().max(200),
    contact_phone: z.string().max(40).optional().default(''),
    registration_deadline: z.string().max(40).optional().nullable(),
});

export function initScreeningRoutes(app, db, validateFn, authMiddleware) {
    const validate = validateFn || validate;

    // Static routes MUST be registered before the /:id wildcard route.
    app.get('/api/screening/provinces', (_req, res) => res.json(ZIMBABWE_PROVINCES));

    // Public list of active (not yet ended) campaigns.
    app.get('/api/screening', (req, res, next) => {
        try {
            const { province, city, cancer_type, service_type, is_free, search } = req.query;
            let query = `
                SELECT id, organization_name, service_type, location, province, city,
                       date_start, date_end, is_free, eligibility_criteria,
                       registration_instructions, contact_name, contact_email,
                       contact_phone, registration_deadline, created_at, updated_at
                FROM screening_campaigns
                WHERE date_end >= date('now')
                  AND is_demo = 0
                  AND verification_status IN ('source_confirmed', 'directly_verified')
                  AND COALESCE(expiry_status, 'active') != 'expired'
                  AND evidence_id IS NOT NULL
            `;
            const params = [];

            if (province) { query += ' AND province = ?'; params.push(province); }
            if (city) { query += ' AND city = ?'; params.push(city); }
            if (cancer_type) { query += ' AND service_type LIKE ?'; params.push(`%${cancer_type}%`); }
            if (service_type) { query += ' AND service_type = ?'; params.push(service_type); }
            if (is_free === 'true' || is_free === 'false') {
                query += ' AND is_free = ?'; params.push(is_free === 'true' ? 1 : 0);
            }
            if (search) {
                query += ' AND (organization_name LIKE ? OR location LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }
            query += ' ORDER BY date_start ASC';

            return res.json(db.prepare(query).all(...params));
        } catch (err) {
            return next(err);
        }
    });

    // Admin listing (includes expired) - authenticated.
    app.get('/api/screening/all', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'), (req, res, next) => {
        try {
            return res.json(db.prepare('SELECT * FROM screening_campaigns ORDER BY date_end DESC').all());
        } catch (err) {
            return next(err);
        }
    });

    app.get('/api/screening/:id', (req, res, next) => {
        try {
            const campaign = db.prepare(`
                SELECT * FROM screening_campaigns
                WHERE id = ?
                  AND is_demo = 0
                  AND verification_status IN ('source_confirmed', 'directly_verified')
                  AND COALESCE(expiry_status, 'active') != 'expired'
                  AND date_end >= date('now')
            `).get(req.params.id);
            if (!campaign) return res.status(404).json({ error: 'NOT_FOUND', message: 'Campaign not found' });
            return res.json(campaign);
        } catch (err) {
            return next(err);
        }
    });

    app.post('/api/screening', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(campaignSchema), (req, res, next) => {
            try {
                const b = req.body;
                const info = db.prepare(`
                    INSERT INTO screening_campaigns (
                        organization_name, service_type, location, province, city,
                        date_start, date_end, is_free, eligibility_criteria,
                        registration_instructions, contact_name, contact_email,
                        contact_phone, registration_deadline
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    b.organization_name, b.service_type, b.location, b.province, b.city,
                    b.date_start, b.date_end, b.is_free ? 1 : 0, b.eligibility_criteria,
                    b.registration_instructions, b.contact_name, b.contact_email,
                    b.contact_phone, b.registration_deadline || null
                );

                createAuditLog(db, req.user, 'create_screening_campaign', 'screening_campaign', Number(info.lastInsertRowid), {}, req.ip);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Screening campaign created' });
            } catch (err) {
                return next(err);
            }
        });

    app.put('/api/screening/:id', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(campaignSchema), (req, res, next) => {
            try {
                const b = req.body;
                const info = db.prepare(`
                    UPDATE screening_campaigns SET
                        organization_name = ?, service_type = ?, location = ?, province = ?,
                        city = ?, date_start = ?, date_end = ?, is_free = ?,
                        eligibility_criteria = ?, registration_instructions = ?,
                        contact_name = ?, contact_email = ?, contact_phone = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(
                    b.organization_name, b.service_type, b.location, b.province, b.city,
                    b.date_start, b.date_end, b.is_free ? 1 : 0, b.eligibility_criteria,
                    b.registration_instructions, b.contact_name, b.contact_email,
                    b.contact_phone, req.params.id
                );

                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Campaign not found' });
                createAuditLog(db, req.user, 'update_screening_campaign', 'screening_campaign', Number(req.params.id), {}, req.ip);
                return res.json({ message: 'Campaign updated', changes: info.changes });
            } catch (err) {
                return next(err);
            }
        });

    app.delete('/api/screening/:id', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        (req, res, next) => {
            try {
                const info = db.prepare('DELETE FROM screening_campaigns WHERE id = ?').run(req.params.id);
                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Campaign not found' });
                createAuditLog(db, req.user, 'delete_screening_campaign', 'screening_campaign', Number(req.params.id), {}, req.ip);
                return res.json({ message: 'Campaign deleted', changes: info.changes });
            } catch (err) {
                return next(err);
            }
        });
}
