/**
 * Non-destructive schema migrations for the verified healthcare directory.
 *
 * SQLite cannot add CHECK constraints or change existing columns in place, so
 * new verification metadata is added with ALTER TABLE ... ADD COLUMN. Every
 * statement is guarded by a PRAGMA table_info() check, which makes this safe to
 * run on every server boot.
 */

function tableColumns(db, table) {
    return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name));
}

function addColumn(db, table, column, definition) {
    const cols = tableColumns(db, table);
    if (cols.has(column)) return;
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
    console.log(`[migration] added ${table}.${column}`);
}

export function runMigrations(db) {
    // ---- Provider verification metadata ----
    addColumn(db, 'facilities', 'organisation_id', 'TEXT');
    addColumn(db, 'facilities', 'publication_status', "TEXT NOT NULL DEFAULT 'demo'");
    addColumn(db, 'facilities', 'verification_status', "TEXT NOT NULL DEFAULT 'demo'");
    addColumn(db, 'facilities', 'verified_at', 'DATETIME');
    addColumn(db, 'facilities', 'next_review_at', 'DATETIME');
    addColumn(db, 'facilities', 'evidence_id', 'INTEGER');
    addColumn(db, 'facilities', 'latitude', 'REAL');
    addColumn(db, 'facilities', 'longitude', 'REAL');
    addColumn(db, 'facilities', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'facilities', 'public_notes', 'TEXT');
    addColumn(db, 'facilities', 'services_summary', 'TEXT');
    addColumn(db, 'facilities', 'coordinate_source', 'TEXT');
    addColumn(db, 'facilities', 'coordinate_source_url', 'TEXT');
    addColumn(db, 'facilities', 'coordinate_review_status', "TEXT NOT NULL DEFAULT 'unreviewed'");

    // ---- Medical knowledge review metadata ----
    addColumn(db, 'medical_knowledge', 'reviewer_identity', 'TEXT');
    addColumn(db, 'medical_knowledge', 'reviewed_at', 'DATETIME');
    addColumn(db, 'medical_knowledge', 're_review_date', 'DATETIME');

    // ---- Doctor provider-publication metadata ----
    addColumn(db, 'doctors', 'publication_status', "TEXT NOT NULL DEFAULT 'candidate'");
    addColumn(db, 'doctors', 'next_review_at', 'DATETIME');
    addColumn(db, 'doctors', 'verification_status', "TEXT NOT NULL DEFAULT 'unverified'");

    // ---- Screening campaign verification metadata ----
    addColumn(db, 'screening_campaigns', 'organisation_id', 'INTEGER');
    addColumn(db, 'screening_campaigns', 'verification_status', "TEXT NOT NULL DEFAULT 'demo'");
    addColumn(db, 'screening_campaigns', 'verified_at', 'DATETIME');
    addColumn(db, 'screening_campaigns', 'expiry_status', "TEXT NOT NULL DEFAULT 'active'");
    addColumn(db, 'screening_campaigns', 'evidence_id', 'INTEGER');
    addColumn(db, 'screening_campaigns', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'screening_campaigns', 'contact_url', 'TEXT');

    // ---- Financial / support programme metadata ----
    addColumn(db, 'financial_assistance_programs', 'verification_status', "TEXT NOT NULL DEFAULT 'demo'");
    addColumn(db, 'financial_assistance_programs', 'verified_at', 'DATETIME');
    addColumn(db, 'financial_assistance_programs', 'evidence_id', 'INTEGER');
    addColumn(db, 'financial_assistance_programs', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'financial_assistance_programs', 'website', 'TEXT');

    // ---- Doctor registration metadata ----
    addColumn(db, 'doctors', 'registration_source_url', 'TEXT');
    addColumn(db, 'doctors', 'registration_checked_at', 'DATETIME');
    addColumn(db, 'doctors', 'accepting_patients', 'INTEGER');
    addColumn(db, 'doctors', 'is_demo', 'INTEGER NOT NULL DEFAULT 1');
    addColumn(db, 'doctors', 'evidence_id', 'INTEGER');

    // ---- New tables (kept here as well as schema.sql for older databases) ----
    db.exec(`
        CREATE TABLE IF NOT EXISTS radiotherapy_machines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
            machine_type TEXT NOT NULL,
            equipment_description TEXT,
            installation_status TEXT,
            commissioning_status TEXT NOT NULL DEFAULT 'unknown'
                CHECK (commissioning_status IN ('not_started', 'in_progress', 'completed', 'unknown')),
            operational_status TEXT NOT NULL DEFAULT 'unknown'
                CHECK (operational_status IN ('operational', 'commissioning', 'under_maintenance', 'reported_unavailable', 'unknown')),
            last_reported_update DATETIME,
            last_directly_verified DATETIME,
            evidence_id INTEGER REFERENCES source_registry(id) ON DELETE SET NULL,
            verification_method TEXT,
            admin_notes TEXT,
            public_contact_instructions TEXT,
            publication_status TEXT NOT NULL DEFAULT 'draft',
            is_demo INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS support_organisations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            organisation_type TEXT NOT NULL,
            description TEXT,
            services TEXT,
            province TEXT,
            city TEXT,
            address TEXT,
            phone TEXT,
            email TEXT,
            website TEXT,
            evidence_id INTEGER REFERENCES source_registry(id) ON DELETE SET NULL,
            verification_status TEXT NOT NULL DEFAULT 'imported',
            publication_status TEXT NOT NULL DEFAULT 'draft',
            verified_at DATETIME,
            next_review_at DATETIME,
            is_demo INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS source_conflicts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_type TEXT NOT NULL,
            record_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            conflicting_values TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
            detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            resolved_at DATETIME,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS review_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_type TEXT NOT NULL,
            record_id INTEGER NOT NULL,
            interval_days INTEGER NOT NULL,
            next_review_at DATETIME NOT NULL,
            owner TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(record_type, record_id)
        );

        CREATE INDEX IF NOT EXISTS idx_facilities_public
            ON facilities(publication_status, verification_status, is_demo);
        CREATE INDEX IF NOT EXISTS idx_facilities_province ON facilities(province);
        CREATE INDEX IF NOT EXISTS idx_radiotherapy_machines_facility ON radiotherapy_machines(facility_id);
        CREATE INDEX IF NOT EXISTS idx_support_orgs_public ON support_organisations(publication_status, is_demo);
        CREATE INDEX IF NOT EXISTS idx_review_schedule_next ON review_schedule(next_review_at);
    `);

    // ---- Support organisation metadata (table is created above) ----
    addColumn(db, 'support_organisations', 'next_review_at', 'DATETIME');
    addColumn(db, 'support_organisations', 'evidence_notes', 'TEXT');

    // ---- Isolate legacy demonstration records ----
    // Seed rows that use real hospital names are converted to verified candidate
    // records by the import script, so they are not blanket-marked as demo.
    db.exec(`
        UPDATE facilities
        SET is_demo = 1, publication_status = 'demo', verification_status = 'demo'
        WHERE is_demo = 0
          AND (name LIKE '%(Demo)%' OR name = 'Zimbabwe National Cancer Centre');
    `);

    // Campaigns/financial programmes/doctors created by seed.js are demonstrations.
    db.exec(`
        UPDATE screening_campaigns SET is_demo = 1, verification_status = 'demo', expiry_status = 'expired'
        WHERE is_demo = 0 AND verified_at IS NULL;
        UPDATE financial_assistance_programs SET is_demo = 1, verification_status = 'demo'
        WHERE is_demo = 0 AND evidence_id IS NULL;
        UPDATE doctors SET is_demo = 1
        WHERE is_demo = 0 AND (registration_number LIKE 'ZMC/DEMO/%' OR license_number LIKE 'DEMO-%');
        UPDATE doctors SET verification_status = 'demo' WHERE is_demo = 1;
        UPDATE doctors SET verification_status = 'source_confirmed', publication_status = 'published'
        WHERE is_demo = 0 AND verified = 1 AND verification_status = 'unverified';
    `);

    return db;
}

export default runMigrations;
