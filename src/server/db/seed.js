import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', process.env.DB_PATH || 'cancercare.db');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

console.log(`Seeding database at ${DB_PATH}...`);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);
console.log('Schema applied');

function run() {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount > 0) {
        console.log('Database already contains data. Skipping seed.');
        process.exit(0);
    }

    // 1. Admin and demo users
    const adminPass = hashPassword('admin123!');
    const adminInfo = db.prepare('INSERT INTO users (email, password_hash, name, role, is_verified) VALUES (?, ?, ?, ?, ?)')
        .run('admin@cancercarezim.org', adminPass, 'Admin User', 'super_admin', 1);

    const doctorPass = hashPassword('doctor123!');
    const doctorInfo = db.prepare('INSERT INTO users (email, password_hash, name, role, is_verified, phone_number) VALUES (?, ?, ?, ?, ?, ?)')
        .run('doctor@cancercarezim.org', doctorPass, 'Dr. Demo Doctor', 'doctor', 1, '+263 77 123 4567');
    const docUserId = Number(doctorInfo.lastInsertRowid);

    const patientPass = hashPassword('patient123!');
    db.prepare('INSERT INTO users (email, password_hash, name, role, is_verified, phone_number) VALUES (?, ?, ?, ?, ?, ?)')
        .run('patient@cancercarezim.org', patientPass, 'Demo Patient', 'patient', 1, '+263 77 765 4321');

    // 2. Facilities
    const facilityNames = [
        ['Parirenyatwa Group of Hospitals', 'Mazowe Street, Harare', 'Harare', 'Harare', 'public_hospital', 'public', 1],
        ['Mpilo Central Hospital', 'United Bulawayo Hospital Road, Bulawayo', 'Bulawayo', 'Bulawayo', 'public_hospital', 'public', 1],
        ['Zimbabwe National Cancer Centre', 'Mazowe Street, Harare', 'Harare', 'Harare', 'cancer_center', 'public', 0],
        ['Gweru Provincial Hospital', 'Gweru', 'Midlands', 'Gweru', 'public_hospital', 'public', 1],
        ['Mutare Provincial Hospital', 'Mutare', 'Manicaland', 'Mutare', 'public_hospital', 'public', 1],
        ['Cimas Healthcare (Demo)', 'Harare', 'Harare', 'Harare', 'private_hospital', 'private', 0],
        ['CancerServ Centre (Demo)', 'Harare', 'Harare', 'Harare', 'screening_clinic', 'private', 0],
        ['Number Nine Radiotherapy Centre (Demo)', 'Bulawayo', 'Bulawayo', 'Bulawayo', 'radiotherapy_center', 'public', 0],
    ];

    const facilityIds = [];
    for (const [name, address, province, city, type, classification, referral] of facilityNames) {
        const info = db.prepare(`
            INSERT INTO facilities (name, address, province, city, type, classification, referral_required, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'status_unknown')
        `).run(name, address, province, city, type, classification, referral);
        facilityIds.push(Number(info.lastInsertRowid));
    }

    // 3. Doctor profile
    const doctorInfo2 = db.prepare(`
        INSERT INTO doctors (user_id, registration_number, license_number, specialty, province, city, hospital_id, verified, verification_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(docUserId, 'ZMC/DEMO/001', 'DEMO-001', 'Medical Oncology', 'Harare', 'Harare', facilityIds[0]);
    const doctorId = Number(doctorInfo2.lastInsertRowid);

    // 4. Facility services
    const serviceMap = [
        [facilityIds[0], 'screening'], [facilityIds[0], 'diagnostic'], [facilityIds[0], 'surgery'],
        [facilityIds[1], 'screening'], [facilityIds[1], 'surgery'],
        [facilityIds[2], 'screening'], [facilityIds[2], 'diagnostic'], [facilityIds[2], 'chemotherapy'],
        [facilityIds[3], 'screening'],
        [facilityIds[4], 'screening'],
        [facilityIds[5], 'screening'], [facilityIds[5], 'diagnostic'], [facilityIds[5], 'surgery'],
        [facilityIds[6], 'screening'],
        [facilityIds[7], 'radiotherapy'],
    ];
    for (const [fid, service] of serviceMap) {
        db.prepare('INSERT INTO facility_services (facility_id, service_type) VALUES (?, ?)').run(fid, service);
    }

    // 5. Radiotherapy equipment
    db.prepare(`
        INSERT INTO radiotherapy_equipment (facility_id, equipment_type, model, manufacturer, operational_status, last_confirmed, information_source)
        VALUES (?, 'Linear Accelerator', 'TrueBeam STx', 'Varian', 'status_unknown', CURRENT_TIMESTAMP, 'demo_seed')
    `).run(facilityIds[7]);

    // 6. Articles (clinically reviewed demonstration content)
    const articles = [
        ['Understanding Breast Cancer: Risk Factors and Warning Signs', 'breast_cancer', 'Learn about the key risk factors and warning signs of breast cancer so it can be caught early.', '# Understanding Breast Cancer\n\n## Key Risk Factors\nFamily history, age, hormonal factors, lifestyle.\n\n## Warning Signs\nA new lump, changes in breast shape, nipple discharge, dimpling of skin.\n\n## When to see a doctor\nAny new change should be evaluated by a qualified clinician.', 'published', '["Zimbabwe Ministry of Health and Child Care", "World Health Organization"]'],
        ['Cervical Cancer Screening Guidelines for Zimbabwe', 'cervical_cancer', 'Learn about HPV vaccination and Pap smear schedules recommended in Zimbabwe.', '# Cervical Cancer Screening\n\n## Pap Smear Schedule\nWomen aged 30-65: every 3 years.\n\n## HPV Vaccination\nRecommended for girls aged 9-14.\n\n## Prevention\nHPV vaccination + regular screening.', 'published', '["Zimbabwe National Cervical Cancer Program", "WHO"]'],
        ['How to Prepare for a Cancer Screening Appointment', 'prevention', 'Practical checklist for preparing for your cancer screening appointment.', '# Preparing for Your Screening\n\n## Before You Go\nBring your ID, previous records, list of medications.\n\n## During\nAsk questions, take notes.\n\n## After\nFollow up on results.', 'published', '["CancerCare Zimbabwe Clinical Guidelines"]'],
        ['Common Misconceptions About Cancer', 'general_cancer', 'Debunking common myths and misconceptions about cancer causes and treatment.', '# Cancer Myths\n\n## Myth 1: Cancer is contagious\nFalse.\n\n## Myth 2: Cancer is a death sentence\nFalse — early detection saves lives.\n\n## Myth 3: If you have no family history, you are safe\nFalse — most cancers are sporadic.', 'published', '["American Cancer Society"]'],
        ['Financial Assistance for Cancer Treatment in Zimbabwe', 'financial_assistance', 'Guide to available financial assistance programmes for cancer patients.', '# Financial Help\n\n## Programs Available\nZimbabwe Cancer Society (transport), National Cancer Control Programme (radiotherapy).\n\n## How to apply\nContact the organisation directly; eligibility criteria vary.', 'published', '["Zimbabwe Cancer Society"]'],
        ['HPV Vaccination: What You Need to Know', 'cervical_cancer', 'Everything you need to know about the HPV vaccine and cervical cancer prevention.', '# HPV Vaccine\n\n## How it Works\nProtects against high-risk HPV types.\n\n## Who should get it\nGirls 9-14 before sexual debut.\n\n## Where\nPublic clinics and outreach campaigns.', 'published', '["WHO", "UNICEF"]'],
    ];
    for (const [title, category, summary, content, status, source_refs] of articles) {
        db.prepare(`
            INSERT INTO articles (title, category, summary, content, medical_reviewed, publication_status, source_refs, last_reviewed, medical_reviewer_id)
            VALUES (?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, ?)
        `).run(title, category, summary, content, status, source_refs, 1);
    }

    // 7. Screening campaigns (demonstration data - clearly labelled)
    const campaignList = [
        ['Demo Breast Cancer Screening Drive', 'breast_screening', 'Mazowe Street, Harare', 'Harare', 'Harare', '2026-12-01', '2026-12-05', 1, 'Women 35+', 'Walk-in or register at reception', 'Demo Coordinator', 'demo@example.com', '+263 77 000 0000'],
        ['Demo Cervical Cancer HPV Vaccination Campaign', 'cervical_screening', 'Mpilo Hospital, Bulawayo', 'Bulawayo', 'Bulawayo', '2026-12-10', '2026-12-15', 1, 'Girls 9-14 years', 'Bring ID and vaccination record', 'Demo Coordinator', 'demo@example.com', '+263 77 111 1111'],
        ['Demo Breast Screening at Gweru Provincial Hospital', 'breast_screening', 'Gweru', 'Midlands', 'Gweru', '2026-12-20', '2026-12-21', 0, 'Women 40+', 'Appointment required', 'Demo Coordinator', 'demo@example.com', '+263 77 222 2222'],
    ];
    for (const [org, stype, loc, province, city, start, end, free, eligibility, instructions, contact_name, contact_email, contact_phone] of campaignList) {
        db.prepare(`
            INSERT INTO screening_campaigns (organization_name, service_type, location, province, city, date_start, date_end, is_free, eligibility_criteria, registration_instructions, contact_name, contact_email, contact_phone)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(org, stype, loc, province, city, start, end, free, eligibility, instructions, contact_name, contact_email, contact_phone);
    }

    // 8. Financial assistance programs
    const programs = [
        ['Zimbabwe Cancer Society', 'transportation', 'Low-income patients', 'Apply in person at ZCS offices with ID and income proof', 'ZCS Office, Harare', '2026-12-31'],
        ['National Cancer Control Programme', 'radiotherapy', 'Adults diagnosed with treatable cancer', 'Submit application through treating oncologist', 'Ministry of Health and Child Care', '2027-03-31'],
    ];
    for (const [org, type, eligibility, process, contact, deadline] of programs) {
        db.prepare(`
            INSERT INTO financial_assistance_programs (organization_name, assistance_type, eligibility_criteria, application_process, contact_info, deadline)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(org, type, eligibility, process, contact, deadline);
    }

    // 9. Availability slots for the demo doctor
    const slots = [
        ['2026-12-05', '09:00', '09:30', 'Parirenyatwa'],
        ['2026-12-05', '09:45', '10:15', 'Parirenyatwa'],
        ['2026-12-12', '10:00', '10:30', 'Parirenyatwa'],
    ];
    for (const [date, start, end, location] of slots) {
        db.prepare('INSERT INTO doctor_availability (doctor_id, date, start_time, end_time, location) VALUES (?, ?, ?, ?, ?)')
            .run(doctorId, date, start, end, location);
    }

    // 10. AI knowledge documents
    const knowledge = [
        ['Breast cancer — what it is', 'Breast cancer is a disease in which malignant cells form in the tissues of the breast. It is the most common cancer in women worldwide. Early detection through screening improves outcomes.', 'WHO', 1],
        ['Cervical cancer — HPV and vaccination', 'Cervical cancer is caused by persistent infection with high-risk HPV types. HPV vaccination and regular cervical screening (Pap smear / HPV test) are the two most effective prevention strategies.', 'Zimbabwe National Cervical Cancer Program', 1],
        ['Warning signs requiring medical evaluation', 'Persistent breast lump, nipple discharge or inversion, unusual vaginal bleeding, pelvic pain, unexplained weight loss, or fatigue. These can have many causes; a qualified clinician must evaluate them.', 'CancerCare Zimbabwe Clinical Guidelines', 1],
        ['Treatment options overview', 'Treatment may include surgery, chemotherapy, radiotherapy, hormone therapy, and immunotherapy. A multidisciplinary oncology team tailors treatment to the individual patient.', 'NCI', 1],
        ['Cancer prevention basics', 'Avoid tobacco, limit alcohol, eat a balanced diet, maintain healthy weight, exercise regularly, protect skin from UV, and attend recommended screenings.', 'WCRF', 1],
    ];
    for (const [title, content, source, reviewed] of knowledge) {
        db.prepare(`
            INSERT INTO ai_knowledge_documents (title, content, source, reviewed, reviewed_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(title, content, source, reviewed);
    }

    console.log('Seed completed successfully!');
    console.log('Demo accounts:');
    console.log('  super_admin: admin@cancercarezim.org / admin123!');
    console.log('  doctor:      doctor@cancercarezim.org / doctor123!');
    console.log('  patient:     patient@cancercarezim.org / patient123!');
}

run();
db.close();
console.log('Database closed');