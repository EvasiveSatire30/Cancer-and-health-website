-- CancerCare Zimbabwe Database Schema
-- Version 1.0
-- SQLite database schema for all core functionality.
-- All statements are idempotent so the schema can be applied on every boot.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('patient', 'doctor', 'admin', 'super_admin')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_verified BOOLEAN DEFAULT 0,
    phone_number TEXT,
    emergency_contact TEXT,
    consent_medical BOOLEAN DEFAULT 0,
    consent_data BOOLEAN DEFAULT 0,
    consent_notifications BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS facilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    province TEXT NOT NULL,
    city TEXT NOT NULL,
    postal_code TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    type TEXT NOT NULL CHECK (type IN ('public_hospital', 'private_hospital', 'cancer_center', 'screening_clinic', 'surgical_facility', 'radiotherapy_center', 'general_clinic')),
    classification TEXT NOT NULL CHECK (classification IN ('public', 'private')),
    referral_required BOOLEAN DEFAULT 1,
    operating_hours TEXT,
    last_verified DATETIME,
    status TEXT NOT NULL DEFAULT 'status_unknown' CHECK (status IN ('operational', 'reported_unavailable', 'under_maintenance', 'status_unknown')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_number TEXT UNIQUE,
    license_number TEXT UNIQUE,
    specialty TEXT NOT NULL,
    hospital_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
    province TEXT NOT NULL,
    city TEXT,
    verified BOOLEAN DEFAULT 0,
    verification_date DATETIME,
    verified_by TEXT,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS facility_services (
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL CHECK (service_type IN ('screening', 'diagnostic', 'surgery', 'chemotherapy', 'radiotherapy', 'palliative_care', 'consultation')),
    available BOOLEAN DEFAULT 1,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(facility_id, service_type)
);

CREATE TABLE IF NOT EXISTS screening_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_name TEXT NOT NULL,
    service_type TEXT NOT NULL CHECK (service_type IN ('breast_screening', 'cervical_screening', 'general_screening')),
    location TEXT NOT NULL,
    province TEXT NOT NULL,
    city TEXT,
    date_start DATETIME NOT NULL,
    date_end DATETIME NOT NULL,
    is_free BOOLEAN DEFAULT 1,
    eligibility_criteria TEXT,
    registration_instructions TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    registration_deadline DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctor_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(doctor_id, date, start_time, end_time)
);

CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    date DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled', 'completed')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- A doctor/time slot can only have one live appointment. Cancelled/declined rows
-- are excluded so a slot becomes bookable again. (Partial unique index.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_live_slot
    ON appointments(doctor_id, date)
    WHERE status IN ('requested', 'confirmed', 'completed');

CREATE TABLE IF NOT EXISTS reschedule_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposed_date DATETIME,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
);

CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('breast_cancer', 'cervical_cancer', 'general_cancer', 'prevention', 'treatment', 'financial_assistance', 'support')),
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    source_refs TEXT,
    medical_reviewer_id INTEGER REFERENCES users(id),
    medical_reviewed BOOLEAN DEFAULT 0,
    last_reviewed DATETIME,
    publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft', 'pending_review', 'reviewed', 'rejected', 'published', 'archived')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS article_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_text TEXT NOT NULL,
    score INTEGER CHECK (score BETWEEN 1 AND 5),
    reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS financial_assistance_programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_name TEXT NOT NULL,
    assistance_type TEXT NOT NULL CHECK (assistance_type IN ('screening', 'diagnostic', 'surgery', 'radiotherapy', 'chemotherapy', 'transportation', 'support')),
    eligibility_criteria TEXT,
    application_process TEXT,
    contact_info TEXT,
    deadline DATE,
    verification_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS radiotherapy_equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    equipment_type TEXT NOT NULL,
    model TEXT,
    manufacturer TEXT,
    operational_status TEXT NOT NULL DEFAULT 'status_unknown' CHECK (operational_status IN ('operational', 'reported_unavailable', 'under_maintenance', 'status_unknown')),
    last_confirmed DATETIME,
    information_source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS equipment_status_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES radiotherapy_equipment(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('operational', 'reported_unavailable', 'under_maintenance', 'status_unknown')),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT,
    verified BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT,
    reviewed BOOLEAN DEFAULT 0,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    details JSON,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SOURCE REGISTRY & VERIFICATION SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS source_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organisation TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('government', 'municipal', 'ngo', 'private', 'academic', 'news', 'directory', 'manual')),
    authority_level TEXT NOT NULL CHECK (authority_level IN ('official', 'authoritative', 'community', 'unverified')),
    licence TEXT,
    publication_date DATE,
    retrieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL,
    evidence_id INTEGER REFERENCES source_registry(id) ON DELETE SET NULL,
    verification_method TEXT NOT NULL CHECK (verification_method IN ('source_confirmed', 'directly_verified', 'imported', 'admin_entry')),
    last_confirmed_at DATETIME,
    availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (availability_status IN ('available', 'unavailable', 'commissioning', 'unknown')),
    fee_status TEXT DEFAULT 'unknown' CHECK (fee_status IN ('free', 'paid', 'unknown')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(facility_id, service_type)
);

CREATE TABLE IF NOT EXISTS verification_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verification_method TEXT,
    evidence_id INTEGER REFERENCES source_registry(id) ON DELETE SET NULL,
    notes TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medical_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_references TEXT, -- JSON array of source URLs
    source_retrieved_at DATETIME,
    content_version INTEGER DEFAULT 1,
    review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'awaiting_review', 'clinician_reviewed', 'requires_re_review')),
    reviewer_identity TEXT,
    reviewed_at DATETIME,
    re_review_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_source_registry_type ON source_registry(source_type);
CREATE INDEX IF NOT EXISTS idx_service_claims_facility ON service_claims(facility_id);
CREATE INDEX IF NOT EXISTS idx_service_claims_service ON service_claims(service_type);
CREATE INDEX IF NOT EXISTS idx_verification_audit_record ON verification_audit(record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_medical_knowledge_topic ON medical_knowledge(topic);
CREATE INDEX IF NOT EXISTS idx_medical_knowledge_review ON medical_knowledge(review_status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_doctors_province ON doctors(province);
CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON doctors(specialty);
CREATE INDEX IF NOT EXISTS idx_doctors_verified ON doctors(verified);
CREATE INDEX IF NOT EXISTS idx_facilities_province ON facilities(province);
CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(type);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(publication_status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_screening_province ON screening_campaigns(province);
CREATE INDEX IF NOT EXISTS idx_screening_dates ON screening_campaigns(date_start, date_end);
