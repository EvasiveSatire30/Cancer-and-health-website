/**
 * Public verified-directory API.
 *
 * Publication policy (enforced here, not in the client):
 *   - is_demo = 0
 *   - publication_status = 'published'
 *   - verification_status IN ('source_confirmed', 'directly_verified')
 *   - service claims are only shown when they have source/direct evidence
 *
 * A source-confirmed record means published evidence supports the stated fact.
 * It does not mean the service is currently available, free, or accepting
 * patients. Availability and fee fields are shown separately and honestly.
 */

const PUBLISHED = "f.is_demo = 0 AND f.publication_status = 'published' AND f.verification_status IN ('source_confirmed', 'directly_verified')";
const VERIFIED_CLAIM = "sc.verification_method IN ('source_confirmed', 'directly_verified')";

const NO_SCREENING_MESSAGE = 'No currently verified free screening events are listed for this location. Contact local screening providers for current availability.';

function claimRows(db, facilityIds) {
    if (!facilityIds.length) return [];
    const placeholders = facilityIds.map(() => '?').join(',');
    return db.prepare(`
        SELECT sc.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
        FROM service_claims sc
        LEFT JOIN source_registry sr ON sc.evidence_id = sr.id
        WHERE sc.facility_id IN (${placeholders}) AND ${VERIFIED_CLAIM}
        ORDER BY sc.service_type
    `).all(...facilityIds);
}

function groupClaims(rows) {
    const map = new Map();
    for (const row of rows) {
        if (!map.has(row.facility_id)) map.set(row.facility_id, []);
        map.get(row.facility_id).push({
            id: row.id,
            service_type: row.service_type,
            availability_status: row.availability_status,
            fee_status: row.fee_status,
            verification_method: row.verification_method,
            last_confirmed_at: row.last_confirmed_at,
            evidence_url: row.evidence_url,
            evidence_organisation: row.evidence_organisation,
            notes: row.notes,
        });
    }
    return map;
}

function machineRows(db, facilityIds) {
    if (!facilityIds.length) return [];
    const placeholders = facilityIds.map(() => '?').join(',');
    return db.prepare(`
        SELECT m.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
        FROM radiotherapy_machines m
        LEFT JOIN source_registry sr ON m.evidence_id = sr.id
        WHERE m.facility_id IN (${placeholders})
          AND m.is_demo = 0 AND m.publication_status = 'published'
        ORDER BY m.machine_type
    `).all(...facilityIds);
}

function decorate(db, facilities) {
    const claims = groupClaims(claimRows(db, facilities.map((f) => f.id)));
    const machines = machineRows(db, facilities.map((f) => f.id));
    return facilities.map((f) => ({
        ...f,
        services: claims.get(f.id) || [],
        radiotherapy_machines: machines.filter((m) => m.facility_id === f.id),
    }));
}

