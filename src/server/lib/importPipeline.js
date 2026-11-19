/**
 * Reusable healthcare-data ingestion pipeline.
 *
 * Design rules (enforced here, not left to callers):
 *   1. Every imported record must reference a registered evidence source.
 *   2. Imported records are always staged as `imported` / `draft`; the pipeline
 *      can never publish or directly verify a record.
 *   3. Key fields are normalised and validated before they reach the database.
 *   4. Duplicates and conflicts are detected. A verified, published record is
 *      never overwritten by a lower-authority import.
 *   5. Conflicts are queued in source_conflicts for administrative review.
 *
 * The pipeline is used by both the CLI import scripts and the admin import API.
 */

export const PROVINCES = [
    'Bulawayo', 'Harare', 'Manicaland', 'Mashonaland Central', 'Mashonaland East',
    'Mashonaland West', 'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands',
];

export const FACILITY_TYPES = [
    'public_hospital', 'private_hospital', 'cancer_center', 'screening_clinic',
    'surgical_facility', 'radiotherapy_center', 'general_clinic',
];

export const SOURCE_TYPES = [
    'government', 'municipal', 'ngo', 'private', 'academic', 'news', 'directory', 'manual',
];

export const AUTHORITY_LEVELS = ['official', 'authoritative', 'community', 'unverified'];

const VERIFIED = new Set(['source_confirmed', 'directly_verified']);

export function normaliseName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\(demo\)/g, '')
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function clean(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    return s === '' ? null : s;
}

function isUrl(value) {
    try { new URL(value); return true; } catch { return false; }
}

function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validCoordinates(lat, lon) {
    return typeof lat === 'number' && typeof lon === 'number'
        && lat >= -23 && lat <= -15 && lon >= 25 && lon <= 34;
}

