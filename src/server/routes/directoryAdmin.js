import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';
import {
    registerSource, stageProviderCandidates, stageSupportOrganisation, PROVINCES, FACILITY_TYPES,
} from '../lib/importPipeline.js';

/**
 * Administrative healthcare-data workflow.
 *
 * Rules enforced here:
 *   - Administrators must record who verified a fact, when, how, and against
 *     which registered source.
 *   - A source-confirmed record can never be silently upgraded to directly
 *     verified; the direct method and its evidence must be supplied explicitly.
 *   - Rejected records are unpublished, never deleted.
 */

const VERIFICATION_STATUSES = ['imported', 'source_confirmed', 'directly_verified', 'expired', 'rejected'];
const PUBLICATION_STATUSES = ['draft', 'published', 'archived'];
const MACHINE_STATUSES = ['operational', 'commissioning', 'under_maintenance', 'reported_unavailable', 'unknown'];
const COMMISSIONING_STATUSES = ['not_started', 'in_progress', 'completed', 'unknown'];

function audit(db, req, recordType, recordId, previousStatus, newStatus, method, evidenceId, notes) {
    db.prepare(`
        INSERT INTO verification_audit (record_type, record_id, previous_status, new_status,
            verified_by, verification_method, evidence_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(recordType, recordId, previousStatus || null, newStatus, req.user?.id || null, method || null, evidenceId || null, notes || null);
}

function nextReviewDate(days) {
    return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export function initDirectoryAdminRoutes(app, db, authMiddleware) {
    const adminOnly = [authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin')];

    // ---- Summary ----
    app.get('/api/admin/directory/summary', ...adminOnly, (_req, res, next) => {
        try {
            const q = (sql) => db.prepare(sql).get().c;
            return res.json({
                sources: q('SELECT COUNT(*) c FROM source_registry'),
                candidates: q("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status != 'published'"),
                published: q("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status = 'published'"),
                directly_verified: q("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND verification_status = 'directly_verified'"),
                source_confirmed: q("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND verification_status = 'source_confirmed'"),
                rejected: q("SELECT COUNT(*) c FROM facilities WHERE verification_status = 'rejected'"),
                support_organisations: q('SELECT COUNT(*) c FROM support_organisations WHERE is_demo = 0'),
                radiotherapy_machines: q('SELECT COUNT(*) c FROM radiotherapy_machines WHERE is_demo = 0'),
                open_conflicts: q("SELECT COUNT(*) c FROM source_conflicts WHERE status = 'open'"),
                overdue_reviews: q("SELECT COUNT(*) c FROM review_schedule WHERE next_review_at < datetime('now')"),
                verified_campaigns: q("SELECT COUNT(*) c FROM screening_campaigns WHERE is_demo = 0 AND verification_status IN ('source_confirmed','directly_verified') AND date_end >= date('now')"),
                support_published: q("SELECT COUNT(*) c FROM support_organisations WHERE is_demo = 0 AND publication_status = 'published'"),
                support_candidates: q("SELECT COUNT(*) c FROM support_organisations WHERE is_demo = 0 AND publication_status != 'published'"),
                doctors_verified: q("SELECT COUNT(*) c FROM doctors WHERE is_demo = 0 AND verified = 1"),
                doctor_candidates: q("SELECT COUNT(*) c FROM doctors WHERE is_demo = 0 AND verified = 0"),
                knowledge_drafts: q("SELECT COUNT(*) c FROM medical_knowledge WHERE review_status != 'clinician_reviewed'"),
                expired_campaigns: q("SELECT COUNT(*) c FROM screening_campaigns WHERE is_demo = 0 AND (expiry_status = 'expired' OR date_end < date('now'))"),
            });
        } catch (err) { return next(err); }
    });

    // ---- Candidate / published provider queue ----
    app.get('/api/admin/directory/providers', ...adminOnly, (req, res, next) => {
        try {
            const { publication_status, verification_status, province, include_demo } = req.query;
            let query = `
                SELECT f.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url,
                       (SELECT COUNT(*) FROM service_claims sc WHERE sc.facility_id = f.id) AS service_count
                FROM facilities f
                LEFT JOIN source_registry sr ON f.evidence_id = sr.id
                WHERE 1 = 1
            `;
            const params = [];
            if (include_demo !== 'true') query += ' AND f.is_demo = 0';
            if (publication_status) { query += ' AND f.publication_status = ?'; params.push(publication_status); }
            if (verification_status) { query += ' AND f.verification_status = ?'; params.push(verification_status); }
            if (province) { query += ' AND f.province = ?'; params.push(province); }
            query += ' ORDER BY f.publication_status, f.name';
            return res.json(db.prepare(query).all(...params));
        } catch (err) { return next(err); }
    });

    app.get('/api/admin/directory/providers/:id', ...adminOnly, (req, res, next) => {
        try {
            const provider = db.prepare(`
                SELECT f.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM facilities f LEFT JOIN source_registry sr ON f.evidence_id = sr.id
                WHERE f.id = ?
            `).get(req.params.id);
            if (!provider) return res.status(404).json({ error: 'NOT_FOUND', message: 'Provider not found' });
            const claims = db.prepare(`
                SELECT sc.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM service_claims sc LEFT JOIN source_registry sr ON sc.evidence_id = sr.id
                WHERE sc.facility_id = ? ORDER BY sc.service_type
            `).all(req.params.id);
            const machines = db.prepare('SELECT * FROM radiotherapy_machines WHERE facility_id = ? ORDER BY machine_type').all(req.params.id);
            const history = db.prepare(`
                SELECT va.*, u.name AS verified_by_name FROM verification_audit va
                LEFT JOIN users u ON va.verified_by = u.id
                WHERE va.record_type = 'facility' AND va.record_id = ?
                ORDER BY va.timestamp DESC LIMIT 20
            `).all(req.params.id);
            return res.json({ provider, claims, machines, history });
        } catch (err) { return next(err); }
    });

    // ---- Verify / reject / publish ----
    app.post('/api/admin/directory/providers/:id/verify', ...adminOnly, validate(z.object({
        verification_status: z.enum(VERIFICATION_STATUSES),
        verification_method: z.enum(['source_confirmed', 'directly_verified', 'imported', 'admin_entry']),
        evidence_id: z.number().int().positive().optional().nullable(),
        verified_by_name: z.string().min(2).max(200),
        notes: z.string().min(10).max(4000),
        next_review_at: z.string().max(40).optional().nullable(),
        publish: z.boolean().optional().default(true),
    })), (req, res, next) => {
        try {
            const b = req.body;
            const provider = db.prepare('SELECT * FROM facilities WHERE id = ?').get(req.params.id);
            if (!provider) return res.status(404).json({ error: 'NOT_FOUND', message: 'Provider not found' });

            if ((b.verification_status === 'source_confirmed' || b.verification_status === 'directly_verified') && !b.evidence_id) {
                return res.status(400).json({ error: 'EVIDENCE_REQUIRED', message: 'A registered evidence source is required for verification.' });
            }
            if (b.verification_status === 'directly_verified' && b.verification_method !== 'directly_verified') {
                return res.status(400).json({
                    error: 'DIRECT_VERIFICATION_REQUIRED',
                    message: 'A record can only be directly verified with the directly_verified method and documented direct confirmation. Source evidence alone is not enough.',
                });
            }
            if (b.verification_status === 'source_confirmed' && b.verification_method === 'directly_verified') {
                return res.status(400).json({ error: 'INVALID_METHOD', message: 'Use directly_verified status when the method is direct verification.' });
            }
            if (b.evidence_id) {
                const source = db.prepare('SELECT id FROM source_registry WHERE id = ?').get(b.evidence_id);
                if (!source) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Evidence source not found in the source registry.' });
            }

            const isVerified = b.verification_status === 'source_confirmed' || b.verification_status === 'directly_verified';
            const publication = isVerified && b.publish ? 'published' : (b.verification_status === 'rejected' ? 'archived' : provider.publication_status === 'demo' ? 'draft' : provider.publication_status);
            const reviewDate = b.next_review_at || (isVerified ? nextReviewDate(90) : provider.next_review_at);

            db.prepare(`
                UPDATE facilities SET verification_status = ?, publication_status = ?, evidence_id = ?,
                    verified_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE verified_at END,
                    next_review_at = ?, public_notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(b.verification_status, publication, b.evidence_id || provider.evidence_id || null,
                isVerified ? 1 : 0, reviewDate, b.notes, provider.id);

            audit(db, req, 'facility', provider.id, provider.verification_status, b.verification_status,
                b.verification_method, b.evidence_id, `${b.verified_by_name}: ${b.notes}`);

            if (isVerified) {
                db.prepare(`
                    INSERT INTO review_schedule (record_type, record_id, interval_days, next_review_at, owner, notes)
                    VALUES ('facility', ?, 90, ?, ?, 'Provider contact and service review')
                    ON CONFLICT(record_type, record_id) DO UPDATE SET next_review_at = excluded.next_review_at,
                        owner = excluded.owner, updated_at = CURRENT_TIMESTAMP
                `).run(provider.id, reviewDate, b.verified_by_name);
            }

            createAuditLog(db, req.user, 'verify_provider', 'facility', provider.id,
                { status: b.verification_status, method: b.verification_method, evidence_id: b.evidence_id }, req.ip);
            return res.json({ message: 'Verification recorded', verification_status: b.verification_status, publication_status: publication });
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/directory/providers/:id/publication', ...adminOnly, validate(z.object({
        publication_status: z.enum(PUBLICATION_STATUSES),
        notes: z.string().min(5).max(2000),
    })), (req, res, next) => {
        try {
            const provider = db.prepare('SELECT * FROM facilities WHERE id = ?').get(req.params.id);
            if (!provider) return res.status(404).json({ error: 'NOT_FOUND', message: 'Provider not found' });
            if (req.body.publication_status === 'published'
                && !['source_confirmed', 'directly_verified'].includes(provider.verification_status)) {
                return res.status(400).json({
                    error: 'NOT_VERIFIED',
                    message: 'Unverified or imported records cannot be published as verified providers.',
                });
            }
            db.prepare('UPDATE facilities SET publication_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(req.body.publication_status, provider.id);
            audit(db, req, 'facility', provider.id, provider.publication_status, req.body.publication_status, 'admin_entry', provider.evidence_id, req.body.notes);
            return res.json({ message: 'Publication status updated', publication_status: req.body.publication_status });
        } catch (err) { return next(err); }
    });

    // ---- Screening campaigns ----
    app.get('/api/admin/directory/campaigns', ...adminOnly, (_req, res, next) => {
        try {
            return res.json(db.prepare(`
                SELECT c.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM screening_campaigns c LEFT JOIN source_registry sr ON c.evidence_id = sr.id
                ORDER BY c.date_end DESC
            `).all());
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/directory/campaigns/:id/verify', ...adminOnly, validate(z.object({
        verification_status: z.enum(['source_confirmed', 'directly_verified', 'expired', 'rejected']),
        evidence_id: z.number().int().positive().optional().nullable(),
        verified_by_name: z.string().min(2).max(200),
        notes: z.string().min(10).max(2000),
        publish: z.boolean().optional().default(true),
    })), (req, res, next) => {
        try {
            const campaign = db.prepare('SELECT * FROM screening_campaigns WHERE id = ?').get(req.params.id);
            if (!campaign) return res.status(404).json({ error: 'NOT_FOUND', message: 'Campaign not found' });
            const b = req.body;
            if (b.verification_status === 'source_confirmed' && !b.evidence_id) {
                return res.status(400).json({ error: 'EVIDENCE_REQUIRED', message: 'A source is required to confirm a campaign.' });
            }
            const expired = b.verification_status === 'expired' || b.verification_status === 'rejected' || new Date(campaign.date_end) < new Date();
            db.prepare(`
                UPDATE screening_campaigns SET verification_status = ?, evidence_id = ?, verified_at = CURRENT_TIMESTAMP,
                    expiry_status = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(b.verification_status, b.evidence_id || campaign.evidence_id || null, expired ? 'expired' : 'active', campaign.id);
            audit(db, req, 'screening_campaign', campaign.id, campaign.verification_status, b.verification_status, 'source_confirmed', b.evidence_id, `${b.verified_by_name}: ${b.notes}`);
            return res.json({ message: 'Campaign verification recorded', expired });
        } catch (err) { return next(err); }
    });

    // ---- Radiotherapy machines ----
    app.get('/api/admin/directory/radiotherapy', ...adminOnly, (_req, res, next) => {
        try {
            return res.json(db.prepare(`
                SELECT m.*, f.name AS facility_name, f.province, f.city,
                       sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM radiotherapy_machines m
                JOIN facilities f ON m.facility_id = f.id
                LEFT JOIN source_registry sr ON m.evidence_id = sr.id
                ORDER BY f.name, m.machine_type
            `).all());
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/directory/radiotherapy', ...adminOnly, validate(z.object({
        facility_id: z.number().int().positive(),
        machine_type: z.string().min(2).max(160),
        equipment_description: z.string().max(2000).optional(),
        installation_status: z.string().max(120).optional(),
        commissioning_status: z.enum(COMMISSIONING_STATUSES).default('unknown'),
        operational_status: z.enum(MACHINE_STATUSES).default('unknown'),
        evidence_id: z.number().int().positive().optional().nullable(),
        last_reported_update: z.string().max(40).optional().nullable(),
        public_contact_instructions: z.string().max(1000).optional(),
        admin_notes: z.string().max(4000).optional(),
    })), (req, res, next) => {
        try {
            const b = req.body;
            const facility = db.prepare('SELECT id FROM facilities WHERE id = ?').get(b.facility_id);
            if (!facility) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Facility not found' });
            const info = db.prepare(`
                INSERT INTO radiotherapy_machines (facility_id, machine_type, equipment_description, installation_status,
                    commissioning_status, operational_status, evidence_id, last_reported_update,
                    public_contact_instructions, admin_notes, verification_method, publication_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin_entry', 'draft')
            `).run(b.facility_id, b.machine_type, b.equipment_description || null, b.installation_status || null,
                b.commissioning_status, b.operational_status, b.evidence_id || null, b.last_reported_update || null,
                b.public_contact_instructions || null, b.admin_notes || null);
            createAuditLog(db, req.user, 'create_radiotherapy_machine', 'radiotherapy_machine', Number(info.lastInsertRowid), {}, req.ip);
            return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Machine record created' });
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/directory/radiotherapy/:id/verify', ...adminOnly, validate(z.object({
        commissioning_status: z.enum(COMMISSIONING_STATUSES),
        operational_status: z.enum(MACHINE_STATUSES),
        verification_method: z.enum(['source_confirmed', 'directly_verified', 'admin_entry']),
        evidence_id: z.number().int().positive().optional().nullable(),
        verified_by_name: z.string().min(2).max(200),
        notes: z.string().min(10).max(4000),
        publish: z.boolean().optional().default(true),
    })), (req, res, next) => {
        try {
            const machine = db.prepare('SELECT * FROM radiotherapy_machines WHERE id = ?').get(req.params.id);
            if (!machine) return res.status(404).json({ error: 'NOT_FOUND', message: 'Machine not found' });
            const b = req.body;
            if (b.operational_status === 'operational' && b.verification_method !== 'directly_verified') {
                return res.status(400).json({
                    error: 'DIRECT_CONFIRMATION_REQUIRED',
                    message: 'A machine can only be marked operational after direct confirmation by the facility or equipment manager.',
                });
            }
            if (b.verification_method !== 'admin_entry' && !b.evidence_id) {
                return res.status(400).json({ error: 'EVIDENCE_REQUIRED', message: 'A registered source is required for this verification method.' });
            }
            db.prepare(`
                UPDATE radiotherapy_machines SET commissioning_status = ?, operational_status = ?,
                    evidence_id = ?, verification_method = ?,
                    last_directly_verified = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_directly_verified END,
                    last_reported_update = CURRENT_TIMESTAMP,
                    publication_status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(b.commissioning_status, b.operational_status, b.evidence_id || machine.evidence_id || null,
                b.verification_method, b.verification_method === 'directly_verified' ? 1 : 0,
                b.publish ? 'published' : machine.publication_status, b.notes, machine.id);

            audit(db, req, 'radiotherapy_machine', machine.id, machine.operational_status, b.operational_status,
                b.verification_method, b.evidence_id, `${b.verified_by_name}: ${b.notes}`);

            const days = b.operational_status === 'operational' ? 30 : 14;
            db.prepare(`
                INSERT INTO review_schedule (record_type, record_id, interval_days, next_review_at, owner, notes)
                VALUES ('radiotherapy_machine', ?, ?, ?, ?, 'Radiotherapy status confirmation')
                ON CONFLICT(record_type, record_id) DO UPDATE SET interval_days = excluded.interval_days,
                    next_review_at = excluded.next_review_at, owner = excluded.owner, updated_at = CURRENT_TIMESTAMP
            `).run(machine.id, days, nextReviewDate(days), b.verified_by_name);

            return res.json({ message: 'Machine status updated. Only direct confirmation may be shown as operational.' });
        } catch (err) { return next(err); }
    });

    // ---- Conflicts ----
    app.get('/api/admin/directory/conflicts', ...adminOnly, (req, res, next) => {
        try {
            const { status } = req.query;
            let query = 'SELECT * FROM source_conflicts';
            const params = [];
            if (status) { query += ' WHERE status = ?'; params.push(status); }
            query += ' ORDER BY detected_at DESC';
            return res.json(db.prepare(query).all(...params));
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/directory/conflicts/:id/resolve', ...adminOnly, validate(z.object({
        status: z.enum(['resolved', 'dismissed']),
        notes: z.string().min(5).max(4000),
    })), (req, res, next) => {
        try {
            const info = db.prepare(`
                UPDATE source_conflicts SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, notes = ?
                WHERE id = ?
            `).run(req.body.status, req.user.id, req.body.notes, req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Conflict not found' });
            createAuditLog(db, req.user, 'resolve_source_conflict', 'source_conflict', Number(req.params.id), { status: req.body.status }, req.ip);
            return res.json({ message: 'Conflict updated' });
        } catch (err) { return next(err); }
    });

    // ---- Review schedule ----
    app.get('/api/admin/directory/reviews', ...adminOnly, (req, res, next) => {
        try {
            const { overdue } = req.query;
            let query = `
                SELECT rs.*,
                       COALESCE(f.name, s.name, m.machine_type, c.organization_name, 'Record ' || rs.record_id) AS record_name
                FROM review_schedule rs
                LEFT JOIN facilities f ON rs.record_type = 'facility' AND f.id = rs.record_id
                LEFT JOIN support_organisations s ON rs.record_type = 'support_organisation' AND s.id = rs.record_id
                LEFT JOIN radiotherapy_machines m ON rs.record_type = 'radiotherapy_machine' AND m.id = rs.record_id
                LEFT JOIN screening_campaigns c ON rs.record_type = 'screening_campaign' AND c.id = rs.record_id
            `;
            if (overdue === 'true') query += " WHERE rs.next_review_at < datetime('now')";
            query += ' ORDER BY rs.next_review_at ASC LIMIT 200';
            return res.json(db.prepare(query).all());
        } catch (err) { return next(err); }
    });

    // ---- Verification history ----
    app.get('/api/admin/directory/history', ...adminOnly, (req, res, next) => {
        try {
            const { record_type, record_id, limit } = req.query;
            let query = `
                SELECT va.*, u.name AS verified_by_name, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM verification_audit va
                LEFT JOIN users u ON va.verified_by = u.id
                LEFT JOIN source_registry sr ON va.evidence_id = sr.id
            `;
            const params = [];
            if (record_type) { query += ' WHERE va.record_type = ?'; params.push(record_type); }
            if (record_id) { query += (record_type ? ' AND' : ' WHERE') + ' va.record_id = ?'; params.push(record_id); }
            const capped = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
            query += ` ORDER BY va.timestamp DESC LIMIT ${capped}`;
            return res.json(db.prepare(query).all(...params));
        } catch (err) { return next(err); }
    });

    // ---- Support organisations ----
    app.get('/api/admin/directory/support', ...adminOnly, (req, res, next) => {
        try {
            const { publication_status, verification_status } = req.query;
            let query = `
                SELECT s.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM support_organisations s
                LEFT JOIN source_registry sr ON s.evidence_id = sr.id
                WHERE 1 = 1
            `;
            const params = [];
            if (publication_status) { query += ' AND s.publication_status = ?'; params.push(publication_status); }
            if (verification_status) { query += ' AND s.verification_status = ?'; params.push(verification_status); }
            query += ' ORDER BY s.publication_status, s.name';
            return res.json(db.prepare(query).all(...params));
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/directory/support', ...adminOnly, validate(z.object({
        name: z.string().min(2).max(200),
        organisation_type: z.string().min(2).max(80),
        description: z.string().max(4000).optional(),
        services: z.string().max(2000).optional(),
        province: z.enum(PROVINCES).optional(),
        city: z.string().max(120).optional(),
        address: z.string().max(300).optional(),
        phone: z.string().max(60).optional(),
        email: z.string().max(200).optional(),
        website: z.string().max(500).optional(),
        evidence_id: z.number().int().positive().optional().nullable(),
        notes: z.string().max(2000).optional(),
    })), (req, res, next) => {
        try {
            const b = req.body;
            if (b.evidence_id) {
                const source = db.prepare('SELECT id FROM source_registry WHERE id = ?').get(b.evidence_id);
                if (!source) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Evidence source not found.' });
            }
            const result = stageSupportOrganisation(db, {
                sourceId: b.evidence_id || null,
                actorId: req.user.id,
                record: { ...b, evidence_notes: b.notes },
            });
            createAuditLog(db, req.user, 'stage_support_organisation', 'support_organisation', result.id, {}, req.ip);
            return res.status(201).json({ id: result.id, action: result.action, message: 'Support organisation staged as unverified.' });
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/directory/support/:id/verify', ...adminOnly, validate(z.object({
        verification_status: z.enum(['source_confirmed', 'directly_verified', 'rejected', 'expired']),
        verification_method: z.enum(['source_confirmed', 'directly_verified', 'admin_entry']),
        evidence_id: z.number().int().positive().optional().nullable(),
        verified_by_name: z.string().min(2).max(200),
        notes: z.string().min(10).max(4000),
        publish: z.boolean().optional().default(true),
    })), (req, res, next) => {
        try {
            const org = db.prepare('SELECT * FROM support_organisations WHERE id = ?').get(req.params.id);
            if (!org) return res.status(404).json({ error: 'NOT_FOUND', message: 'Support organisation not found' });
            const b = req.body;
            const isVerified = b.verification_status === 'source_confirmed' || b.verification_status === 'directly_verified';
            if (isVerified && !b.evidence_id && !org.evidence_id) {
                return res.status(400).json({ error: 'EVIDENCE_REQUIRED', message: 'A registered evidence source is required.' });
            }
            if (b.verification_status === 'directly_verified' && b.verification_method !== 'directly_verified') {
                return res.status(400).json({ error: 'DIRECT_VERIFICATION_REQUIRED', message: 'Direct verification requires the directly_verified method and documented direct confirmation.' });
            }
            if (b.verification_status === 'source_confirmed' && b.verification_method === 'directly_verified') {
                return res.status(400).json({ error: 'INVALID_METHOD', message: 'Use directly_verified status when the method is direct verification.' });
            }
            const publication = isVerified && b.publish ? 'published' : (b.verification_status === 'rejected' ? 'archived' : org.publication_status === 'demo' ? 'draft' : org.publication_status);
            const reviewAt = isVerified ? nextReviewDate(90) : org.next_review_at;
            db.prepare(`
                UPDATE support_organisations SET verification_status = ?, publication_status = ?, evidence_id = COALESCE(?, evidence_id),
                    verified_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE verified_at END,
                    next_review_at = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(b.verification_status, publication, b.evidence_id || null, isVerified ? 1 : 0, reviewAt, org.id);
            audit(db, req, 'support_organisation', org.id, org.verification_status, b.verification_status,
                b.verification_method, b.evidence_id, `${b.verified_by_name}: ${b.notes}`);
            if (isVerified) {
                db.prepare(`
                    INSERT INTO review_schedule (record_type, record_id, interval_days, next_review_at, owner, notes)
                    VALUES ('support_organisation', ?, 90, ?, ?, 'Support organisation review')
                    ON CONFLICT(record_type, record_id) DO UPDATE SET next_review_at = excluded.next_review_at,
                        owner = excluded.owner, updated_at = CURRENT_TIMESTAMP
                `).run(org.id, reviewAt, b.verified_by_name);
            }
            createAuditLog(db, req.user, 'verify_support_organisation', 'support_organisation', org.id,
                { status: b.verification_status, method: b.verification_method }, req.ip);
            return res.json({ message: 'Support organisation verification recorded', verification_status: b.verification_status, publication_status: publication });
        } catch (err) { return next(err); }
    });

    // ---- Doctor registration verification ----
    app.get('/api/admin/directory/doctors', ...adminOnly, (req, res, next) => {
        try {
            const { verification_status, publication_status } = req.query;
            let query = `
                SELECT d.*, u.name AS doctor_name, u.email AS doctor_email, f.name AS hospital_name,
                       sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM doctors d
                JOIN users u ON d.user_id = u.id
                LEFT JOIN facilities f ON d.hospital_id = f.id
                LEFT JOIN source_registry sr ON d.evidence_id = sr.id
                WHERE d.is_demo = 0
            `;
            const params = [];
            if (verification_status) { query += ' AND d.verification_status = ?'; params.push(verification_status); }
            if (publication_status) { query += ' AND d.publication_status = ?'; params.push(publication_status); }
            query += ' ORDER BY d.verified ASC, u.name';
            return res.json(db.prepare(query).all(...params));
        } catch (err) { return next(err); }
    });

    app.post('/api/admin/directory/doctors/:id/verify', ...adminOnly, validate(z.object({
        verification_status: z.enum(['imported', 'source_confirmed', 'directly_verified', 'rejected']),
        verification_method: z.enum(['source_confirmed', 'directly_verified', 'admin_entry']),
        registration_source_url: z.string().max(500).optional().nullable(),
        registration_checked_at: z.string().max(40).optional().nullable(),
        accepting_patients: z.boolean().optional().nullable(),
        evidence_id: z.number().int().positive().optional().nullable(),
        verified_by_name: z.string().min(2).max(200),
        notes: z.string().min(10).max(4000),
        publish: z.boolean().optional().default(true),
    })), (req, res, next) => {
        try {
            const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
            if (!doctor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Doctor not found' });
            const b = req.body;
            const isVerified = b.verification_status === 'source_confirmed' || b.verification_status === 'directly_verified';
            if (isVerified && !b.evidence_id && !doctor.evidence_id) {
                return res.status(400).json({ error: 'EVIDENCE_REQUIRED', message: 'A registered evidence source is required to verify a doctor.' });
            }
            if (b.verification_status === 'directly_verified' && b.verification_method !== 'directly_verified') {
                return res.status(400).json({ error: 'DIRECT_VERIFICATION_REQUIRED', message: 'Direct verification requires documented direct confirmation.' });
            }
            const publication = isVerified && b.publish ? 'published' : (b.verification_status === 'rejected' ? 'archived' : 'candidate');
            const reviewAt = isVerified ? nextReviewDate(90) : doctor.next_review_at;
            db.prepare(`
                UPDATE doctors SET verification_status = ?, publication_status = ?, verified = ?,
                    verification_date = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE verification_date END,
                    verified_by = ?, registration_source_url = COALESCE(?, registration_source_url),
                    registration_checked_at = COALESCE(?, registration_checked_at),
                    accepting_patients = COALESCE(?, accepting_patients), evidence_id = COALESCE(?, evidence_id),
                    next_review_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(b.verification_status, publication, isVerified ? 1 : 0, isVerified ? 1 : 0,
                b.verified_by_name, b.registration_source_url || null, b.registration_checked_at || null,
                b.accepting_patients === null || b.accepting_patients === undefined ? null : (b.accepting_patients ? 1 : 0),
                b.evidence_id || null, reviewAt, doctor.id);
            audit(db, req, 'doctor', doctor.id, doctor.verification_status || 'unverified', b.verification_status,
                b.verification_method, b.evidence_id, `${b.verified_by_name}: ${b.notes}`);
            if (isVerified) {
                db.prepare(`
                    INSERT INTO review_schedule (record_type, record_id, interval_days, next_review_at, owner, notes)
                    VALUES ('doctor', ?, 90, ?, ?, 'Doctor registration re-check')
                    ON CONFLICT(record_type, record_id) DO UPDATE SET next_review_at = excluded.next_review_at,
                        owner = excluded.owner, updated_at = CURRENT_TIMESTAMP
                `).run(doctor.id, reviewAt, b.verified_by_name);
            }
            createAuditLog(db, req.user, 'verify_doctor_registration', 'doctor', doctor.id,
                { status: b.verification_status, method: b.verification_method }, req.ip);
            return res.json({ message: 'Doctor verification recorded', verification_status: b.verification_status, publication_status: publication });
        } catch (err) { return next(err); }
    });

    // ---- Expired / stale information ----
    app.get('/api/admin/directory/expired', ...adminOnly, (_req, res, next) => {
        try {
            return res.json({
                facilities: db.prepare(`
                    SELECT id, name, province, city, verification_status, publication_status, verified_at, next_review_at
                    FROM facilities
                    WHERE is_demo = 0 AND (verification_status = 'expired'
                        OR (next_review_at IS NOT NULL AND next_review_at < date('now')))
                    ORDER BY next_review_at
                `).all(),
                campaigns: db.prepare(`
                    SELECT id, organization_name, service_type, location, province, date_start, date_end,
                           verification_status, expiry_status
                    FROM screening_campaigns
                    WHERE is_demo = 0 AND (expiry_status = 'expired' OR date_end < date('now'))
                    ORDER BY date_end DESC
                `).all(),
                machines: db.prepare(`
                    SELECT m.id, m.machine_type, m.operational_status, m.last_reported_update,
                           m.last_directly_verified, f.name AS facility_name, f.province
                    FROM radiotherapy_machines m JOIN facilities f ON m.facility_id = f.id
                    WHERE m.is_demo = 0 AND m.operational_status IN ('commissioning', 'under_maintenance', 'reported_unavailable', 'unknown')
                    ORDER BY f.name
                `).all(),
                support: db.prepare(`
                    SELECT id, name, verification_status, publication_status, verified_at, next_review_at
                    FROM support_organisations
                    WHERE is_demo = 0 AND (verification_status = 'expired'
                        OR (next_review_at IS NOT NULL AND next_review_at < date('now')))
                    ORDER BY next_review_at
                `).all(),
            });
        } catch (err) { return next(err); }
    });

    // ---- Import pipeline (stages candidates only) ----
    app.post('/api/admin/directory/import', ...adminOnly, validate(z.object({
        source: z.object({
            organisation: z.string().min(2).max(200),
            source_url: z.string().url().max(500),
            source_type: z.enum(['government', 'municipal', 'ngo', 'private', 'academic', 'news', 'directory', 'manual']),
            authority_level: z.enum(['official', 'authoritative', 'community', 'unverified']),
            licence: z.string().max(300).optional(),
            publication_date: z.string().max(20).optional(),
            notes: z.string().max(2000).optional(),
        }).optional(),
        source_id: z.number().int().positive().optional(),
        type: z.enum(['providers', 'support_organisations', 'knowledge']),
        records: z.array(z.record(z.any())).min(1).max(500),
    })), (req, res, next) => {
        try {
            const b = req.body;
            const sourceId = b.source ? registerSource(db, b.source) : b.source_id;
            if (!sourceId || !db.prepare('SELECT id FROM source_registry WHERE id = ?').get(sourceId)) {
                return res.status(400).json({ error: 'EVIDENCE_REQUIRED', message: 'A source object or source_id is required.' });
            }
            let result;
            if (b.type === 'providers') {
                const authority = b.source?.authority_level || db.prepare('SELECT authority_level FROM source_registry WHERE id = ?').get(sourceId)?.authority_level;
                result = stageProviderCandidates(db, { sourceId, records: b.records, actorId: req.user.id, sourceAuthority: authority });
            } else if (b.type === 'support_organisations') {
                const outcomes = b.records.map((record) => {
                    try { return stageSupportOrganisation(db, { sourceId, record, actorId: req.user.id }); }
                    catch (err) { return { error: err.message, name: record?.name }; }
                });
                result = { staged: outcomes.filter((o) => o.action === 'staged').length, outcomes };
            } else {
                result = { staged: 0, outcomes: [] };
                for (const record of b.records) {
                    try {
                        result.outcomes.push(stageKnowledge(db, {
                            topic: record.topic, title: record.title, content: record.content,
                            sourceReferences: record.source_references || [], actorId: req.user.id,
                        }));
                        result.staged += 1;
                    } catch (err) {
                        result.outcomes.push({ error: err.message, title: record?.title });
                    }
                }
            }
            createAuditLog(db, req.user, 'import_candidates', 'import', sourceId, { type: b.type, count: b.records.length }, req.ip);
            return res.status(201).json({
                message: 'Import staged for administrative review. Nothing was published or directly verified.',
                source_id: sourceId,
                result,
            });
        } catch (err) { return next(err); }
    });
}
