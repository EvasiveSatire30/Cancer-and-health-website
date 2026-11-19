/**
 * Backend retrieval for the AI assistant.
 *
 * Gemini receives this data as authoritative context. The assistant may explain
 * it, but it must not add facilities that are not in the result set. Only
 * published, non-demo records with source or direct verification are returned.
 */

const PROVINCE_ALIASES = {
    harare: 'Harare',
    'chitungwiza': 'Harare',
    parirenyatwa: 'Harare',
    'sally mugabe': 'Harare',
    bulawayo: 'Bulawayo',
    mpilo: 'Bulawayo',
    mutare: 'Manicaland',
    manicaland: 'Manicaland',
    gweru: 'Midlands',
    midlands: 'Midlands',
    masvingo: 'Masvingo',
    'mashonaland central': 'Mashonaland Central',
    bindura: 'Mashonaland Central',
    'mashonaland east': 'Mashonaland East',
    marondera: 'Mashonaland East',
    'mashonaland west': 'Mashonaland West',
    chinhoyi: 'Mashonaland West',
    'matabeleland north': 'Matabeleland North',
    hwange: 'Matabeleland North',
    'matabeleland south': 'Matabeleland South',
    gwanda: 'Matabeleland South',
};

const NO_RESULTS = 'No currently verified provider matches this question in our published directory. Contact a local health facility for current availability.';

function detectProvince(text) {
    const lc = text.toLowerCase();
    for (const [alias, province] of Object.entries(PROVINCE_ALIASES)) {
        if (lc.includes(alias)) return province;
    }
    return null;
}

function detectIntent(text) {
    const lc = text.toLowerCase();
    if (lc.includes('book') || lc.includes('appointment') || lc.includes('schedule')) return 'booking';
    if (lc.includes('radiotherapy') || lc.includes('radiation') || lc.includes('linac') || lc.includes('machine')) return 'radiotherapy';
    if (lc.includes('support') || lc.includes('counselling') || lc.includes('palliative') || lc.includes('hospice')) return 'support';
    if (lc.includes('free') || lc.includes('cost') || lc.includes('price') || lc.includes('fee') || lc.includes('pay')) return 'cost';
    if (lc.includes('doctor') || lc.includes('oncologist') || lc.includes('specialist') || lc.includes('register')) return 'doctor';
    if (lc.includes('screen') || lc.includes('test') || lc.includes('pap') || lc.includes('hpv') || lc.includes('mammogram')) return 'screening';
    if (lc.includes('hospital') || lc.includes('clinic') || lc.includes('treatment') || lc.includes('centre') || lc.includes('center')) return 'facility';
    return 'general';
}

function serviceMatches(claim, cancerType) {
    if (!cancerType) return true;
    return claim.service_type.includes(cancerType) || claim.service_type === 'cancer_screening';
}

