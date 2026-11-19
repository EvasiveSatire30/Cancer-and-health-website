import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

const SPECIALTIES = [
    'Medical Oncology', 'Radiation Oncology', 'Surgical Oncology',
    'Gynaecology', 'Breast Surgery', 'General Surgery', 'Haematology',
    'Palliative Care', 'Pathology', 'Radiology',
];

const doctorSchema = z.object({
    user_id: z.number().int().positive().optional(),
    registration_number: z.string().min(2).max(80).optional(),
    license_number: z.string().min(2).max(80).optional(),
    specialty: z.string().min(2).max(120),
    province: z.string().min(2).max(80),
    city: z.string().max(120).optional(),
    hospital_id: z.number().int().positive().optional(),
    bio: z.string().max(4000).optional(),
});

export function initDoctorRoutes(app, db, validateFn, authMiddleware) {
    const validate = validateFn || validate;

    // ---- Public: list verified doctors ----
    app.get('/api/doctors', (req, res, next) => {
        try {
            const { province, city, specialty, search, page = '1', pageSize = '20' } = req.query;
            const limit = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
            const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

            // Publication policy: only non-demo doctors that an administrator has
            // marked as published AND source/directly verified are public.
            let where = ` WHERE d.verified = 1
                 AND d.is_demo = 0
                 AND d.publication_status = 'published'
                 AND d.verification_status IN ('source_confirmed', 'directly_verified') `;
            const params = [];

            if (province) { where += ' AND d.province = ?'; params.push(province); }
            if (city) { where += ' AND d.city = ?'; params.push(city); }
            if (specialty) { where += ' AND d.specialty LIKE ?'; params.push(`%${specialty}%`); }
            if (search) {
                where += ' AND (u.name LIKE ? OR d.specialty LIKE ? OR d.registration_number LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            const total = db.prepare(`SELECT COUNT(*) AS count FROM doctors d JOIN users u ON d.user_id = u.id${where}`).get(...params).count;

            const rows = db.prepare(`
                SELECT d.id, d.user_id, d.registration_number, d.license_number,
                       d.specialty, d.province, d.city, d.verified, d.verification_date,
                       d.publication_status, d.verification_status,
                       d.bio, d.registration_source_url, d.registration_checked_at, d.accepting_patients,
                       u.name AS doctor_name,
                       h.name AS hospital_name, h.address AS hospital_address,
                       sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM doctors d
                JOIN users u ON d.user_id = u.id
                LEFT JOIN facilities h ON d.hospital_id = h.id
                LEFT JOIN source_registry sr ON d.evidence_id = sr.id
                ${where}
                ORDER BY d.verification_date DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);

            return res.json({ data: rows, total, page: Number(page), pageSize: limit, specialties: SPECIALTIES });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Public: one doctor ----
    app.get('/api/doctors/:id', (req, res, next) => {
        try {
            const doctor = db.prepare(`
                SELECT d.id, d.user_id, d.registration_number, d.license_number,
                       d.specialty, d.province, d.city, d.verified, d.verification_date,
                       d.publication_status, d.verification_status,
                       d.bio, d.hospital_id, d.registration_source_url, d.registration_checked_at,
                       d.accepting_patients,
                       u.name AS doctor_name,
                       h.name AS hospital_name, h.address AS hospital_address,
                       h.province AS hospital_province, h.city AS hospital_city,
                       sr.organisation AS evidence_organisation, sr.source_url AS evidence_url
                FROM doctors d
                JOIN users u ON d.user_id = u.id
                LEFT JOIN facilities h ON d.hospital_id = h.id
                LEFT JOIN source_registry sr ON d.evidence_id = sr.id
                WHERE d.id = ? AND d.verified = 1 AND d.is_demo = 0 AND d.publication_status = 'published'
            `).get(req.params.id);

            if (!doctor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Verified doctor not found' });

            const availability = db.prepare(
                'SELECT id, date, start_time, end_time, location FROM doctor_availability WHERE doctor_id = ? ORDER BY date, start_time'
            ).all(doctor.id);

            return res.json({ doctor, availability });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Admin: create / update a doctor profile ----
    app.post('/api/doctors', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(doctorSchema), (req, res, next) => {
            try {
                const { user_id, registration_number, license_number, specialty, province, city, hospital_id, bio } = req.body;
                if (!user_id) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'user_id is required' });

                const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
                if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found' });

                const existing = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(user_id);
                if (existing) {
                    db.prepare(`
                        UPDATE doctors SET registration_number = COALESCE(?, registration_number),
                            license_number = COALESCE(?, license_number), specialty = ?,
                            province = ?, city = ?, hospital_id = ?, bio = COALESCE(?, bio),
                            is_demo = 0, updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = ?
                    `).run(registration_number || null, license_number || null, specialty, province,
                        city || null, hospital_id || null, bio || null, user_id);
                    createAuditLog(db, req.user, 'update_doctor_profile', 'doctor', existing.id, {}, req.ip);
                    return res.json({ id: existing.id, message: 'Doctor profile updated' });
                }

                const info = db.prepare(`
                    INSERT INTO doctors (user_id, registration_number, license_number, specialty, province, city, hospital_id, verified, is_demo)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
                `).run(user_id, registration_number || null, license_number || null, specialty, province, city || null, hospital_id || null);

                createAuditLog(db, req.user, 'create_doctor_profile', 'doctor', Number(info.lastInsertRowid), {}, req.ip);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Doctor profile created (pending verification)' });
            } catch (err) {
                return next(err);
            }
        });

            // ---- Admin: verify / unverify ----
    app.put('/api/doctors/:id/verify', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(z.object({
            verification_status: z.enum(['imported', 'source_confirmed', 'directly_verified', 'rejected']).optional(),
            verification_method: z.enum(['source_confirmed', 'directly_verified', 'admin_entry']).optional(),
            evidence_id: z.number().int().positive().optional().nullable(),
            verified_by_name: z.string().max(200).optional(),
            notes: z.string().max(4000).optional(),
            verified: z.boolean().optional(),
            publish: z.boolean().optional().default(true),
        })), (req, res, next) => {
            try {
                const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
                if (!doctor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Doctor not found' });
                const b = req.body;
                const isVerified = b.verified !== undefined ? b.verified : (b.verification_status === 'source_confirmed' || b.verification_status === 'directly_verified');
                const vStatus = b.verification_status || (isVerified ? 'source_confirmed' : 'unverified');
                const publication = isVerified && (b.publish ?? true) ? 'published' : (vStatus === 'rejected' ? 'archived' : 'candidate');

                const info = db.prepare(`
                    UPDATE doctors SET verified = ?, verification_status = ?, publication_status = ?,
                        verification_date = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE verification_date END,
                        verified_by = COALESCE(?, verified_by), evidence_id = COALESCE(?, evidence_id),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(isVerified ? 1 : 0, vStatus, publication, isVerified ? 1 : 0,
                    b.verified_by_name || req.user.email, b.evidence_id || null, doctor.id);

                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Doctor not found' });
                createAuditLog(db, req.user, isVerified ? 'verify_doctor' : 'unverify_doctor', 'doctor', Number(req.params.id), { status: vStatus }, req.ip);
                return res.json({ message: 'Doctor verification updated', verified: isVerified ? 1 : 0, verification_status: vStatus, publication_status: publication });
            } catch (err) {
                return next(err);
            }
        });

    // ---- Public: availability slots ----
    app.get('/api/doctors/:id/availability', (req, res, next) => {
        try {
            return res.json(db.prepare(
                'SELECT id, date, start_time, end_time, location FROM doctor_availability WHERE doctor_id = ? ORDER BY date, start_time'
            ).all(req.params.id));
        } catch (err) {
            return next(err);
        }
    });

    // ---- Doctor (or admin): add a slot ----
    app.post('/api/doctors/:id/availability', authMiddleware.authenticate,
        validate(z.object({
            date: z.string().min(8).max(20),
            start_time: z.string().min(4).max(10),
            end_time: z.string().min(4).max(10),
            location: z.string().max(200).optional(),
        })), (req, res, next) => {
            try {
                const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
                if (!doctor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Doctor not found' });
                if (doctor.user_id !== req.user.id && !['admin', 'super_admin'].includes(req.user.role)) {
                    return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your profile' });
                }
                const info = db.prepare(`
                    INSERT INTO doctor_availability (doctor_id, date, start_time, end_time, location)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(doctor_id, date, start_time, end_time) DO NOTHING
                `).run(doctor.id, req.body.date, req.body.start_time, req.body.end_time, req.body.location || null);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Availability slot created' });
            } catch (err) {
                return next(err);
            }
        });

    // ---- Doctor (or admin): delete a slot ----
    app.delete('/api/doctors/:id/availability/:slotId', authMiddleware.authenticate, (req, res, next) => {
        try {
            const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
            if (!doctor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Doctor not found' });
            if (doctor.user_id !== req.user.id && !['admin', 'super_admin'].includes(req.user.role)) {
                return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your profile' });
            }
            const info = db.prepare('DELETE FROM doctor_availability WHERE id = ? AND doctor_id = ?')
                .run(req.params.slotId, doctor.id);
            if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Slot not found' });
            return res.json({ message: 'Availability slot deleted' });
        } catch (err) {
            return next(err);
        }
    });
}
