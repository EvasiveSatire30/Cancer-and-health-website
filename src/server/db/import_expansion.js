/**
 * Phase 5 data expansion — sourced 19 November 2026.
 *
 * Adds:
 *   - City of Harare polyclinics with VIAC cervical screening (explicitly
 *     described on the City's council-health-facilities page).
 *   - Bulawayo City Council clinics as UNPUBLISHED candidates (the council
 *     publishes clinic names and phone numbers, not cancer services).
 *   - Provincial / mission hospitals confirmed on the HPA registered-facility
 *     list, published as IDENTITY-ONLY records (no oncology claims).
 *   - ZNFPC / PSZ service points as candidates.
 *   - Additional support organisations and unreviewed medical knowledge drafts.
 *
 * Nothing here fabricates services, fees, events or equipment status.
 * Run: npm run import:expand
 */

import initDatabase from './database.js';
import {
    registerSource, stageProviderCandidates, stageSupportOrganisation,
    stageKnowledge, ensureReviewSchedule,
} from '../lib/importPipeline.js';

const db = initDatabase();

const today = new Date().toISOString().slice(0, 10);
const review90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

const sources = {
    harareCity: registerSource(db, {
        organisation: 'City of Harare',
        source_url: 'https://www.hararecity.co.zw/services/about/council-health-facilities',
        source_type: 'municipal', authority_level: 'authoritative',
        licence: 'Municipal public information; reuse licence not stated',
        notes: 'Council health facilities. Explicitly lists VIAC cervical screening at all polyclinics and selected clinics (Mbare Polyclinic, Warren Park, Genito/Wilkins).',
    }),
    bulawayoCity: registerSource(db, {
        organisation: 'Bulawayo City Council',
        source_url: 'https://www.citybyo.co.zw/Entities/Clinics',
        source_type: 'municipal', authority_level: 'authoritative',
        licence: 'Municipal public information; reuse licence not stated',
        notes: 'Council clinic names and telephone numbers only. The page does not state cancer screening services.',
    }),
    hpa: registerSource(db, {
        organisation: 'Health Professions Authority of Zimbabwe',
        source_url: 'https://hpa.co.zw/registered-facilities/',
        source_type: 'government', authority_level: 'authoritative',
        licence: 'Public register page; bulk reuse permission not established',
        notes: 'Registered healthcare facilities with physical addresses. Registration does not establish oncology or radiotherapy services.',
    }),
    znfpc: registerSource(db, {
        organisation: 'Zimbabwe National Family Planning Council',
        source_url: 'https://www.znfpc.org.zw/family-planning-reproductive-health-services/',
        source_type: 'government', authority_level: 'authoritative',
        licence: 'Public service information; reuse licence not stated',
        notes: 'Organisation-level page lists Cervical Cancer Screening and Breast Cancer Screening. Site-level availability is not stated.',
    }),
    cancerzim: registerSource(db, {
        organisation: 'Cancer Association of Zimbabwe',
        source_url: 'https://cancerzimbabwe.org/care_services',
        source_type: 'ngo', authority_level: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Care services page states free breast physical examinations by appointment or walk-in, free consultations, breast-care education and referrals.',
    }),
    psz: registerSource(db, {
        organisation: 'Population Services Zimbabwe (Marie Stopes Zimbabwe)',
        source_url: 'https://www.pszim.com/help-advice/what-is-cervical-cancer-screening/',
        source_type: 'ngo', authority_level: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Cervical screening information and clinic network. Fees and current availability are not stated.',
    }),
    cancerserve: registerSource(db, {
        organisation: 'CancerServe Zimbabwe',
        source_url: 'https://cancerserve.org/',
        source_type: 'ngo', authority_level: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Describes awareness, patient support and financial need as a barrier to treatment. No current funding programme terms are published.',
    }),
    kidzcan: registerSource(db, {
        organisation: 'KidzCan Zimbabwe',
        source_url: 'https://kidzcanzimbabwe.org/our-services/',
        source_type: 'ngo', authority_level: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Childhood cancer medical assistance and family support. Not an adult breast/cervical service.',
    }),
    island: registerSource(db, {
        organisation: 'Island Hospice & Healthcare',
        source_url: 'https://islandhospice.co.zw/palliative-care/',
        source_type: 'ngo', authority_level: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Palliative care, walk-in clinics, home-based care and counselling. Contact: admin@islandhospice.co.zw.',
    }),
    hospaz: registerSource(db, {
        organisation: 'Hospice and Palliative Care Association of Zimbabwe',
        source_url: 'https://hospaz.co.zw/',
        source_type: 'ngo', authority_level: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'National palliative care network with member organisations and referral information. Not a treatment funder.',
    }),
    psh: registerSource(db, {
        organisation: 'Population Solutions for Health',
        source_url: 'https://psh.org.zw/',
        source_type: 'ngo', authority_level: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Programme-level description of cervical cancer screening and treatment. Programme support does not prove clinic-level operation.',
    }),
    whoBreast: registerSource(db, {
        organisation: 'World Health Organization',
        source_url: 'https://www.who.int/news-room/fact-sheets/detail/breast-cancer',
        source_type: 'academic', authority_level: 'authoritative',
        licence: 'WHO fact sheet — CC BY-NC-SA 3.0 IGO (attribution; no bulk copying)',
        notes: 'Breast cancer awareness, symptoms, screening and treatment overview.',
    }),
    whoCervical: registerSource(db, {
        organisation: 'World Health Organization',
        source_url: 'https://www.who.int/news-room/fact-sheets/detail/cervical-cancer',
        source_type: 'academic', authority_level: 'authoritative',
        licence: 'WHO fact sheet — CC BY-NC-SA 3.0 IGO (attribution; no bulk copying)',
        notes: 'Cervical cancer, HPV, vaccination and screening overview.',
    }),
    iarc: registerSource(db, {
        organisation: 'International Agency for Research on Cancer',
        source_url: 'https://www.iarc.who.int/cancer-type/cervical-cancer',
        source_type: 'academic', authority_level: 'authoritative',
        licence: 'IARC/WHO content; reuse terms must be checked before republication',
        notes: 'Cervical cancer evidence and HPV attribution.',
    }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function upsertProvider(p) {
    const existing = db.prepare('SELECT * FROM facilities WHERE lower(trim(name)) = lower(trim(?)) AND province = ?')
        .get(p.name, p.province);
    const id = existing?.id;
    if (id) {
        db.prepare(`
            UPDATE facilities SET address = ?, city = ?, phone = COALESCE(?, phone), email = COALESCE(?, email),
                website = COALESCE(?, website), evidence_id = COALESCE(?, evidence_id),
                latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
                coordinate_source = COALESCE(?, coordinate_source),
                coordinate_source_url = COALESCE(?, coordinate_source_url),
                coordinate_review_status = COALESCE(?, coordinate_review_status),
                services_summary = ?, public_notes = ?, is_demo = 0, status = 'status_unknown',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(p.address, p.city, p.phone || null, p.email || null, p.website || null, p.evidenceId || null,
            p.latitude ?? null, p.longitude ?? null, p.coordinateSource || null, p.coordinateSourceUrl || null,
            p.coordinateReview || null, p.summary || null, p.notes || null, id);
        return id;
    }
    const info = db.prepare(`
        INSERT INTO facilities (name, address, province, city, type, classification, phone, email, website,
            evidence_id, latitude, longitude, coordinate_source, coordinate_source_url, coordinate_review_status,
            services_summary, public_notes, verification_status, publication_status, is_demo, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', 'draft', 0, 'status_unknown')
    `).run(p.name, p.address, p.province, p.city, p.type, p.classification || 'public',
        p.phone || null, p.email || null, p.website || null, p.evidenceId || null,
        p.latitude ?? null, p.longitude ?? null, p.coordinateSource || null,
        p.coordinateSourceUrl || null, p.coordinateReview || 'unreviewed', p.summary || null, p.notes || null);
    return Number(info.lastInsertRowid);
}

function publishIdentityOnly(id, evidenceId, notes) {
    db.prepare(`
        UPDATE facilities SET verification_status = 'source_confirmed', publication_status = 'published',
            verified_at = ?, next_review_at = ?, public_notes = COALESCE(?, public_notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(today, review90, notes || null, id);
}

function upsertClaim(facilityId, serviceType, evidenceId, method, availability, fee, notes) {
    db.prepare(`
        INSERT INTO service_claims (facility_id, service_type, evidence_id, verification_method,
            availability_status, fee_status, notes, last_confirmed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(facility_id, service_type) DO UPDATE SET
            evidence_id = excluded.evidence_id, verification_method = excluded.verification_method,
            availability_status = excluded.availability_status, fee_status = excluded.fee_status,
            notes = excluded.notes, last_confirmed_at = excluded.last_confirmed_at,
            updated_at = CURRENT_TIMESTAMP
    `).run(facilityId, serviceType, evidenceId || null, method, availability, fee, notes || null);
}

const IDENTITY_ONLY = 'Only facility identity and address are source-confirmed. Oncology, screening, treatment and fee availability have NOT been verified — contact the facility.';

// ---------------------------------------------------------------------------
// City of Harare polyclinics — the City explicitly lists VIAC at all polyclinics
// ---------------------------------------------------------------------------

const hararePolyclinics = [
    ['Glen View Polyclinic', '9446 Patrenda Way, Glen View', '04 690 164'],
    ['Highfield Polyclinic', '3363 Jabavu Drive, Highfield', '04 662 304'],
    ['Kambuzuma Polyclinic', '2469 Kambuzuma Drive, Kambuzuma', '04 227 703 / 04 227 732'],
    ['Mabvuku Polyclinic', 'Manresa Way, Mabvuku', '04 491 068'],
    ['Mbare Polyclinic', 'Off Ardbenie Road, Mbare', '04 793 175'],
    ['Rujeko Polyclinic', '1507 Rujeko Street, Dzivarasekwa', '04 216 390'],
    ['Rutsanana Polyclinic', '7505 Tawaziwa Way, Glen Norah', '04 611 528'],
    ['Kuwadzana Polyclinic', '8216 56 Crescent, Kuwadzana', '04 210 063 / 04 210 464'],
    ['Hatcliffe Polyclinic', '1064 1st Street, Hatcliffe', '04 860 562'],
    ['Budiriro Polyclinic', '684 5th Road, Budiriro', '04 690 019'],
    ['Warren Park Polyclinic', '3rd Avenue, Warren Park', '04 224 953'],
];

for (const [name, address, phone] of hararePolyclinics) {
    const id = upsertProvider({
        name, address, province: 'Harare', city: 'Harare',
        type: 'general_clinic', classification: 'public', phone,
        website: 'https://www.hararecity.co.zw/services/about/council-health-facilities',
        evidenceId: sources.harareCity,
        summary: 'City of Harare polyclinic. The City lists VIAC cervical screening at all polyclinics. Current screening days, eligibility, staffing and fees are NOT confirmed.',
        notes: 'Published source explicitly names all polyclinics for VIAC. Availability and fee remain unknown until directly confirmed.',
    });
    publishIdentityOnly(id, sources.harareCity, 'Screening days, eligibility and fees are not confirmed by the City source.');
    upsertClaim(id, 'cervical_screening', sources.harareCity, 'source_confirmed', 'unknown', 'unknown',
        'City of Harare lists VIAC cervical screening at all polyclinics. Current availability and fee are unconfirmed.');
    ensureReviewSchedule(db, 'facility', id, 90, 'data-team', 'Municipal screening clinic re-check');
}

// Selected clinic explicitly named for VIAC (Genito service at Wilkins Hospital)
const wilkinsId = upsertProvider({
    name: 'Wilkins Hospital (Genito Clinic)', address: 'Princess Road, Belvedere', province: 'Harare', city: 'Harare',
    type: 'general_clinic', classification: 'public', phone: '04 740 404 / 04 740 517',
    website: 'https://www.hararecity.co.zw/services/about/council-health-facilities',
    evidenceId: sources.harareCity,
    summary: 'City of Harare infectious-diseases hospital listed for selected VIAC cervical screening. Current service availability is NOT confirmed.',
    notes: 'Named as a selected clinic for VIAC on the City page. Confirm current service with the clinic.',
});
publishIdentityOnly(wilkinsId, sources.harareCity, 'Confirm current VIAC service directly.');
upsertClaim(wilkinsId, 'cervical_screening', sources.harareCity, 'source_confirmed', 'unknown', 'unknown',
    'Named as a selected VIAC clinic by the City of Harare. Availability unconfirmed.');
ensureReviewSchedule(db, 'facility', wilkinsId, 90, 'data-team', 'Municipal screening clinic re-check');

// ---------------------------------------------------------------------------
// Cancer Association of Zimbabwe — published free breast physical examination
// ---------------------------------------------------------------------------

const cazId = upsertProvider({
    name: 'Cancer Association of Zimbabwe', address: 'Harare', province: 'Harare', city: 'Harare',
    type: 'screening_clinic', classification: 'private', website: 'https://cancerzimbabwe.org/',
    email: 'secretary@cancer.co.zw', evidenceId: sources.cancerzim,
    summary: 'Cancer awareness, counselling and patient support. The organisation publishes free breast physical examinations by appointment or walk-in, with referrals. Current clinic hours and availability are NOT confirmed.',
    notes: 'Published free service statement retained with availability unknown. No free screening event is implied.',
});
publishIdentityOnly(cazId, sources.cancerzim, 'The organisation publishes free breast examinations; confirm current hours and eligibility directly.');
upsertClaim(cazId, 'breast_screening', sources.cancerzim, 'source_confirmed', 'unknown', 'free',
    'Care services page states free breast physical examinations by appointment or walk-in. Current availability unconfirmed.');
upsertClaim(cazId, 'cancer_awareness', sources.cancerzim, 'source_confirmed', 'unknown', 'unknown', 'Awareness and education described.');
upsertClaim(cazId, 'counselling', sources.cancerzim, 'source_confirmed', 'unknown', 'unknown', 'Counselling and support described.');
ensureReviewSchedule(db, 'facility', cazId, 90, 'data-team', 'NGO service re-check');

// ---------------------------------------------------------------------------
// HPA-registered facilities — identity and address only
// ---------------------------------------------------------------------------

const hpaFacilities = [
    ['Parirenyatwa Group of Hospitals', 'Mazowe Street, Belgravia', 'Harare', 'Harare'],
    ['Sally Mugabe Central Hospital', 'Corner Lobengula & Highfield Roads', 'Harare', 'Harare'],
    ['Chitungwiza Central Hospital', '12096 Batanai Street, Zengeza 4', 'Harare', 'Chitungwiza'],
    ['Mpilo Central Hospital', 'Vera Road, Mzilikazi', 'Bulawayo', 'Bulawayo'],
    ['United Bulawayo Hospitals', '2 St Lukes Avenue, Ascot', 'Bulawayo', 'Bulawayo'],
    ['Gweru Provincial Hospital', '135 Shurugwi Road', 'Midlands', 'Gweru'],
    ['Kadoma General Hospital', 'Kaguvi Road', 'Midlands', 'Kadoma'],
    ['Mutare Provincial Hospital', '19 Robert Mugabe Road', 'Manicaland', 'Mutare'],
    ['Bindura Provincial Hospital', 'Cnr Greenhill Road / Matepatepa Road', 'Mashonaland Central', 'Bindura'],
    ['Marondera Provincial Hospital', 'Stand 190, 4th Street, Winston Park', 'Mashonaland East', 'Marondera'],
    ['Chinhoyi Provincial Hospital', 'No. 1 Shandore Road', 'Mashonaland West', 'Chinhoyi'],
    ['Masvingo Provincial Hospital', '75 Hay Robertson Street', 'Masvingo', 'Masvingo'],
    ['St Patricks Mission Hospital - Hwange', '705 Chibondo', 'Matabeleland North', 'Hwange'],
    ["St Luke's Mission Hospital", '46 Kenmaur, Lupane', 'Matabeleland North', 'Lupane'],
    ['Beitbridge District Hospital', '175 Dulivhadzimu', 'Matabeleland South', 'Beitbridge'],
];

for (const [name, address, province, city] of hpaFacilities) {
    const id = upsertProvider({
        name, address, province, city,
        type: 'public_hospital', classification: 'public', evidenceId: sources.hpa,
        summary: IDENTITY_ONLY,
        notes: 'Registered facility identity and address from the HPA registered-facilities list. No cancer service claim is made.',
    });
    publishIdentityOnly(id, sources.hpa, 'Facility registration and address confirmed; oncology services are not asserted.');
    ensureReviewSchedule(db, 'facility', id, 90, 'data-team', 'Facility contact re-check');
}

// ---------------------------------------------------------------------------
// Candidate facilities — staged, never published
// ---------------------------------------------------------------------------

const candidateFacilities = [
    // ZNFPC service points (organisation-level screening; site-level unconfirmed)
    {
        name: 'ZNFPC Lister House Clinic', address: '88A Lister House, Bulawayo', province: 'Bulawayo', city: 'Bulawayo',
        type: 'screening_clinic', classification: 'public', evidenceId: sources.znfpc,
        summary: 'ZNFPC service point. ZNFPC lists breast and cervical cancer screening at organisation level; this site’s current services, days and fees are unconfirmed.',
        notes: 'Candidate — requires direct ZNFPC confirmation before publication.',
    },
    {
        name: 'ZNFPC Mpilo Clinic', address: 'Mpilo Hospital Grounds, Old Falls Road / Vera Road, Mzilikazi', province: 'Bulawayo', city: 'Bulawayo',
        type: 'screening_clinic', classification: 'public', evidenceId: sources.znfpc,
        summary: 'ZNFPC service point on the Mpilo hospital grounds. Site-level screening availability is unconfirmed.',
        notes: 'Candidate — requires direct ZNFPC confirmation before publication.',
    },
    // PSZ service point
    {
        name: 'Population Services Zimbabwe — Chitungwiza Centre', address: '190/191 Mharapara Road, Unit F, Chitungwiza', province: 'Harare', city: 'Chitungwiza',
        type: 'screening_clinic', classification: 'private', evidenceId: sources.psz,
        summary: 'PSZ/Marie Stopes service point. Cervical screening is described at organisation level; this site’s fees and current availability are unconfirmed.',
        notes: 'Candidate — requires direct PSZ confirmation.',
    },
    // Hwange candidate (registered clinic, no oncology claim)
    {
        name: 'Hwange Colliery Hospital', address: '1 Hospital Road, Hwange', province: 'Matabeleland North', city: 'Hwange',
        type: 'private_hospital', classification: 'private', evidenceId: sources.hpa,
        summary: 'Registered facility identity only. Oncology and radiotherapy services are NOT verified.',
        notes: 'Candidate — registration record does not establish cancer services.',
    },
];

const candidateResult = stageProviderCandidates(db, {
    sourceId: sources.hpa,
    sourceAuthority: 'authoritative',
    records: candidateFacilities.map((c) => ({
        ...c,
        phone: c.phone || null,
        evidence_url: c.evidenceId ? db.prepare('SELECT source_url FROM source_registry WHERE id = ?').get(c.evidenceId)?.source_url : null,
    })),
});
// Re-point each staged candidate at its correct evidence source.
for (const c of candidateFacilities) {
    db.prepare(`UPDATE facilities SET evidence_id = ? WHERE lower(trim(name)) = lower(trim(?)) AND province = ?`)
        .run(c.evidenceId, c.name, c.province);
}

// ---------------------------------------------------------------------------
// Bulawayo City Council clinics — candidate records, no service claims
// ---------------------------------------------------------------------------

const bulawayoCouncilClinics = [
    ['Tshabalala Clinic', '480861'], ['Pelandaba Clinic', '412461'], ['Magwegwe Clinic', '427589'],
    ['Pumula Clinic', '429080'], ['Luveve Clinic', '520505 / 520200'], ['Njube Clinic', '419429'],
    ['E. F. Watson / Mpopoma Clinic', '404214'], ['Mzilikazi Clinic', '202829'],
    ['P. M. R. (Princess Margaret Rose) Clinic', '60785'], ['Khami Road Clinic', '63207 / 61137'],
    ['Dr. Shennan Clinic', '479209'], ['Nkulumane Clinic', '484152'], ['Entumbane Clinic', '419809 / 416276'],
    ['Emakhandeni Clinic', '521677 / 521678'], ['Nketa Clinic', '462315'], ['Pumula South Clinic', '422395'],
    ['Lobengula Clinic', null], ['Mahatshula Clinic', null], ['Cowdray Park Clinic', '521306'],
    ['Northern Suburbs Clinic', '201960 / 203260'],
];

const bulawayoResult = stageProviderCandidates(db, {
    sourceId: sources.bulawayoCity,
    sourceAuthority: 'authoritative',
    records: bulawayoCouncilClinics.map(([name, phone]) => ({
        name,
        address: 'Bulawayo (street address not published on the council clinic list)',
        province: 'Bulawayo', city: 'Bulawayo', type: 'general_clinic', classification: 'public',
        phone,
        services_summary: 'Municipal primary-care clinic. Cancer screening services are NOT stated by the council source.',
        notes: phone ? 'Candidate clinic. Confirm services and screening availability directly.'
            : 'Candidate clinic. Council lists this clinic but notes its telephone is not yet installed.',
    })),
});

// Superseded aggregate record — keep it archived for provenance, not published.
db.prepare(`
    UPDATE facilities SET publication_status = 'archived',
        public_notes = 'Superseded by individual Bulawayo council clinic records.',
        updated_at = CURRENT_TIMESTAMP
    WHERE name = 'Bulawayo City Council Clinics'
`).run();

// ---------------------------------------------------------------------------
// Support organisations
// ---------------------------------------------------------------------------

const supportOrgs = [
    {
        name: 'Cancer Association of Zimbabwe', organisation_type: 'ngo',
        description: 'Cancer awareness, counselling, patient support and breast-care services. Publishes free breast physical examinations by appointment or walk-in.',
        services: 'Awareness; counselling; breast-care education; free breast physical examination (published); referrals; breast prosthesis fitting',
        province: 'Harare', city: 'Harare', email: 'secretary@cancer.co.zw',
        website: 'https://cancerzimbabwe.org/care_services', sourceId: sources.cancerzim,
        notes: 'No funding programme is promised. Confirm current clinic hours directly.',
    },
    {
        name: 'Zimbabwe National Family Planning Council (ZNFPC)', organisation_type: 'government',
        description: 'National family-planning and reproductive-health provider that publicly lists breast and cervical cancer screening among its services.',
        services: 'Breast screening information; cervical screening information; reproductive health services',
        province: 'Harare', city: 'Harare', address: 'ZNFPC Spilhaus Centre, 1 Swissway, Southerton',
        phone: '(024) 2661584 / 2620281-5', email: 'pr@znfpc.org.zw',
        website: 'https://www.znfpc.org.zw/family-planning-reproductive-health-services/', sourceId: sources.znfpc,
        notes: 'Organisation-level service list. Not every service point offers identical services.',
    },
    {
        name: 'Population Services Zimbabwe (Marie Stopes Zimbabwe)', organisation_type: 'ngo',
        description: 'Sexual and reproductive health provider publishing cervical cancer screening information and a clinic network.',
        services: 'Cervical screening information; sexual and reproductive health services; referrals',
        province: 'Harare', city: 'Harare', website: 'https://www.pszim.com/',
        sourceId: sources.psz, notes: 'Fees and current site availability are not confirmed.',
    },
    {
        name: 'CancerServe Zimbabwe', organisation_type: 'ngo',
        description: 'Cancer awareness and patient support. Describes financial need as a barrier to treatment but publishes no current funding terms.',
        services: 'Awareness; patient support; resources; screening outreach information',
        province: 'Harare', city: 'Harare', website: 'https://cancerserve.org/',
        sourceId: sources.cancerserve, notes: 'Support organisation — not a confirmed source of treatment funding.',
    },
    {
        name: 'KidzCan Zimbabwe', organisation_type: 'ngo',
        description: 'Childhood cancer medical assistance, family support and referrals. Distinct from adult breast and cervical cancer services.',
        services: 'Childhood cancer medical assistance; family support; referrals; awareness',
        province: 'Harare', city: 'Harare', website: 'https://kidzcanzimbabwe.org/our-services/',
        sourceId: sources.kidzcan, notes: 'Paediatric focus. Not an adult screening provider.',
    },
    {
        name: 'Island Hospice & Healthcare', organisation_type: 'ngo',
        description: 'Palliative care, walk-in clinics, home-based care, emotional support and counselling.',
        services: 'Palliative care; home-based care; counselling; support groups; walk-in clinics',
        province: 'Harare', city: 'Harare', email: 'admin@islandhospice.co.zw',
        website: 'https://islandhospice.co.zw/palliative-care/',
        sourceId: sources.island, notes: 'Palliative and support services; not cancer treatment funding.',
    },
    {
        name: 'Hospice and Palliative Care Association of Zimbabwe (HOSPAZ)', organisation_type: 'network',
        description: 'National palliative care network with member organisations and referral information.',
        services: 'Palliative care network; referrals; member organisations; training',
        province: 'Harare', city: 'Harare', website: 'https://hospaz.co.zw/',
        sourceId: sources.hospaz, notes: 'Network and referral body; not a treatment funder.',
    },
    {
        name: 'Population Solutions for Health', organisation_type: 'ngo',
        description: 'Describes integrated clinical services including cervical cancer screening and treatment at programme level.',
        services: 'Cervical screening programme support; referral information',
        province: 'Harare', city: 'Harare', website: 'https://psh.org.zw/',
        sourceId: sources.psh, notes: 'Programme support only; clinic-level availability unconfirmed.',
    },
];

const supportIds = {};
for (const org of supportOrgs) {
    const r = stageSupportOrganisation(db, {
        sourceId: org.sourceId, actorId: null,
        record: { ...org, evidence_notes: org.notes },
    });
    supportIds[org.name] = r.id;
    // The organisations below publish the services themselves, so the record is
    // source-confirmed. Funding is never implied.
    db.prepare(`
        UPDATE support_organisations SET verification_status = 'source_confirmed', publication_status = 'published',
            verified_at = ?, next_review_at = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(today, review90, r.id);
    ensureReviewSchedule(db, 'support_organisation', r.id, 90, 'data-team', 'Support organisation re-check');
}

// Existing published support rows keep their verification; ensure schedule exists.
for (const row of db.prepare("SELECT id FROM support_organisations WHERE is_demo = 0 AND verification_status IN ('source_confirmed','directly_verified')").all()) {
    ensureReviewSchedule(db, 'support_organisation', row.id, 90, 'data-team', 'Support organisation re-check');
}

// ---------------------------------------------------------------------------
// Medical knowledge — short summaries, unreviewed, sourced
// ---------------------------------------------------------------------------

const whoBreast = 'https://www.who.int/news-room/fact-sheets/detail/breast-cancer';
const whoCervical = 'https://www.who.int/news-room/fact-sheets/detail/cervical-cancer';
const iarcCervical = 'https://www.iarc.who.int/cancer-type/cervical-cancer';

const knowledge = [
    {
        topic: 'breast_health', title: 'Breast symptoms that need assessment',
        content: 'A breast lump, nipple discharge or change, skin dimpling, or a change in breast shape can have many causes, including non-cancerous ones. Anyone with a new or persistent change should have it assessed by a health worker. Self-examination is not a substitute for clinical assessment.',
        sources: [whoBreast],
    },
    {
        topic: 'breast_health', title: 'Breast cancer screening — what it involves',
        content: 'Breast screening aims to find cancer before symptoms appear. Methods vary by age, risk and what is available locally, and may include clinical breast examination or mammography. In Zimbabwe, availability and cost differ by facility: confirm what is offered and whether a fee applies before travelling.',
        sources: [whoBreast],
    },
    {
        topic: 'cervical_health', title: 'Cervical cancer, HPV and prevention',
        content: 'Persistent infection with high-risk types of human papillomavirus (HPV) causes most cervical cancers. HPV vaccination, screening and timely treatment of pre-cancerous changes are the main prevention measures. Screening can find changes early, when treatment is simpler and more effective.',
        sources: [whoCervical, iarcCervical],
    },
    {
        topic: 'cervical_health', title: 'Cervical screening — what to expect',
        content: 'Cervical screening may use HPV testing, a Pap smear, or visual inspection with acetic acid (VIAC). A health worker will explain the method used locally. Screening is usually quick. Results may need follow-up, and an abnormal result does not by itself mean cancer.',
        sources: [whoCervical],
    },
    {
        topic: 'cervical_health', title: 'HPV vaccination — questions patients ask',
        content: 'WHO recommends HPV vaccination as part of cervical cancer prevention, with the greatest benefit when given before exposure to HPV. National eligibility and scheduling are set by the Ministry of Health and Child Care. Ask your local clinic about current availability; do not assume it is free at every site.',
        sources: [whoCervical],
    },
    {
        topic: 'general', title: 'When to seek medical attention',
        content: 'Seek care promptly for a new lump, unexplained bleeding, persistent pain, weight loss, a sore that does not heal, or any symptom that is getting worse. Early assessment does not mean a diagnosis of cancer, but it gives the best chance of timely care. In an emergency, go to the nearest emergency department.',
        sources: ['https://www.who.int/news-room/fact-sheets/detail/cancer', whoBreast],
    },
    {
        topic: 'support', title: 'Palliative care and support — what is available',
        content: 'Palliative care focuses on relieving pain and other symptoms and supporting patients and families. In Zimbabwe it is provided by hospices and hospital teams, and it can be given alongside cancer treatment. CancerCare lists support organisations whose published services are verified; it does not guarantee funding or admission.',
        sources: ['https://hospaz.co.zw/', 'https://islandhospice.co.zw/palliative-care/'],
    },
];

for (const k of knowledge) {
    stageKnowledge(db, { topic: k.topic, title: k.title, content: k.content, sourceReferences: k.sources });
    const row = db.prepare('SELECT id FROM medical_knowledge WHERE title = ?').get(k.title);
    if (row) ensureReviewSchedule(db, 'medical_knowledge', row.id, 365, 'clinical-reviewer', 'Clinical review cycle');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const counts = {
    facilities: db.prepare('SELECT COUNT(*) c FROM facilities WHERE is_demo = 0').get().c,
    published: db.prepare("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status = 'published'").get().c,
    candidates: db.prepare("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status = 'draft'").get().c,
    claims: db.prepare('SELECT COUNT(*) c FROM service_claims').get().c,
    support: db.prepare('SELECT COUNT(*) c FROM support_organisations WHERE is_demo = 0').get().c,
    knowledge: db.prepare('SELECT COUNT(*) c FROM medical_knowledge').get().c,
    scheduled: db.prepare('SELECT COUNT(*) c FROM review_schedule').get().c,
};
console.log('Phase 5 expansion complete');
console.log(JSON.stringify({ counts, candidateErrors: candidateResult.errors, bulawayoErrors: bulawayoResult.errors }, null, 2));
