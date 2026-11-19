/**
 * CancerCare Zimbabwe — verified healthcare data import (Phase 5)
 *
 * Research date: 19 November 2026.
 *
 * Every record below is linked to a registered source. The import is
 * deliberately conservative:
 *   - "source_confirmed" means the cited public source supports the fact.
 *   - It does NOT mean the service is currently available, free, or accepting
 *     patients. Availability and fees stay "unknown" unless a source states them.
 *   - Only records with source_confirmed/directly_verified evidence are published.
 *   - Imported candidates remain unpublished until an administrator verifies them.
 *
 * Re-running this script is safe: providers are matched by name and updated.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import runMigrations from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'cancercare.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys=ON');
// Keep the importer usable on a fresh database: schema columns are added
// idempotently before any provider row is written.
runMigrations(db);

// ---------------------------------------------------------------------------
// Source registry
// ---------------------------------------------------------------------------

function registerSource({ organisation, url, type, authority, licence, publicationDate, notes }) {
    const existing = db.prepare('SELECT id FROM source_registry WHERE source_url = ?').get(url);
    if (existing) {
        db.prepare(`
            UPDATE source_registry SET organisation = ?, source_type = ?, authority_level = ?,
                licence = ?, publication_date = COALESCE(?, publication_date), notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(organisation, type, authority, licence || null, publicationDate || null, notes || null, existing.id);
        return existing.id;
    }
    const info = db.prepare(`
        INSERT INTO source_registry (organisation, source_url, source_type, authority_level, licence, publication_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(organisation, url, type, authority, licence || null, publicationDate || null, notes || null);
    return Number(info.lastInsertRowid);
}

const S = {
    mohcc: registerSource({
        organisation: 'Zimbabwe Ministry of Health and Child Care',
        url: 'https://www.mohcc.gov.zw/',
        type: 'government', authority: 'official',
        licence: 'Government public information; reuse licence not stated on the page',
        notes: 'National health policy, cancer control programme and public facility references.',
    }),
    impilo: registerSource({
        organisation: 'Impilo — Zimbabwe National Health Operating System',
        url: 'https://impilo.mohcc.gov.zw/welcome/find-care',
        type: 'government', authority: 'official',
        licence: 'Public portal; no open-data licence or public API found',
        notes: 'Health facility discovery. Access to authenticated records was not attempted.',
    }),
    hpa: registerSource({
        organisation: 'Health Professions Authority of Zimbabwe',
        url: 'https://hpa.co.zw/registered-facilities/',
        type: 'government', authority: 'authoritative',
        licence: 'Public register page; bulk reuse permission not established',
        notes: 'Registered facility list. Registration evidence does not establish current oncology services.',
    }),
    mdpcz: registerSource({
        organisation: 'Medical and Dental Practitioners Council of Zimbabwe',
        url: 'https://www.mdpcz.co.zw/public_register',
        type: 'government', authority: 'authoritative',
        licence: 'Public register; automated bulk access not established',
        notes: 'Practitioner registration lookup. No doctor was imported without a verified register entry.',
    }),
    harareCity: registerSource({
        organisation: 'City of Harare',
        url: 'https://www.hararecity.co.zw/services/about/council-health-facilities',
        type: 'municipal', authority: 'authoritative',
        licence: 'Municipal public information; reuse licence not stated',
        notes: 'Council health facilities. The City describes cervical screening using VIAC.',
    }),
    bulawayoCity: registerSource({
        organisation: 'Bulawayo City Council',
        url: 'https://www.citybyo.co.zw/Entities/Clinics',
        type: 'municipal', authority: 'authoritative',
        licence: 'Municipal public information; reuse licence not stated',
        notes: 'Municipal clinic directory. Individual clinic service lists still need confirmation.',
    }),
    znfpc: registerSource({
        organisation: 'Zimbabwe National Family Planning Council',
        url: 'https://www.znfpc.org.zw/family-planning-reproductive-health-services/',
        type: 'government', authority: 'authoritative',
        licence: 'Public service information; reuse licence not stated',
        notes: 'Publicly lists breast and cervical cancer screening among reproductive health services.',
    }),
    cancerzim: registerSource({
        organisation: 'Cancer Association of Zimbabwe',
        url: 'https://cancerzimbabwe.org/care_services',
        type: 'ngo', authority: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Awareness, counselling, patient support and breast cancer resources.',
    }),
    pszim: registerSource({
        organisation: 'Population Services Zimbabwe (Marie Stopes Zimbabwe)',
        url: 'https://www.pszim.com/help-advice/what-is-cervical-cancer-screening/',
        type: 'ngo', authority: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Cervical screening information and sexual/reproductive health services.',
    }),
    psh: registerSource({
        organisation: 'Population Solutions for Health',
        url: 'https://psh.org.zw/',
        type: 'ngo', authority: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Describes support for cervical cancer screening and treatment; this is programme support, not proof it operates a clinic at every site.',
    }),
    cancerserve: registerSource({
        organisation: 'CancerServe Zimbabwe',
        url: 'https://cancerserve.org/',
        type: 'ngo', authority: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Awareness, patient support and screening outreach. No current funding programme confirmed.',
    }),
    kidzcan: registerSource({
        organisation: 'KidzCan Zimbabwe',
        url: 'https://kidzcanzimbabwe.org/our-services/',
        type: 'ngo', authority: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Childhood cancer support. Distinct from adult breast/cervical services.',
    }),
    islandHospice: registerSource({
        organisation: 'Island Hospice & Healthcare',
        url: 'https://islandhospice.co.zw/palliative-care/',
        type: 'ngo', authority: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Palliative care, home-based care, counselling and support groups.',
    }),
    hospaz: registerSource({
        organisation: 'Hospice and Palliative Care Association of Zimbabwe',
        url: 'https://hospaz.co.zw/',
        type: 'ngo', authority: 'authoritative',
        licence: 'Public information; reuse licence not stated',
        notes: 'Palliative care network and referral information; not a cancer treatment funder.',
    }),
    harareOncology: registerSource({
        organisation: 'Harare Oncology Centre',
        url: 'https://harareoncologycentre.co.zw/',
        type: 'private', authority: 'authoritative',
        licence: 'Provider website; reuse licence not stated',
        notes: 'Private oncology provider. On 19 Nov 2026 the site returned a TLS certificate name mismatch and could not be opened; the record is unpublished pending re-check.',
    }),
    avenues: registerSource({
        organisation: 'The Avenues Clinic',
        url: 'https://avenuesclinic.co.zw/',
        type: 'private', authority: 'authoritative',
        licence: 'Provider website; reuse licence not stated',
        notes: 'Private hospital; oncology/chemotherapy information requires direct confirmation.',
    }),
    osm: registerSource({
        organisation: 'OpenStreetMap contributors (via Nominatim)',
        url: 'https://www.openstreetmap.org/',
        type: 'directory', authority: 'community',
        licence: 'OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0 — attribution required',
        notes: 'Name-matched facility coordinates. Coordinates are approximate campus locations from a crowd-sourced map, not verified entrances or a confirmation of services.',
    }),
    zbc: registerSource({
        organisation: 'ZBC News',
        url: 'https://www.zbcnews.co.zw/mpilo-cancer-treatment-equipment-awaits-commissioning-after-successful-tests/',
        type: 'news', authority: 'community',
        licence: 'News article; quoted facts only, no article text copied',
        publicationDate: '2026-11-13',
        notes: 'Reports that Mpilo radiotherapy equipment passed tests but still awaited commissioning. Not evidence that treatment is available.',
    }),
    zimMail: registerSource({
        organisation: 'The Zimbabwe Mail',
        url: 'https://thezimbabwemail.com/health/mpilo-hospital-cancer-treatment-machines/',
        type: 'news', authority: 'community',
        licence: 'News article; quoted facts only, no article text copied',
        publicationDate: '2026-11-15',
        notes: 'Secondary report on Mpilo cancer treatment machines during commissioning.',
    }),
    whoBreast: registerSource({
        organisation: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/breast-cancer',
        type: 'academic', authority: 'authoritative',
        licence: 'WHO fact sheet — CC BY-NC-SA 3.0 IGO (attribution required; no bulk copying)',
        notes: 'Breast cancer awareness, symptoms, screening and treatment overview.',
    }),
    whoCervical: registerSource({
        organisation: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/cervical-cancer',
        type: 'academic', authority: 'authoritative',
        licence: 'WHO fact sheet — CC BY-NC-SA 3.0 IGO (attribution required; no bulk copying)',
        notes: 'Cervical cancer, HPV, vaccination and screening overview.',
    }),
    whoCancer: registerSource({
        organisation: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/cancer',
        type: 'academic', authority: 'authoritative',
        licence: 'WHO fact sheet — CC BY-NC-SA 3.0 IGO (attribution required; no bulk copying)',
        notes: 'General cancer overview and when to seek medical attention.',
    }),
    iarc: registerSource({
        organisation: 'International Agency for Research on Cancer',
        url: 'https://www.iarc.who.int/cancer-type/cervical-cancer',
        type: 'academic', authority: 'authoritative',
        licence: 'IARC/WHO content; reuse terms must be checked before republication',
        notes: 'Cervical cancer evidence and HPV attribution.',
    }),
};

// ---------------------------------------------------------------------------
// Providers (candidate / source-confirmed)
// ---------------------------------------------------------------------------

function upsertProvider(p) {
    const existing = db.prepare('SELECT id FROM facilities WHERE name = ? AND province = ?').get(p.name, p.province);
    const nextReview = p.nextReviewAt || (p.verifiedAt ? new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10) : null);
    const values = [
        p.address, p.province, p.city, p.type, p.classification,
        p.phone || null, p.email || null, p.website || null,
        p.evidenceId || null, p.verification, p.publication,
        p.verifiedAt || null, nextReview,
        p.latitude || null, p.longitude || null,
        p.coordinateSource || null, p.coordinateSourceUrl || null,
        p.summary || null, p.notes || null,
    ];

    if (existing) {
        db.prepare(`
            UPDATE facilities SET name = ?, address = ?, province = ?, city = ?, type = ?, classification = ?,
                phone = ?, email = ?, website = ?, evidence_id = ?, verification_status = ?, publication_status = ?,
                verified_at = ?, next_review_at = ?, latitude = ?, longitude = ?,
                coordinate_source = ?, coordinate_source_url = ?, services_summary = ?, public_notes = ?,
                is_demo = 0, status = 'status_unknown', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(p.name, ...values, existing.id);
        return existing.id;
    }

    const info = db.prepare(`
        INSERT INTO facilities (name, address, province, city, type, classification, phone, email, website,
            evidence_id, verification_status, publication_status, verified_at, next_review_at,
            latitude, longitude, coordinate_source, coordinate_source_url, services_summary, public_notes,
            is_demo, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'status_unknown')
    `).run(p.name, ...values);
    return Number(info.lastInsertRowid);
}

const managedClaimKeys = new Set();

function upsertClaim(facilityId, serviceType, evidenceId, method, availability, fee, notes) {
    managedClaimKeys.add(`${facilityId}:${serviceType}`);
    db.prepare(`
        INSERT INTO service_claims (facility_id, service_type, evidence_id, verification_method,
            availability_status, fee_status, notes, last_confirmed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IN ('source_confirmed','directly_verified') THEN CURRENT_TIMESTAMP ELSE NULL END)
        ON CONFLICT(facility_id, service_type) DO UPDATE SET
            evidence_id = excluded.evidence_id,
            verification_method = excluded.verification_method,
            availability_status = excluded.availability_status,
            fee_status = excluded.fee_status,
            notes = excluded.notes,
            last_confirmed_at = excluded.last_confirmed_at,
            updated_at = CURRENT_TIMESTAMP
    `).run(facilityId, serviceType, evidenceId || null, method, availability, fee, notes || null, method);
}

const REVIEW_90 = 90;
const verifiedNow = new Date().toISOString().slice(0, 10);

// Common summary language keeps the identity/service distinction explicit.
const IDENTITY_ONLY = 'Facility identity is source-supported. Individual oncology service availability and fees still require direct confirmation.';

// Coordinates are deliberately labelled as approximate. A crowd-sourced map
// match is not a verified clinic entrance.
const OSM_NOTE = 'Approximate campus location from an OpenStreetMap/Nominatim name match, checked 19 Nov 2026. Not a verified entrance, building or clinic address.';

const providers = [
    // ---------------------------- Harare ----------------------------
    {
        name: 'Parirenyatwa Group of Hospitals', address: 'Mazowe Street, Harare', province: 'Harare', city: 'Harare',
        type: 'public_hospital', classification: 'public', website: null,
        evidenceId: S.mohcc, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow, summary: IDENTITY_ONLY,
        notes: 'National referral hospital. Its former website domain did not resolve on 19 Nov 2026, so no website link is published. Radiotherapy/oncology availability must be confirmed with the hospital.',
    },
    {
        name: 'Sally Mugabe Central Hospital', address: 'Harare', province: 'Harare', city: 'Harare',
        type: 'public_hospital', classification: 'public', website: null,
        evidenceId: S.mohcc, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow, summary: IDENTITY_ONLY,
        notes: 'Do not infer oncology or radiotherapy services from hospital identity.',
    },
    {
        name: 'Harare Oncology Centre', address: 'Harare', province: 'Harare', city: 'Harare',
        type: 'cancer_center', classification: 'private', website: null,
        evidenceId: S.harareOncology, verification: 'imported', publication: 'draft',
        summary: 'Candidate private oncology provider. Advertised services could not be re-checked because the provider website returned a TLS certificate error on 19 Nov 2026.',
        notes: 'Not published. Website unreachable due to a certificate name mismatch; re-verify before publishing any service claims.',
    },
    {
        name: 'The Avenues Clinic', address: 'Harare', province: 'Harare', city: 'Harare',
        type: 'private_hospital', classification: 'private', website: 'https://avenuesclinic.co.zw/',
        evidenceId: S.avenues, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow, summary: 'Private hospital. Oncology and chemotherapy facilities are advertised; confirm current service availability directly.',
        notes: 'Service claims are source-advertised, not directly verified.',
    },
    {
        name: 'Oncocare Cancer Treatment Centre', address: 'Harare', province: 'Harare', city: 'Harare',
        type: 'cancer_center', classification: 'private', website: null,
        evidenceId: S.hpa, verification: 'imported', publication: 'draft',
        summary: 'Candidate record from the HPA registered-facilities source. Services unconfirmed.',
        notes: 'Not published. HPA registration does not establish current oncology services.',
    },
    {
        name: 'Chitungwiza Central Hospital', address: 'Chitungwiza', province: 'Harare', city: 'Chitungwiza',
        type: 'public_hospital', classification: 'public', website: null,
        evidenceId: S.mohcc, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow, summary: 'Public central hospital. It is not classified as a radiotherapy centre; confirm cancer referral pathways directly.',
        notes: 'Cancer-related services not asserted without source support.',
    },

    // --------------------------- Bulawayo ---------------------------
    {
        name: 'Mpilo Central Hospital', address: 'United Bulawayo Hospital Road, Bulawayo', province: 'Bulawayo', city: 'Bulawayo',
        type: 'public_hospital', classification: 'public', website: null,
        evidenceId: S.zbc, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow,
        latitude: -20.1269837, longitude: 28.5712780,
        coordinateSource: OSM_NOTE,
        coordinateSourceUrl: 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Mpilo%20Central%20Hospital%2C%20Bulawayo%2C%20Zimbabwe',
        summary: 'Public referral hospital. New radiotherapy equipment was reported in November 2026 as awaiting commissioning. Patient treatment availability is NOT confirmed.',
        notes: 'Do not describe radiotherapy as operational. Commissioning reports are historical evidence only.',
    },
    {
        name: 'United Bulawayo Hospitals', address: 'Bulawayo', province: 'Bulawayo', city: 'Bulawayo',
        type: 'public_hospital', classification: 'public', website: null,
        evidenceId: S.mohcc, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow,
        latitude: -20.1667226, longitude: 28.6169193,
        coordinateSource: OSM_NOTE,
        coordinateSourceUrl: 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=United%20Bulawayo%20Hospitals%2C%20Bulawayo%2C%20Zimbabwe',
        summary: IDENTITY_ONLY,
        notes: 'Oncology, surgical and diagnostic service lists were not source-confirmed.',
    },
    {
        name: 'Bulawayo City Council Clinics', address: 'Bulawayo municipal clinics', province: 'Bulawayo', city: 'Bulawayo',
        type: 'general_clinic', classification: 'public', website: 'https://www.citybyo.co.zw/Entities/Clinics',
        evidenceId: S.bulawayoCity, verification: 'imported', publication: 'draft',
        summary: 'Municipal clinic network. Individual clinic services and screening availability require confirmation.',
        notes: 'Not every municipal clinic is a cervical screening centre. Awaiting direct verification.',
    },

    // ------------------------- Other provinces -------------------------
    {
        name: 'Gweru Provincial Hospital', address: 'Gweru', province: 'Midlands', city: 'Gweru',
        type: 'public_hospital', classification: 'public', website: null,
        evidenceId: S.mohcc, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow, summary: IDENTITY_ONLY,
        notes: 'Identity source-confirmed. Cancer service availability not asserted.',
    },
    {
        name: 'Mutare Provincial Hospital', address: 'Mutare', province: 'Manicaland', city: 'Mutare',
        type: 'public_hospital', classification: 'public', website: null,
        evidenceId: S.mohcc, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow,
        latitude: -18.9642980, longitude: 32.6629368,
        coordinateSource: OSM_NOTE,
        coordinateSourceUrl: 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Mutare%20Provincial%20Hospital%2C%20Zimbabwe',
        summary: IDENTITY_ONLY,
        notes: 'Identity source-confirmed. Cancer service availability not asserted.',
    },

    // --------------------- Screening organisations ---------------------
    {
        name: 'Zimbabwe National Family Planning Council (ZNFPC)', address: 'Harare (national office; multiple service points)', province: 'Harare', city: 'Harare',
        type: 'screening_clinic', classification: 'public', website: 'https://www.znfpc.org.zw/',
        evidenceId: S.znfpc, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow,
        summary: 'Publicly lists breast and cervical cancer screening within its reproductive health services. Not every location offers identical services; fees and current availability are unconfirmed.',
        notes: 'Service points and screening days must be confirmed with ZNFPC.',
    },
    {
        name: 'Cancer Association of Zimbabwe', address: 'Harare', province: 'Harare', city: 'Harare',
        type: 'screening_clinic', classification: 'private', website: 'https://cancerzimbabwe.org/',
        evidenceId: S.cancerzim, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow,
        summary: 'Cancer awareness, counselling, patient support and breast cancer information. Screening availability and fees are not confirmed.',
        notes: 'Do not present awareness activities as free screening events.',
    },
    {
        name: 'Population Services Zimbabwe (Marie Stopes Zimbabwe)', address: 'Harare (multiple locations)', province: 'Harare', city: 'Harare',
        type: 'screening_clinic', classification: 'private', website: 'https://www.pszim.com/',
        evidenceId: S.pszim, verification: 'source_confirmed', publication: 'published',
        verifiedAt: verifiedNow,
        summary: 'Provides sexual and reproductive health services and publishes cervical cancer screening information. Eligibility, cost and current availability must be confirmed.',
        notes: 'Advertised service, not a confirmed free campaign.',
    },
    {
        name: 'Mbare Polyclinic', address: 'Mbare, Harare', province: 'Harare', city: 'Harare',
        type: 'general_clinic', classification: 'public', website: 'https://www.hararecity.co.zw/services/about/council-health-facilities',
        evidenceId: S.harareCity, verification: 'imported', publication: 'draft',
        summary: 'Candidate City of Harare clinic. The City describes VIAC cervical screening at council facilities, but this clinic’s current screening days, staffing and fees are unconfirmed.',
        notes: 'Not published until a direct confirmation is recorded.',
    },
];

const providerIds = {};
for (const p of providers) {
    providerIds[p.name] = upsertProvider(p);
    // Seeded demo services must never leak into the verified directory.
    db.prepare('DELETE FROM facility_services WHERE facility_id = ?').run(providerIds[p.name]);
}

// Source-confirmed service claims. availability/fee deliberately stay unknown
// unless the source states them. Imported claims never surface publicly.
upsertClaim(providerIds['Parirenyatwa Group of Hospitals'], 'radiotherapy', S.mohcc, 'imported', 'unknown', 'unknown', 'Referral-hospital identity confirmed; radiotherapy availability not verified.');
upsertClaim(providerIds['Parirenyatwa Group of Hospitals'], 'oncology_referral', S.mohcc, 'source_confirmed', 'unknown', 'unknown', 'National referral pathway; contact hospital for current services.');

upsertClaim(providerIds['Sally Mugabe Central Hospital'], 'cancer_referral', S.mohcc, 'imported', 'unknown', 'unknown', 'No current cancer-specific service list confirmed.');

upsertClaim(providerIds['Harare Oncology Centre'], 'oncology_consultation', S.harareOncology, 'imported', 'unknown', 'unknown', 'Previously advertised by the provider. Provider website failed a TLS certificate check on 19 Nov 2026; re-verify before publishing.');
upsertClaim(providerIds['Harare Oncology Centre'], 'chemotherapy', S.harareOncology, 'imported', 'unknown', 'unknown', 'Previously advertised by the provider. Website could not be re-checked on 19 Nov 2026.');
upsertClaim(providerIds['Harare Oncology Centre'], 'cancer_screening', S.harareOncology, 'imported', 'unknown', 'unknown', 'Previously advertised screening. Website could not be re-checked on 19 Nov 2026.');

upsertClaim(providerIds['The Avenues Clinic'], 'oncology_consultation', S.avenues, 'source_confirmed', 'unknown', 'unknown', 'Oncology facilities advertised; confirm directly.');
upsertClaim(providerIds['The Avenues Clinic'], 'chemotherapy', S.avenues, 'source_confirmed', 'unknown', 'unknown', 'Chemotherapy facilities advertised; confirm directly.');

upsertClaim(providerIds['Mpilo Central Hospital'], 'radiotherapy', S.zbc, 'source_confirmed', 'commissioning', 'unknown', 'Equipment reported as installed and tested but awaiting commissioning (Nov 2026). Not confirmed as treating patients.');
upsertClaim(providerIds['Mpilo Central Hospital'], 'chemotherapy', S.mohcc, 'imported', 'unknown', 'unknown', 'Not source-confirmed for current availability.');

upsertClaim(providerIds['Zimbabwe National Family Planning Council (ZNFPC)'], 'breast_screening', S.znfpc, 'source_confirmed', 'unknown', 'unknown', 'Advertised service. Specific locations, days and fees unconfirmed.');
upsertClaim(providerIds['Zimbabwe National Family Planning Council (ZNFPC)'], 'cervical_screening', S.znfpc, 'source_confirmed', 'unknown', 'unknown', 'Advertised service. Specific locations, days and fees unconfirmed.');

upsertClaim(providerIds['Cancer Association of Zimbabwe'], 'cancer_awareness', S.cancerzim, 'source_confirmed', 'unknown', 'unknown', 'Awareness and education described by the organisation.');
upsertClaim(providerIds['Cancer Association of Zimbabwe'], 'counselling', S.cancerzim, 'source_confirmed', 'unknown', 'unknown', 'Counselling and patient support described; availability unconfirmed.');
upsertClaim(providerIds['Cancer Association of Zimbabwe'], 'patient_support', S.cancerzim, 'source_confirmed', 'unknown', 'unknown', 'Support services described; no funding promise is made.');

upsertClaim(providerIds['Population Services Zimbabwe (Marie Stopes Zimbabwe)'], 'cervical_screening', S.pszim, 'source_confirmed', 'unknown', 'unknown', 'Cervical screening information and SRH services published; fees and eligibility unconfirmed.');

upsertClaim(providerIds['Bulawayo City Council Clinics'], 'cervical_screening', S.bulawayoCity, 'imported', 'unknown', 'unknown', 'Awaiting clinic-level confirmation.');

upsertClaim(providerIds['Mbare Polyclinic'], 'cervical_screening', S.harareCity, 'imported', 'unknown', 'unknown', 'City describes VIAC screening; specific clinic confirmation pending.');

// The importer is authoritative for the providers it owns. Claims it does not
// declare are leftovers from earlier seed data and are removed, because an
// unsupported "chemotherapy" or "surgery" row must never become public.
for (const facilityId of Object.values(providerIds)) {
    for (const claim of db.prepare('SELECT id, service_type FROM service_claims WHERE facility_id = ?').all(facilityId)) {
        if (!managedClaimKeys.has(`${facilityId}:${claim.service_type}`)) {
            db.prepare('DELETE FROM service_claims WHERE id = ?').run(claim.id);
            console.log(`[claims] removed undeclared claim ${claim.id} (${claim.service_type}) for facility ${facilityId}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Radiotherapy machines
// ---------------------------------------------------------------------------

function upsertMachine(m) {
    const existing = db.prepare('SELECT id FROM radiotherapy_machines WHERE facility_id = ? AND machine_type = ?')
        .get(m.facilityId, m.machineType);
    if (existing) {
        db.prepare(`
            UPDATE radiotherapy_machines SET equipment_description = ?, installation_status = ?,
                commissioning_status = ?, operational_status = ?, last_reported_update = ?,
                last_directly_verified = ?, evidence_id = ?, verification_method = ?, admin_notes = ?,
                public_contact_instructions = ?, publication_status = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(m.description, m.installationStatus || null, m.commissioningStatus, m.operationalStatus,
            m.reportedAt || null, m.directlyVerifiedAt || null, m.evidenceId || null, m.method || null,
            m.notes || null, m.contact || null, m.publication || 'draft', existing.id);
        return existing.id;
    }
    const info = db.prepare(`
        INSERT INTO radiotherapy_machines (facility_id, machine_type, equipment_description, installation_status,
            commissioning_status, operational_status, last_reported_update, last_directly_verified,
            evidence_id, verification_method, admin_notes, public_contact_instructions, publication_status, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(m.facilityId, m.machineType, m.description || null, m.installationStatus || null,
        m.commissioningStatus, m.operationalStatus, m.reportedAt || null, m.directlyVerifiedAt || null,
        m.evidenceId || null, m.method || null, m.notes || null, m.contact || null, m.publication || 'draft');
    return Number(info.lastInsertRowid);
}

upsertMachine({
    facilityId: providerIds['Mpilo Central Hospital'],
    machineType: 'External beam radiotherapy equipment',
    description: 'Newly installed radiotherapy equipment reported by ZBC News. Public reporting does not confirm the model or manufacturer.',
    installationStatus: 'installed',
    commissioningStatus: 'in_progress',
    operationalStatus: 'commissioning',
    reportedAt: '2026-11-15',
    evidenceId: S.zbc,
    method: 'source_confirmed',
    notes: 'Equipment passed tests according to dated news reports but was awaiting commissioning. This is not proof of patient treatment availability.',
    contact: 'Please confirm current treatment availability directly with Mpilo Central Hospital before travelling.',
    publication: 'published',
});

// ---------------------------------------------------------------------------
// Support organisations
// ---------------------------------------------------------------------------

function upsertSupport(o) {
    const existing = db.prepare('SELECT id FROM support_organisations WHERE name = ?').get(o.name);
    const v = [o.type, o.description, o.services || null, o.province || null, o.city || null,
        o.address || null, o.phone || null, o.email || null, o.website || null, o.evidenceId || null,
        o.verification, o.publication, o.verifiedAt || null, o.nextReviewAt || null, 0, o.notes || null];
    if (existing) {
        db.prepare(`
            UPDATE support_organisations SET organisation_type = ?, description = ?, services = ?,
                province = ?, city = ?, address = ?, phone = ?, email = ?, website = ?, evidence_id = ?,
                verification_status = ?, publication_status = ?, verified_at = ?, next_review_at = ?,
                is_demo = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(...v, existing.id);
        return existing.id;
    }
    const info = db.prepare(`
        INSERT INTO support_organisations (name, organisation_type, description, services, province, city,
            address, phone, email, website, evidence_id, verification_status, publication_status,
            verified_at, next_review_at, is_demo, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(o.name, ...v);
    return Number(info.lastInsertRowid);
}

upsertSupport({
    name: 'CancerServe Zimbabwe', type: 'ngo',
    description: 'Cancer awareness, patient support and screening outreach. No current funding programme is confirmed by the published site.',
    services: 'Awareness; patient support; screening outreach information',
    province: 'Harare', city: 'Harare', website: 'https://cancerserve.org/',
    evidenceId: S.cancerserve, verification: 'source_confirmed', publication: 'published', verifiedAt: verifiedNow,
    notes: 'Support organisation — not a confirmed source of treatment funding.',
});
upsertSupport({
    name: 'KidzCan Zimbabwe', type: 'ngo',
    description: 'Childhood cancer support for children and families. This is distinct from adult breast and cervical cancer services.',
    services: 'Childhood cancer support; family assistance information; referrals',
    province: 'Harare', city: 'Harare', website: 'https://kidzcanzimbabwe.org/our-services/',
    evidenceId: S.kidzcan, verification: 'source_confirmed', publication: 'published', verifiedAt: verifiedNow,
    notes: 'Paediatric focus. Not an adult screening provider.',
});
upsertSupport({
    name: 'Island Hospice & Healthcare', type: 'ngo',
    description: 'Palliative care, home-based care, emotional support, counselling and support groups.',
    services: 'Palliative care; home-based care; counselling; support groups',
    province: 'Harare', city: 'Harare', website: 'https://islandhospice.co.zw/palliative-care/',
    evidenceId: S.islandHospice, verification: 'source_confirmed', publication: 'published', verifiedAt: verifiedNow,
    notes: 'Palliative and support services; not cancer treatment funding.',
});
upsertSupport({
    name: 'Hospice and Palliative Care Association of Zimbabwe (HOSPAZ)', type: 'network',
    description: 'National palliative care network with member organisations and referral information.',
    services: 'Palliative care network; referrals; member organisations',
    province: 'Harare', city: 'Harare', website: 'https://hospaz.co.zw/',
    evidenceId: S.hospaz, verification: 'source_confirmed', publication: 'published', verifiedAt: verifiedNow,
    notes: 'Network and referral body; not a treatment funder.',
});
upsertSupport({
    name: 'Population Solutions for Health', type: 'ngo',
    description: 'Describes support for cervical cancer screening and treatment programmes. Programme support does not prove that every site operates a screening clinic.',
    services: 'Cervical screening programme support; referral information',
    province: 'Harare', city: 'Harare', website: 'https://psh.org.zw/',
    evidenceId: S.psh, verification: 'source_confirmed', publication: 'published', verifiedAt: verifiedNow,
    notes: 'Programme support only; clinic-level service availability is unconfirmed.',
});

// ---------------------------------------------------------------------------
// Medical knowledge — drafts requiring clinical review
// ---------------------------------------------------------------------------

const knowledge = [
    {
        topic: 'breast_health', title: 'Breast changes that need medical assessment',
        content: 'Breast changes that should be checked by a healthcare professional include a new lump or thickening, a change in breast size or shape, nipple discharge, nipple inversion, skin dimpling or redness, and persistent breast pain. Many breast changes are not cancer, but a painless lump does not rule out cancer. Only a qualified clinician can determine the cause.',
        sources: [S.whoBreast],
    },
    {
        topic: 'breast_health', title: 'Breast cancer screening — overview',
        content: 'Breast screening aims to find cancer before symptoms appear. Methods can include clinical breast examination and mammography, depending on age, risk and local guidance. Screening recommendations should be confirmed with a Zimbabwean healthcare provider.',
        sources: [S.whoBreast, S.mohcc],
    },
    {
        topic: 'cervical_health', title: 'Cervical cancer, HPV and prevention',
        content: 'Cervical cancer is linked to persistent infection with high-risk types of human papillomavirus (HPV). HPV vaccination and regular cervical screening are important prevention measures. Screening can include HPV testing, cytology (Pap smear) or visual inspection with acetic acid (VIA/VIAC), depending on the service.',
        sources: [S.whoCervical, S.iarc],
    },
    {
        topic: 'cervical_health', title: 'Cervical screening — what to expect',
        content: 'Cervical screening looks for early changes before cancer develops. The right test and interval depend on age, previous results and national guidance. People with symptoms such as unusual bleeding or discharge should seek diagnostic assessment rather than waiting for routine screening.',
        sources: [S.whoCervical, S.mohcc],
    },
    {
        topic: 'general', title: 'When to seek medical attention',
        content: 'Seek medical evaluation for a new lump, unusual bleeding, persistent pain, unexplained weight loss, unusual discharge, a change in breast appearance, or any symptom that concerns you. Urgent symptoms such as severe bleeding or difficulty breathing need immediate emergency care. This content is educational and has not been clinically reviewed for publication.',
        sources: [S.whoCancer, S.whoBreast],
    },
];

for (const k of knowledge) {
    const existing = db.prepare('SELECT id FROM medical_knowledge WHERE title = ?').get(k.title);
    const refs = JSON.stringify(k.sources.map((id) => db.prepare('SELECT source_url FROM source_registry WHERE id = ?').get(id)?.source_url).filter(Boolean));
    if (existing) {
        db.prepare(`
            UPDATE medical_knowledge SET topic = ?, content = ?, source_references = ?, review_status = 'draft',
                reviewer_identity = NULL, reviewed_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(k.topic, k.content, refs, existing.id);
    } else {
        db.prepare(`
            INSERT INTO medical_knowledge (topic, title, content, source_references, source_retrieved_at, review_status)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'draft')
        `).run(k.topic, k.title, k.content, refs);
    }
}

// ---------------------------------------------------------------------------
// Remove superseded registry rows
// ---------------------------------------------------------------------------
// Changing a source URL creates a new registry row. Older rows that nothing
// references (and whose organisation still has a current source) are stale
// duplicates, so they are removed. Sources kept only as research notes stay.

const referencedSourceIds = new Set();
const evidenceTables = [
    'facilities', 'service_claims', 'support_organisations', 'radiotherapy_machines',
    'screening_campaigns', 'financial_assistance_programs', 'verification_audit',
];
for (const table of evidenceTables) {
    for (const row of db.prepare(`SELECT DISTINCT evidence_id AS id FROM ${table} WHERE evidence_id IS NOT NULL`).all()) {
        referencedSourceIds.add(row.id);
    }
}
for (const source of db.prepare('SELECT id, organisation, source_url FROM source_registry').all()) {
    if (referencedSourceIds.has(source.id)) continue;
    const sibling = db.prepare('SELECT id FROM source_registry WHERE organisation = ? AND id != ?')
        .get(source.organisation, source.id);
    if (!sibling) continue;
    const inKnowledge = db.prepare('SELECT id FROM medical_knowledge WHERE source_references LIKE ?')
        .get(`%${source.source_url}%`);
    if (!inKnowledge) {
        db.prepare('DELETE FROM source_registry WHERE id = ?').run(source.id);
        console.log(`[sources] removed superseded registry row ${source.id}: ${source.source_url}`);
    }
}

// ---------------------------------------------------------------------------
// Review schedule, conflicts and verification audit
// ---------------------------------------------------------------------------

function schedule(recordType, recordId, days, notes) {
    db.prepare(`
        INSERT INTO review_schedule (record_type, record_id, interval_days, next_review_at, owner, notes)
        VALUES (?, ?, ?, date('now', '+' || ? || ' days'), 'healthcare_data_admin', ?)
        ON CONFLICT(record_type, record_id) DO UPDATE SET interval_days = excluded.interval_days,
            next_review_at = excluded.next_review_at, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
    `).run(recordType, recordId, days, days, notes);
}

for (const [name, id] of Object.entries(providerIds)) {
    schedule('facility', id, 90, `Provider contact and service review: ${name}`);
}
for (const o of db.prepare('SELECT id FROM support_organisations WHERE is_demo = 0').all()) {
    schedule('support_organisation', o.id, 90, 'Support organisation contact review');
}
for (const m of db.prepare('SELECT id FROM radiotherapy_machines WHERE is_demo = 0').all()) {
    schedule('radiotherapy_machine', m.id, 14, 'Radiotherapy status: seek direct confirmation during commissioning/outages');
}

const openConflict = db.prepare(`
    SELECT id FROM source_conflicts WHERE record_type = 'radiotherapy_machine' AND field_name = 'operational_status' AND status = 'open'
`).get();
if (!openConflict) {
    const machine = db.prepare("SELECT id FROM radiotherapy_machines WHERE facility_id = ? AND machine_type LIKE 'External beam%'").get(providerIds['Mpilo Central Hospital']);
    if (machine) {
        db.prepare(`
            INSERT INTO source_conflicts (record_type, record_id, field_name, conflicting_values, notes)
            VALUES ('radiotherapy_machine', ?, 'operational_status', ?, ?)
        `).run(machine.id,
            JSON.stringify({ reported: 'installed and tested', status: 'commissioning', not_confirmed: 'operational' }),
            'Dated news reports describe successful tests but not commissioning completion or patient treatment. Status remains commissioning until directly verified.');
    }
}

const machineRow = db.prepare("SELECT id FROM radiotherapy_machines WHERE facility_id = ? AND machine_type LIKE 'External beam%'").get(providerIds['Mpilo Central Hospital']);
if (machineRow) {
    const audit = db.prepare(`
        SELECT id FROM verification_audit WHERE record_type = 'radiotherapy_machine' AND record_id = ? AND new_status = 'commissioning'
    `).get(machineRow.id);
    if (!audit) {
        db.prepare(`
            INSERT INTO verification_audit (record_type, record_id, previous_status, new_status,
                verification_method, evidence_id, notes)
            VALUES ('radiotherapy_machine', ?, 'unknown', 'commissioning', 'source_confirmed', ?, ?)
        `).run(machineRow.id, S.zbc,
            'ZBC News and The Zimbabwe Mail reported successful tests while awaiting commissioning. Patient treatment is not confirmed.');
    }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const counts = {
    sources: db.prepare('SELECT COUNT(*) c FROM source_registry').get().c,
    providers: db.prepare('SELECT COUNT(*) c FROM facilities WHERE is_demo = 0').get().c,
    published: db.prepare("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status = 'published'").get().c,
    candidates: db.prepare("SELECT COUNT(*) c FROM facilities WHERE is_demo = 0 AND publication_status != 'published'").get().c,
    claims: db.prepare('SELECT COUNT(*) c FROM service_claims').get().c,
    support: db.prepare('SELECT COUNT(*) c FROM support_organisations WHERE is_demo = 0').get().c,
    machines: db.prepare('SELECT COUNT(*) c FROM radiotherapy_machines WHERE is_demo = 0').get().c,
    knowledge: db.prepare('SELECT COUNT(*) c FROM medical_knowledge').get().c,
};

console.log('=== CancerCare Zimbabwe Phase 5 import complete ===');
console.log(counts);
console.log('All records remain subject to administrator verification. No doctor was imported without an MD PCZ register check.');

db.close();