export function initDirectoryRoutes(app, db) {
    // ---- Providers ----
    app.get('/api/directory/providers', (req, res, next) => {
        try {
            const { province, city, service, cancer_type, type, verification, search, has_coordinates } = req.query;
            let query = `
                SELECT f.id, f.name, f.address, f.province, f.city, f.phone, f.email, f.website,
                       f.type, f.classification, f.operating_hours, f.last_verified, f.is_demo,
                       f.publication_status, f.verification_status, f.verified_at, f.next_review_at,
                       f.evidence_id, f.latitude, f.longitude, f.services_summary, f.public_notes,
                       sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM facilities f
                LEFT JOIN source_registry sr ON f.evidence_id = sr.id
                WHERE ${PUBLISHED}
            `;
            const params = [];

            if (province) { query += ' AND f.province = ?'; params.push(province); }
            if (city) { query += ' AND f.city = ?'; params.push(city); }
            if (type) { query += ' AND f.type = ?'; params.push(type); }
            if (verification) { query += ' AND f.verification_status = ?'; params.push(verification); }
            if (has_coordinates === 'true') { query += ' AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL'; }
            if (search) {
                query += ' AND (f.name LIKE ? OR f.address LIKE ? OR f.city LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            if (service) {
                const cancerFilter = cancer_type === 'breast' ? " AND (sc.service_type LIKE '%breast%' OR sc.service_type = 'cancer_screening')"
                    : cancer_type === 'cervical' ? " AND (sc.service_type LIKE '%cervical%' OR sc.service_type = 'cancer_screening')" : '';
                query += ` AND EXISTS (SELECT 1 FROM service_claims sc WHERE sc.facility_id = f.id
                    AND sc.service_type LIKE ? AND ${VERIFIED_CLAIM}${cancerFilter})`;
                params.push(`%${service}%`);
            } else if (cancer_type) {
                const pattern = cancer_type === 'breast' ? '%breast%' : cancer_type === 'cervical' ? '%cervical%' : `%${cancer_type}%`;
                query += ` AND EXISTS (SELECT 1 FROM service_claims sc WHERE sc.facility_id = f.id
                    AND sc.service_type LIKE ? AND ${VERIFIED_CLAIM})`;
                params.push(pattern);
            }

            query += ' ORDER BY f.province ASC, f.name ASC';
            const rows = db.prepare(query).all(...params);
            return res.json(decorate(db, rows));
        } catch (err) { return next(err); }
    });

    app.get('/api/directory/providers/:id', (req, res, next) => {
        try {
            const facility = db.prepare(`
                SELECT f.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url,
                       sr.retrieved_at AS evidence_retrieved_at
                FROM facilities f
                LEFT JOIN source_registry sr ON f.evidence_id = sr.id
                WHERE f.id = ? AND ${PUBLISHED}
            `).get(req.params.id);
            if (!facility) return res.status(404).json({ error: 'NOT_FOUND', message: 'No published verified provider with this ID.' });
            const [provider] = decorate(db, [facility]);
            return res.json(provider);
        } catch (err) { return next(err); }
    });

    // ---- Screening providers (not events) ----
    app.get('/api/directory/screening', (req, res, next) => {
        try {
            const { province, city, cancer_type } = req.query;
            let query = `
                SELECT DISTINCT f.id, f.name, f.address, f.province, f.city, f.phone, f.email, f.website,
                       f.type, f.verification_status, f.verified_at, f.next_review_at,
                       f.services_summary, f.public_notes,
                       sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM facilities f
                LEFT JOIN source_registry sr ON f.evidence_id = sr.id
                JOIN service_claims sc ON sc.facility_id = f.id
                WHERE ${PUBLISHED} AND ${VERIFIED_CLAIM}
                  AND (sc.service_type LIKE '%screening%' OR sc.service_type IN ('cancer_awareness', 'cervical_screening', 'breast_screening'))
            `;
            const params = [];
            if (province) { query += ' AND f.province = ?'; params.push(province); }
            if (city) { query += ' AND f.city = ?'; params.push(city); }
            if (cancer_type === 'breast') {
                query += " AND sc.service_type LIKE '%breast%'";
            } else if (cancer_type === 'cervical') {
                query += " AND sc.service_type LIKE '%cervical%'";
            }
            query += ' ORDER BY f.province, f.name';
            const rows = db.prepare(query).all(...params);
            return res.json({
                providers: decorate(db, rows),
                message: rows.length === 0 ? NO_SCREENING_MESSAGE : null,
                publication_policy: 'Screening providers shown here advertise screening or have source-confirmed screening information. Current availability, days, eligibility and fees are NOT confirmed unless explicitly stated.',
            });
        } catch (err) { return next(err); }
    });

    // ---- Verified screening events ----
    app.get('/api/directory/campaigns', (req, res, next) => {
        try {
            const { province, city, cancer_type } = req.query;
            let query = `
                SELECT c.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM screening_campaigns c
                LEFT JOIN source_registry sr ON c.evidence_id = sr.id
                WHERE c.is_demo = 0
                  AND c.verification_status IN ('source_confirmed', 'directly_verified')
                  AND COALESCE(c.expiry_status, 'active') != 'expired'
                  AND c.date_end >= date('now')
                  AND c.evidence_id IS NOT NULL
            `;
            const params = [];
            if (province) { query += ' AND c.province = ?'; params.push(province); }
            if (city) { query += ' AND c.city = ?'; params.push(city); }
            if (cancer_type === 'breast') query += " AND c.service_type = 'breast_screening'";
            if (cancer_type === 'cervical') query += " AND c.service_type = 'cervical_screening'";
            query += ' ORDER BY c.date_start ASC';
            const campaigns = db.prepare(query).all(...params);
            return res.json({ campaigns, message: campaigns.length === 0 ? NO_SCREENING_MESSAGE : null });
        } catch (err) { return next(err); }
    });

    // ---- Support organisations ----
    app.get('/api/directory/support', (req, res, next) => {
        try {
            const { province, search, type } = req.query;
            let query = `
                SELECT s.*, sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM support_organisations s
                LEFT JOIN source_registry sr ON s.evidence_id = sr.id
                WHERE s.is_demo = 0 AND s.publication_status = 'published'
                  AND s.verification_status IN ('source_confirmed', 'directly_verified')
            `;
            const params = [];
            if (province) { query += ' AND s.province = ?'; params.push(province); }
            if (type) { query += ' AND s.organisation_type = ?'; params.push(type); }
            if (search) { query += ' AND (s.name LIKE ? OR s.services LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
            query += ' ORDER BY s.name';
            return res.json(db.prepare(query).all(...params));
        } catch (err) { return next(err); }
    });

    // ---- Radiotherapy status ----
    app.get('/api/directory/radiotherapy', (req, res, next) => {
        try {
            const { province, status } = req.query;
            let query = `
                SELECT m.id, m.facility_id, m.machine_type, m.equipment_description, m.installation_status,
                       m.commissioning_status, m.operational_status, m.last_reported_update,
                       m.last_directly_verified, m.verification_method, m.admin_notes,
                       m.public_contact_instructions, m.publication_status,
                       f.name AS facility_name, f.province, f.city, f.address, f.phone, f.email,
                       sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM radiotherapy_machines m
                JOIN facilities f ON m.facility_id = f.id
                LEFT JOIN source_registry sr ON m.evidence_id = sr.id
                WHERE m.is_demo = 0 AND m.publication_status = 'published'
                  AND f.is_demo = 0 AND f.publication_status = 'published'
            `;
            const params = [];
            if (province) { query += ' AND f.province = ?'; params.push(province); }
            if (status) { query += ' AND m.operational_status = ?'; params.push(status); }
            query += ' ORDER BY f.province, f.name';
            return res.json({
                machines: db.prepare(query).all(...params),
                notice: 'Please confirm current treatment availability directly with the facility before travelling. Status is based on dated reports and manual updates — it is not live equipment monitoring.',
            });
        } catch (err) { return next(err); }
    });

    // ---- Map (only reviewed coordinates) ----
    app.get('/api/directory/map', (req, res, next) => {
        try {
            const { province, city, service, cancer_type } = req.query;
            let query = `
                SELECT f.id, f.name, f.address, f.province, f.city, f.phone, f.website, f.type,
                       f.latitude, f.longitude, f.coordinate_source, f.coordinate_source_url,
                       f.verification_status, f.verified_at, f.services_summary
                FROM facilities f
                WHERE ${PUBLISHED} AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
            `;
            const params = [];
            if (province) { query += ' AND f.province = ?'; params.push(province); }
            if (city) { query += ' AND f.city = ?'; params.push(city); }
            const claims = service || cancer_type;
            if (claims) {
                query += ` AND EXISTS (SELECT 1 FROM service_claims sc WHERE sc.facility_id = f.id
                    AND sc.service_type LIKE ? AND ${VERIFIED_CLAIM})`;
                params.push(`%${claims}%`);
            }
            query += ' ORDER BY f.name';
            const markers = db.prepare(query).all(...params);
            return res.json({
                markers,
                list: markers,
                attribution: 'Map tiles and geocoding: © OpenStreetMap contributors (ODbL). Coordinates are approximate name matches, not verified entrances.',
                message: markers.length === 0
                    ? 'No verified facilities with reviewed coordinates are available for this filter. Use the list view instead.'
                    : null,
            });
        } catch (err) { return next(err); }
    });

    // ---- Summary / stats ----
    app.get('/api/directory/stats', (_req, res, next) => {
        try {
            const providers = db.prepare(`SELECT verification_status, COUNT(*) AS count FROM facilities
                WHERE is_demo = 0 AND publication_status = 'published' GROUP BY verification_status`).all();
            const byProvince = db.prepare(`SELECT f.province, COUNT(*) AS count FROM facilities f
                WHERE ${PUBLISHED} GROUP BY f.province ORDER BY f.province`).all();
            const totals = {
                providers: db.prepare(`SELECT COUNT(*) c FROM facilities f WHERE ${PUBLISHED}`).get().c,
                source_confirmed: db.prepare("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status = 'published' AND verification_status = 'source_confirmed'").get().c,
                directly_verified: db.prepare("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status = 'published' AND verification_status = 'directly_verified'").get().c,
                candidates: db.prepare("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status != 'published'").get().c,
                support_organisations: db.prepare("SELECT COUNT(*) c FROM support_organisations WHERE is_demo = 0 AND publication_status = 'published'").get().c,
                radiotherapy_machines: db.prepare("SELECT COUNT(*) c FROM radiotherapy_machines WHERE is_demo = 0 AND publication_status = 'published'").get().c,
                verified_campaigns: db.prepare("SELECT COUNT(*) c FROM screening_campaigns WHERE is_demo = 0 AND verification_status IN ('source_confirmed','directly_verified') AND date_end >= date('now')").get().c,
                verified_doctors: db.prepare("SELECT COUNT(*) c FROM doctors WHERE is_demo = 0 AND verified = 1").get().c,
            };
            return res.json({ totals, byVerification: providers, byProvince });
        } catch (err) { return next(err); }
    });

    // ---- Doctors (registered/verified only; demo isolated) ----
    app.get('/api/directory/doctors', (req, res, next) => {
        try {
            const { province, specialty, search } = req.query;
            let query = `
                SELECT d.id, d.specialty, d.province, d.city, d.verified, d.verification_date,
                       d.registration_source_url, d.registration_checked_at, d.accepting_patients,
                       u.name, f.name AS hospital_name
                FROM doctors d
                JOIN users u ON d.user_id = u.id
                LEFT JOIN facilities f ON d.hospital_id = f.id
                WHERE d.is_demo = 0 AND d.verified = 1 AND u.role = 'doctor'
            `;
            const params = [];
            if (province) { query += ' AND d.province = ?'; params.push(province); }
            if (specialty) { query += ' AND d.specialty LIKE ?'; params.push(`%${specialty}%`); }
            if (search) { query += ' AND u.name LIKE ?'; params.push(`%${search}%`); }
            query += ' ORDER BY u.name';
            const doctors = db.prepare(query).all(...params);
            return res.json({
                data: doctors,
                message: doctors.length === 0
                    ? 'No doctors with a recorded registration check are published yet. Registration is not an appointment agreement — contact the facility directly.'
                    : null,
            });
        } catch (err) { return next(err); }
    });
}