export function retrieveDirectory(db, message, contextText = '') {
    const lc = message.toLowerCase();
    const context = `${message} ${contextText}`.toLowerCase();
    const province = detectProvince(context);
    const wantsCost = lc.includes('free') || lc.includes('cost') || lc.includes('price') || lc.includes('fee') || lc.includes('pay');
    const screeningTopic = /screen|pap|hpv|mammogram|cervical|breast/.test(context);
    // Intent comes from the current message. Only a vague follow-up borrows the
    // intent of the previous user turn, so "Is it free?" cannot be mistaken for
    // a booking request mentioned earlier in the conversation.
    const currentIntent = detectIntent(message);
    const intentBase = currentIntent === 'general' ? detectIntent(contextText.slice(-600)) : currentIntent;
    const intent = intentBase === 'cost' && screeningTopic ? 'screening' : intentBase;
    const cancerType = context.includes('breast') ? 'breast'
        : context.includes('cervical') || context.includes('hpv') ? 'cervical' : null;

    const records = [];
    let text = '';

    if (intent === 'doctor') {
        const doctors = db.prepare(`
            SELECT d.id, d.specialty, d.province, d.city, d.verified, d.accepting_patients, u.name, f.name AS hospital_name
            FROM doctors d JOIN users u ON d.user_id = u.id LEFT JOIN facilities f ON d.hospital_id = f.id
            WHERE d.is_demo = 0 AND d.verified = 1
            ${province ? 'AND d.province = ?' : ''}
            ORDER BY u.name LIMIT 25
        `).all(...(province ? [province] : []));
        records.push(...doctors.map((d) => ({ kind: 'doctor', ...d })));
        text = doctors.length
            ? `VERIFIED DOCTORS (registration checked):\n${doctors.map((d) => `- ${d.name} — ${d.specialty} — ${d.city || d.province} — ${d.hospital_name || 'facility not listed'} — accepting patients: ${d.accepting_patients === 1 ? 'confirmed' : 'not confirmed'}`).join('\n')}`
            : 'VERIFIED DOCTORS: none published. Registration is not an appointment agreement.';
    } else if (intent === 'support' || intent === 'cost') {
        const orgs = db.prepare(`
            SELECT s.id, s.name, s.organisation_type, s.description, s.services, s.province, s.city, s.website,
                   s.verification_status, sr.source_url AS evidence_url
            FROM support_organisations s LEFT JOIN source_registry sr ON s.evidence_id = sr.id
            WHERE s.is_demo = 0 AND s.publication_status = 'published'
              AND s.verification_status IN ('source_confirmed','directly_verified')
            ${province ? 'AND s.province = ?' : ''}
            ORDER BY s.name LIMIT 20
        `).all(...(province ? [province] : []));
        records.push(...orgs.map((o) => ({ kind: 'support_organisation', ...o })));
        text = orgs.length
            ? `VERIFIED SUPPORT ORGANISATIONS (services, not guaranteed funding):\n${orgs.map((o) => `- ${o.name} — ${o.services || o.description} — ${o.city || o.province || 'Zimbabwe'} — ${o.website || 'contact via directory'} — evidence: ${o.evidence_url}`).join('\n')}`
            : 'VERIFIED SUPPORT ORGANISATIONS: none match this query.';
        if (intent === 'cost') {
            text += '\nCOST POLICY: CancerCare Zimbabwe does not hold verified current prices for these services. Say explicitly that cost is not confirmed and advise contacting the provider.';
        }
    } else if (intent === 'radiotherapy') {
        const machines = db.prepare(`
            SELECT m.id, m.machine_type, m.operational_status, m.commissioning_status, m.last_reported_update,
                   m.last_directly_verified, m.admin_notes, m.public_contact_instructions,
                   f.name AS facility_name, f.province, f.city, f.phone,
                   sr.source_url AS evidence_url
            FROM radiotherapy_machines m JOIN facilities f ON m.facility_id = f.id
            LEFT JOIN source_registry sr ON m.evidence_id = sr.id
            WHERE m.is_demo = 0 AND m.publication_status = 'published'
              AND f.is_demo = 0 AND f.publication_status = 'published'
            ${province ? 'AND f.province = ?' : ''}
            ORDER BY f.name
        `).all(...(province ? [province] : []));
        records.push(...machines.map((m) => ({ kind: 'radiotherapy_machine', ...m })));
        text = machines.length
            ? `RADIOTHERAPY STATUS (dated reports; not live monitoring):\n${machines.map((m) => `- ${m.facility_name} (${m.city}, ${m.province}) — ${m.machine_type} — operational status: ${m.operational_status} — commissioning: ${m.commissioning_status} — last reported: ${m.last_reported_update || 'unknown'} — last directly verified: ${m.last_directly_verified || 'never'} — evidence: ${m.evidence_url}`).join('\n')}`
            : 'RADIOTHERAPY STATUS: no published machine records match this query.';
        text += '\nNever describe a machine as operational unless operational_status is exactly "operational" AND last_directly_verified is present. Installed/tested/commissioning are not operational.';
    } else if (intent === 'booking') {
        const providers = db.prepare(`
            SELECT f.id, f.name, f.province, f.city, f.phone, f.website, f.services_summary,
                   sr.source_url AS evidence_url
            FROM facilities f LEFT JOIN source_registry sr ON f.evidence_id = sr.id
            WHERE f.is_demo = 0 AND f.publication_status = 'published'
              AND f.verification_status IN ('source_confirmed','directly_verified')
            ${province ? 'AND f.province = ?' : ''}
            ORDER BY f.name LIMIT 10
        `).all(...(province ? [province] : []));
        records.push(...providers.map((p) => ({ kind: 'facility', ...p })));
        text = `BOOKING: CancerCare Zimbabwe has no confirmed appointment integration with these providers. Do not invent slots. Provide the provider's official phone/website from this data and explain that the patient must contact them directly.\n`
            + (providers.length ? providers.map((p) => `- ${p.name} — ${p.city}, ${p.province} — phone: ${p.phone || 'not verified'} — website: ${p.website || 'not verified'} — evidence: ${p.evidence_url}`).join('\n') : NO_RESULTS);
    } else if (intent === 'screening') {
        const providers = db.prepare(`
            SELECT DISTINCT f.id, f.name, f.province, f.city, f.type, f.verification_status, f.verified_at,
                   f.services_summary, f.phone, f.website, sr.source_url AS evidence_url
            FROM facilities f
            LEFT JOIN source_registry sr ON f.evidence_id = sr.id
            JOIN service_claims sc ON sc.facility_id = f.id
            WHERE f.is_demo = 0 AND f.publication_status = 'published'
              AND f.verification_status IN ('source_confirmed','directly_verified')
              AND sc.verification_method IN ('source_confirmed','directly_verified')
              AND sc.service_type LIKE '%screening%'
            ${province ? 'AND f.province = ?' : ''}
            ORDER BY f.province, f.name LIMIT 20
        `).all(...(province ? [province] : [])).filter((p) => !cancerType || p.services_summary?.toLowerCase().includes(cancerType) || true);

        const claims = db.prepare(`
            SELECT sc.facility_id, sc.service_type, sc.availability_status, sc.fee_status, sc.last_confirmed_at,
                   sr.source_url AS evidence_url
            FROM service_claims sc LEFT JOIN source_registry sr ON sc.evidence_id = sr.id
            WHERE sc.verification_method IN ('source_confirmed','directly_verified') AND sc.service_type LIKE '%screening%'
        `).all();
        const matchingProviders = cancerType
            ? providers.filter((p) => claims.some((c) => c.facility_id === p.id && serviceMatches(c, cancerType)))
            : providers;

        const campaigns = db.prepare(`
            SELECT c.id, c.organization_name, c.service_type, c.location, c.province, c.city,
                   c.date_start, c.date_end, c.is_free, c.verification_status, sr.source_url AS evidence_url
            FROM screening_campaigns c LEFT JOIN source_registry sr ON c.evidence_id = sr.id
            WHERE c.is_demo = 0 AND c.verification_status IN ('source_confirmed','directly_verified')
              AND COALESCE(c.expiry_status,'active') != 'expired' AND c.date_end >= date('now')
            ${province ? 'AND c.province = ?' : ''}
            ORDER BY c.date_start LIMIT 10
        `).all(...(province ? [province] : []));

        records.push(...matchingProviders.map((p) => ({
            kind: 'screening_provider',
            ...p,
            services: claims.filter((c) => c.facility_id === p.id).filter((c) => serviceMatches(c, cancerType)),
        })));
        records.push(...campaigns.map((c) => ({ kind: 'screening_campaign', ...c })));

        text = matchingProviders.length
            ? `VERIFIED SCREENING PROVIDERS${province ? ` IN ${province.toUpperCase()}` : ''}:\n${matchingProviders.map((p) => `- ${p.name} — ${p.city}, ${p.province} — ${p.services_summary || 'screening advertised'} — availability: NOT confirmed — fee: NOT confirmed — evidence: ${p.evidence_url}`).join('\n')}`
            : `VERIFIED SCREENING PROVIDERS: none published for this location.`;
        text += campaigns.length
            ? `\nVERIFIED UPCOMING SCREENING EVENTS:\n${campaigns.map((c) => `- ${c.organization_name} — ${c.service_type} — ${c.location} — ${c.date_start} to ${c.date_end} — free: ${c.is_free ? 'yes (as published)' : 'not confirmed'} — evidence: ${c.evidence_url}`).join('\n')}`
            : `\nVERIFIED UPCOMING SCREENING EVENTS: ${NO_RESULTS}`;
        text += '\nScreening providers are not the same as confirmed free events. Do not say screening is free unless a verified campaign explicitly says so.';
        if (wantsCost) {
            text += '\nCOST: No current verified price is held for these screening services. Say the cost is NOT confirmed and advise contacting the provider.';
        }
    } else {
        const providers = db.prepare(`
            SELECT f.id, f.name, f.province, f.city, f.type, f.verification_status, f.verified_at,
                   f.services_summary, f.phone, f.website, sr.source_url AS evidence_url
            FROM facilities f LEFT JOIN source_registry sr ON f.evidence_id = sr.id
            WHERE f.is_demo = 0 AND f.publication_status = 'published'
              AND f.verification_status IN ('source_confirmed','directly_verified')
            ${province ? 'AND f.province = ?' : ''}
            ORDER BY f.province, f.name LIMIT 20
        `).all(...(province ? [province] : []));
        records.push(...providers.map((p) => ({ kind: 'facility', ...p })));
        text = providers.length
            ? `VERIFIED PROVIDERS${province ? ` IN ${province.toUpperCase()}` : ''}:\n${providers.map((p) => `- ${p.name} — ${p.city}, ${p.province} — ${p.type.replace(/_/g, ' ')} — ${p.services_summary || 'services not individually confirmed'} — evidence: ${p.evidence_url}`).join('\n')}`
            : NO_RESULTS;
    }

    return { intent, province, cancer_type: cancerType, records, text };
}

export default retrieveDirectory;