/** Register (or re-use) a source of evidence. */
export function registerSource(db, source) {
    if (!source?.organisation || !source?.source_url) {
        throw new Error('Source requires organisation and source_url');
    }
    if (!SOURCE_TYPES.includes(source.source_type)) throw new Error(`Invalid source_type: ${source.source_type}`);
    if (!AUTHORITY_LEVELS.includes(source.authority_level)) throw new Error(`Invalid authority_level: ${source.authority_level}`);
    if (!isUrl(source.source_url)) throw new Error(`Invalid source_url: ${source.source_url}`);

    const existing = db.prepare('SELECT id FROM source_registry WHERE source_url = ?').get(source.source_url);
    if (existing) {
        db.prepare(`
            UPDATE source_registry SET organisation = ?, source_type = ?, authority_level = ?,
                licence = COALESCE(?, licence), publication_date = COALESCE(?, publication_date),
                notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(source.organisation, source.source_type, source.authority_level,
            clean(source.licence), clean(source.publication_date), clean(source.notes), existing.id);
        return existing.id;
    }
    const info = db.prepare(`
        INSERT INTO source_registry (organisation, source_url, source_type, authority_level, licence, publication_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(source.organisation, source.source_url, source.source_type, source.authority_level,
        clean(source.licence), clean(source.publication_date), clean(source.notes));
    return Number(info.lastInsertRowid);
}

export function findSourceByUrl(db, url) {
    return db.prepare('SELECT * FROM source_registry WHERE source_url = ?').get(url);
}

/** Validate a provider candidate, returning an array of human-readable errors. */
export function validateProviderCandidate(c) {
    const errors = [];
    if (!clean(c.name) || c.name.length < 3) errors.push('name is required (min 3 chars)');
    if (!PROVINCES.includes(c.province)) errors.push(`province must be one of: ${PROVINCES.join(', ')}`);
    if (!clean(c.city)) errors.push('city is required');
    if (!FACILITY_TYPES.includes(c.type)) errors.push(`type must be one of: ${FACILITY_TYPES.join(', ')}`);
    if (c.email && !isEmail(c.email)) errors.push('email is not valid');
    if (c.website && !isUrl(c.website)) errors.push('website is not a valid URL');
    if (c.evidence_url && !isUrl(c.evidence_url)) errors.push('evidence_url is not a valid URL');
    if ((c.latitude != null || c.longitude != null) && !validCoordinates(c.latitude, c.longitude)) {
        errors.push('coordinates are missing, incomplete or outside Zimbabwe');
    }
    return errors;
}

function duplicateProvider(db, c) {
    const byName = db.prepare('SELECT * FROM facilities WHERE lower(trim(name)) = lower(trim(?)) AND province = ?')
        .get(c.name, c.province);
    if (byName) return byName;
    if (c.website) {
        const bySite = db.prepare('SELECT * FROM facilities WHERE lower(trim(website)) = lower(trim(?))').get(c.website);
        if (bySite) return bySite;
    }
    if (c.phone) {
        const digits = String(c.phone).replace(/\D/g, '').slice(-7);
        if (digits.length >= 7) {
            const byPhone = db.prepare("SELECT * FROM facilities WHERE replace(replace(replace(phone,' ',''),'-',''),'(','') LIKE ?")
                .get(`%${digits}`);
            if (byPhone) return byPhone;
        }
    }
    return null;
}

function addConflict(db, recordType, recordId, field, values, notes) {
    const existing = db.prepare(`
        SELECT id FROM source_conflicts
        WHERE record_type = ? AND record_id = ? AND field_name = ? AND status = 'open'
    `).get(recordType, recordId, field);
    if (existing) return existing.id;
    const info = db.prepare(`
        INSERT INTO source_conflicts (record_type, record_id, field_name, conflicting_values, notes)
        VALUES (?, ?, ?, ?, ?)
    `).run(recordType, recordId, field, JSON.stringify(values), notes);
    return Number(info.lastInsertRowid);
}

function importAudit(db, actorId, action, entity, entityId, details) {
    try {
        db.prepare(`
            INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
            VALUES (?, ?, ?, ?, ?)
        `).run(actorId || null, action, entity, entityId, JSON.stringify(details || {}));
    } catch {
        // Audit logging must never abort an import.
    }
}

/**
 * Stage provider candidates.
 *
 * @returns {{staged:number, updated:number, skipped:number, conflicts:number, errors:Array, ids:number[]}}
 */
export function stageProviderCandidates(db, { sourceId, records = [], actorId = null, sourceAuthority = 'authoritative' }) {
    const result = { staged: 0, updated: 0, skipped: 0, conflicts: 0, errors: [], ids: [] };
    if (!sourceId || !db.prepare('SELECT id FROM source_registry WHERE id = ?').get(sourceId)) {
        throw new Error('A registered evidence source is required');
    }

    for (const raw of records) {
        const c = {
            ...raw,
            name: clean(raw.name),
            province: clean(raw.province),
            city: clean(raw.city),
            address: clean(raw.address) || clean(raw.city) || '',
        };
        const validationErrors = validateProviderCandidate(c);
        if (validationErrors.length) {
            result.errors.push({ name: c.name || '(unnamed)', errors: validationErrors });
            continue;
        }

        const existing = duplicateProvider(db, c);
        if (!existing) {
            const info = db.prepare(`
                INSERT INTO facilities (name, address, province, city, type, classification, phone, email, website,
                    latitude, longitude, coordinate_source, coordinate_source_url, coordinate_review_status,
                    evidence_id, verification_status, publication_status, services_summary, public_notes, is_demo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', 'draft', ?, ?, 0)
            `).run(c.name, c.address, c.province, c.city, c.type, c.classification || 'public',
                c.phone || null, c.email || null, c.website || null,
                c.latitude ?? null, c.longitude ?? null, c.coordinate_source || null,
                c.coordinate_source_url || null, c.coordinate_review_status || 'unreviewed',
                sourceId, c.services_summary || null, c.notes || null);

            const id = Number(info.lastInsertRowid);
            result.ids.push(id);
            result.staged += 1;
            importAudit(db, actorId, 'import_provider_candidate', 'facility', id, { sourceId, name: c.name });
            continue;
        }

        // Never let lower-authority import data overwrite a verified record.
        if (VERIFIED.has(existing.verification_status) && sourceAuthority === 'community') {
            addConflict(db, 'facility', existing.id, 'record_authority', {
                existing: existing.verification_status, incoming: 'community_import', name: c.name,
            }, 'Community-sourced import differs from a verified record; existing data retained.');
            result.conflicts += 1;
            result.skipped += 1;
            continue;
        }

        // Fill only blank fields; never silently replace published values.
        const updates = {};
        for (const field of ['address', 'phone', 'email', 'website', 'services_summary']) {
            if (!existing[field] && c[field]) updates[field] = c[field];
        }
        if (existing.latitude == null && existing.longitude == null && c.latitude != null && c.longitude != null) {
            updates.latitude = c.latitude;
            updates.longitude = c.longitude;
            updates.coordinate_source = c.coordinate_source || null;
            updates.coordinate_source_url = c.coordinate_source_url || null;
        }
        for (const [field, value] of Object.entries(updates)) {
            if (field === 'phone' && existing.phone && c.phone && existing.phone !== c.phone) {
                addConflict(db, 'facility', existing.id, 'phone', { existing: existing.phone, incoming: c.phone },
                    'Contact number differs between sources; direct confirmation required.');
                result.conflicts += 1;
            }
        }
        const fields = Object.keys(updates);
        if (fields.length) {
            db.prepare(`UPDATE facilities SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                .run(...fields.map((f) => updates[f]), existing.id);
            result.updated += 1;
        } else {
            result.skipped += 1;
        }
        result.ids.push(existing.id);
        importAudit(db, actorId, 'merge_provider_candidate', 'facility', existing.id, { sourceId, name: c.name, fields });
    }
    return result;
}

/** Stage a support organisation (never published by the pipeline). */
export function stageSupportOrganisation(db, { sourceId, record, actorId = null }) {
    const required = ['name', 'organisation_type'];
    for (const field of required) {
        if (!clean(record[field])) throw new Error(`${field} is required`);
    }
    if (record.website && !isUrl(record.website)) throw new Error('website is not a valid URL');
    if (record.province && !PROVINCES.includes(record.province)) throw new Error('invalid province');

    const existing = db.prepare('SELECT * FROM support_organisations WHERE lower(trim(name)) = lower(trim(?))')
        .get(record.name);
    if (existing) {
        if (VERIFIED.has(existing.verification_status)) {
            db.prepare('UPDATE support_organisations SET evidence_notes = COALESCE(?, evidence_notes), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(clean(record.evidence_notes), existing.id);
            return { id: existing.id, action: 'kept_verified' };
        }
        db.prepare(`
            UPDATE support_organisations SET organisation_type = ?, description = COALESCE(?, description),
                services = COALESCE(?, services), province = COALESCE(?, province), city = COALESCE(?, city),
                address = COALESCE(?, address), phone = COALESCE(?, phone), email = COALESCE(?, email),
                website = COALESCE(?, website), evidence_id = COALESCE(?, evidence_id),
                evidence_notes = COALESCE(?, evidence_notes), updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(record.organisation_type, clean(record.description), clean(record.services), clean(record.province),
            clean(record.city), clean(record.address), clean(record.phone), clean(record.email), clean(record.website),
            sourceId || null, clean(record.evidence_notes), existing.id);
        return { id: existing.id, action: 'updated' };
    }
    const info = db.prepare(`
        INSERT INTO support_organisations (name, organisation_type, description, services, province, city, address,
            phone, email, website, evidence_id, evidence_notes, verification_status, publication_status, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', 'draft', 0)
    `).run(record.name, record.organisation_type, clean(record.description), clean(record.services),
        clean(record.province), clean(record.city), clean(record.address), clean(record.phone),
        clean(record.email), clean(record.website), sourceId || null, clean(record.evidence_notes));
    const id = Number(info.lastInsertRowid);
    importAudit(db, actorId, 'import_support_organisation', 'support_organisation', id, { sourceId, name: record.name });
    return { id, action: 'staged' };
}

/** Stage medical knowledge as an unreviewed draft. */
export function stageKnowledge(db, { topic, title, content, sourceReferences = [], actorId = null }) {
    if (!clean(topic) || !clean(title) || !clean(content)) throw new Error('topic, title and content are required');
    const refs = JSON.stringify(sourceReferences);
    const existing = db.prepare('SELECT id FROM medical_knowledge WHERE title = ?').get(title);
    if (existing) {
        db.prepare(`
            UPDATE medical_knowledge SET topic = ?, content = ?, source_references = ?,
                review_status = CASE WHEN review_status = 'clinician_reviewed' THEN review_status ELSE 'draft' END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(topic, content, refs, existing.id);
        return { id: existing.id, action: 'updated' };
    }
    const info = db.prepare(`
        INSERT INTO medical_knowledge (topic, title, content, source_references, source_retrieved_at, review_status)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'draft')
    `).run(topic, title, content, refs);
    const id = Number(info.lastInsertRowid);
    importAudit(db, actorId, 'import_medical_knowledge', 'medical_knowledge', id, { topic, title });
    return { id, action: 'staged' };
}

export function ensureReviewSchedule(db, recordType, recordId, days, owner, notes) {
    const next = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    db.prepare(`
        INSERT INTO review_schedule (record_type, record_id, interval_days, next_review_at, owner, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_type, record_id) DO UPDATE SET interval_days = excluded.interval_days,
            next_review_at = excluded.next_review_at, owner = excluded.owner, updated_at = CURRENT_TIMESTAMP
    `).run(recordType, recordId, days, next, owner || 'data-team', notes || null);
    return next;
}

export default {
    PROVINCES,
    FACILITY_TYPES,
    registerSource,
    validateProviderCandidate,
    stageProviderCandidates,
    stageSupportOrganisation,
    stageKnowledge,
    ensureReviewSchedule,
};
