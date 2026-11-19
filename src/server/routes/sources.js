import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

export function initSourceRoutes(app, db, authMiddleware) {
    const adminOnly = [authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin')];

    // ---- Source Registry CRUD ----
    app.get('/api/admin/sources', ...adminOnly, (req, res, next) => {
        try {
            const { source_type, authority_level } = req.query;
            let where = ' WHERE 1 = 1';
            const params = [];
            if (source_type) { where += ' AND source_type = ?'; params.push(source_type); }
            if (authority_level) { where += ' AND authority_level = ?'; params.push(authority_level); }
            return res.json(db.prepare(`SELECT * FROM source_registry${where} ORDER BY retrieved_at DESC`).all(...params));
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/sources', ...adminOnly, validate(z.object({
        organisation: z.string().min(2).max(200),
        source_url: z.string().url().max(500),
        source_type: z.enum(['government', 'municipal', 'ngo', 'private', 'academic', 'news', 'directory', 'manual']),
        authority_level: z.enum(['official', 'authoritative', 'community', 'unverified']),
        licence: z.string().max(200).optional(),
        publication_date: z.string().max(20).optional(),
        notes: z.string().max(2000).optional(),
    })), (req, res, next) => {
        try {
            const b = req.body;
            const info = db.prepare(`
                INSERT INTO source_registry (organisation, source_url, source_type, authority_level, licence, publication_date, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(b.organisation, b.source_url, b.source_type, b.authority_level, b.licence || null, b.publication_date || null, b.notes || null);
            createAuditLog(db, req.user, 'create_source', 'source_registry', Number(info.lastInsertRowid), {}, req.ip);
            return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Source registered' });
        } catch (err) { return next(err); }
    });

    // ---- Service Claims CRUD ----
    app.get('/api/admin/service-claims', ...adminOnly, (req, res, next) => {
        try {
            const { facility_id, service_type } = req.query;
            let where = ' WHERE 1 = 1';
            const params = [];
            if (facility_id) { where += ' AND sc.facility_id = ?'; params.push(facility_id); }
            if (service_type) { where += ' AND sc.service_type = ?'; params.push(service_type); }
            return res.json(db.prepare(`
                SELECT sc.*, f.name AS facility_name, sr.organisation AS source_org, sr.source_url
                FROM service_claims sc
                JOIN facilities f ON sc.facility_id = f.id
                LEFT JOIN source_registry sr ON sc.evidence_id = sr.id
                ${where} ORDER BY sc.created_at DESC
            `).all(...params));
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/service-claims', ...adminOnly, validate(z.object({
        facility_id: z.number().int().positive(),
        service_type: z.string().min(2).max(80),
        evidence_id: z.number().int().positive().optional(),
        verification_method: z.enum(['source_confirmed', 'directly_verified', 'imported', 'admin_entry']),
        availability_status: z.enum(['available', 'unavailable', 'commissioning', 'unknown']).default('unknown'),
        fee_status: z.enum(['free', 'paid', 'unknown']).default('unknown'),
        notes: z.string().max(2000).optional(),
    })), (req, res, next) => {
        try {
            const b = req.body;
            db.prepare(`
                INSERT INTO service_claims (facility_id, service_type, evidence_id, verification_method, availability_status, fee_status, notes, last_confirmed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(facility_id, service_type) DO UPDATE SET
                    evidence_id = excluded.evidence_id,
                    verification_method = excluded.verification_method,
                    availability_status = excluded.availability_status,
                    fee_status = excluded.fee_status,
                    notes = excluded.notes,
                    last_confirmed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
            `).run(b.facility_id, b.service_type, b.evidence_id || null, b.verification_method, b.availability_status, b.fee_status, b.notes || null);
            createAuditLog(db, req.user, 'upsert_service_claim', 'service_claim', b.facility_id, { service: b.service_type }, req.ip);
            return res.json({ message: 'Service claim saved' });
        } catch (err) { return next(err); }
    });

    // ---- Verification Audit ----
    app.get('/api/admin/verification-audit', ...adminOnly, (req, res, next) => {
        try {
            const { record_type, record_id } = req.query;
            let where = ' WHERE 1 = 1';
            const params = [];
            if (record_type) { where += ' AND record_type = ?'; params.push(record_type); }
            if (record_id) { where += ' AND record_id = ?'; params.push(record_id); }
            return res.json(db.prepare(`
                SELECT va.*, u.name AS verified_by_name
                FROM verification_audit va
                LEFT JOIN users u ON va.verified_by = u.id
                ${where} ORDER BY va.timestamp DESC LIMIT 100
            `).all(...params));
        } catch (err) { return next(err); }
    });

    // ---- Medical Knowledge CRUD ----
    app.get('/api/admin/medical-knowledge', ...adminOnly, (req, res, next) => {
        try {
            const { topic, review_status } = req.query;
            let where = ' WHERE 1 = 1';
            const params = [];
            if (topic) { where += ' AND topic = ?'; params.push(topic); }
            if (review_status) { where += ' AND review_status = ?'; params.push(review_status); }
            return res.json(db.prepare(`SELECT * FROM medical_knowledge${where} ORDER BY created_at DESC`).all(...params));
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/medical-knowledge', ...adminOnly, validate(z.object({
        topic: z.string().min(2).max(120),
        title: z.string().min(4).max(220),
        content: z.string().min(20).max(60000),
        source_references: z.string().max(4000).optional(),
        source_retrieved_at: z.string().max(40).optional(),
        review_status: z.enum(['draft', 'awaiting_review', 'clinician_reviewed', 'requires_re_review']).default('draft'),
    })), (req, res, next) => {
        try {
            const b = req.body;
            const info = db.prepare(`
                INSERT INTO medical_knowledge (topic, title, content, source_references, source_retrieved_at, review_status)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(b.topic, b.title, b.content, b.source_references || null, b.source_retrieved_at || null, b.review_status);
            createAuditLog(db, req.user, 'create_medical_knowledge', 'medical_knowledge', Number(info.lastInsertRowid), {}, req.ip);
            return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Medical knowledge entry created' });
        } catch (err) { return next(err); }
    });

    app.put('/api/admin/medical-knowledge/:id/review', ...adminOnly, validate(z.object({
        review_status: z.enum(['draft', 'awaiting_review', 'clinician_reviewed', 'requires_re_review']),
        reviewer_identity: z.string().max(200).optional(),
    })), (req, res, next) => {
        try {
            const b = req.body;
            const info = db.prepare(`
                UPDATE medical_knowledge SET review_status = ?, reviewer_identity = ?,
                    reviewed_at = CASE WHEN ? = 'clinician_reviewed' THEN CURRENT_TIMESTAMP ELSE reviewed_at END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(b.review_status, b.reviewer_identity || null, b.review_status, req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Entry not found' });
            createAuditLog(db, req.user, 'review_medical_knowledge', 'medical_knowledge', Number(req.params.id), { status: b.review_status }, req.ip);
            return res.json({ message: 'Review status updated' });
        } catch (err) { return next(err); }
    });
}
