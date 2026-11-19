import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

const ASSISTANCE_TYPES = ['screening', 'diagnostic', 'surgery', 'radiotherapy', 'chemotherapy', 'transportation', 'support'];

const programSchema = z.object({
    organization_name: z.string().min(2).max(200),
    assistance_type: z.enum(ASSISTANCE_TYPES),
    eligibility_criteria: z.string().min(2).max(3000),
    application_process: z.string().min(2).max(3000),
    contact_info: z.string().min(2).max(1000),
    deadline: z.string().max(40).optional().nullable(),
});

export function initFinancialRoutes(app, db, validateFn, authMiddleware) {
    const validate = validateFn || validate;

    app.get('/api/financial-assistance', (req, res, next) => {
        try {
            const { assistance_type, search } = req.query;
            let query = `
                SELECT id, organization_name, assistance_type, eligibility_criteria,
                       application_process, contact_info, deadline, verification_date, created_at, updated_at
                FROM financial_assistance_programs
                WHERE is_demo = 0
                  AND verification_status IN ('source_confirmed', 'directly_verified')
                  AND evidence_id IS NOT NULL
            `;
            const params = [];

            if (assistance_type) { query += ' AND assistance_type = ?'; params.push(assistance_type); }
            if (search) {
                query += ' AND (organization_name LIKE ? OR eligibility_criteria LIKE ? OR application_process LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            query += ' ORDER BY organization_name ASC';

            return res.json(db.prepare(query).all(...params));
        } catch (err) {
            return next(err);
        }
    });

    app.get('/api/financial-assistance/:id', (req, res, next) => {
        try {
            const program = db.prepare(`
                SELECT * FROM financial_assistance_programs
                WHERE id = ?
                  AND is_demo = 0
                  AND verification_status IN ('source_confirmed', 'directly_verified')
                  AND evidence_id IS NOT NULL
            `).get(req.params.id);
            if (!program) return res.status(404).json({ error: 'NOT_FOUND', message: 'Programme not found' });
            return res.json(program);
        } catch (err) {
            return next(err);
        }
    });

    app.post('/api/financial-assistance', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(programSchema), (req, res, next) => {
            try {
                const b = req.body;
                const info = db.prepare(`
                    INSERT INTO financial_assistance_programs
                        (organization_name, assistance_type, eligibility_criteria, application_process, contact_info, deadline, verification_date)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `).run(b.organization_name, b.assistance_type, b.eligibility_criteria, b.application_process,
                    b.contact_info, b.deadline || null);

                createAuditLog(db, req.user, 'create_financial_assistance', 'financial_assistance_program',
                    Number(info.lastInsertRowid), {}, req.ip);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Financial assistance programme added' });
            } catch (err) {
                return next(err);
            }
        });

    app.put('/api/financial-assistance/:id', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(programSchema), (req, res, next) => {
            try {
                const b = req.body;
                const info = db.prepare(`
                    UPDATE financial_assistance_programs SET
                        organization_name = ?, assistance_type = ?, eligibility_criteria = ?,
                        application_process = ?, contact_info = ?, deadline = ?,
                        verification_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(b.organization_name, b.assistance_type, b.eligibility_criteria, b.application_process,
                    b.contact_info, b.deadline || null, req.params.id);

                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Programme not found' });
                createAuditLog(db, req.user, 'update_financial_assistance', 'financial_assistance_program',
                    Number(req.params.id), {}, req.ip);
                return res.json({ message: 'Programme updated', changes: info.changes });
            } catch (err) {
                return next(err);
            }
        });

    app.delete('/api/financial-assistance/:id', authMiddleware.authenticate, authMiddleware.requireRole('super_admin'),
        (req, res, next) => {
            try {
                const info = db.prepare('DELETE FROM financial_assistance_programs WHERE id = ?').run(req.params.id);
                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Programme not found' });
                createAuditLog(db, req.user, 'delete_financial_assistance', 'financial_assistance_program',
                    Number(req.params.id), {}, req.ip);
                return res.json({ message: 'Programme deleted' });
            } catch (err) {
                return next(err);
            }
        });
}
