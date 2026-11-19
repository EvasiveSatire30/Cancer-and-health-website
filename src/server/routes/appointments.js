import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

export const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'declined', 'cancelled', 'completed'];

function isAdmin(user) {
    return user && (user.role === 'admin' || user.role === 'super_admin');
}

function notify(db, userId, type, title, message) {
    try {
        db.prepare(`INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)`)
            .run(userId, type, title, message);
    } catch (err) {
        // Notifications must never break the primary workflow.
        console.error('notification insert failed:', err.message);
    }
}

const requestSchema = z.object({
    doctor_id: z.coerce.number().int().positive(),
    facility_id: z.coerce.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM'),
    reason: z.string().max(2000).optional(),
});

export function initAppointmentRoutes(app, db, validateFn, authMiddleware) {
    const validate = validateFn || validate;

    /**
     * List appointments. Patients only see their own; doctors see appointments
     * assigned to their doctor profile; admins see everything.
     */
    app.get('/api/appointments', authMiddleware.authenticate, (req, res, next) => {
        try {
            const { status } = req.query;
            const params = [];
            let where = ' WHERE 1 = 1 ';

            if (isAdmin(req.user)) {
                // no scope restriction
            } else if (req.user.role === 'doctor') {
                const profile = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(req.user.id);
                if (!profile) return res.json([]);
                where += ' AND a.doctor_id = ?';
                params.push(profile.id);
            } else {
                where += ' AND a.patient_id = ?';
                params.push(req.user.id);
            }

            if (status && APPOINTMENT_STATUSES.includes(status)) {
                where += ' AND a.status = ?';
                params.push(status);
            }

            const rows = db.prepare(`
                SELECT a.id, a.patient_id, a.doctor_id, a.facility_id, a.date, a.status,
                       a.notes, a.created_at, a.updated_at,
                       p.name AS patient_name,
                       du.name AS doctor_name, d.specialty AS doctor_specialty,
                       f.name AS facility_name, f.address AS facility_address
                FROM appointments a
                JOIN users p ON a.patient_id = p.id
                JOIN doctors d ON a.doctor_id = d.id
                JOIN users du ON d.user_id = du.id
                JOIN facilities f ON a.facility_id = f.id
                ${where}
                ORDER BY a.date DESC
            `).all(...params);

            return res.json(rows);
        } catch (err) {
            return next(err);
        }
    });

    /**
     * Request an appointment. Always created in the "requested" state — the
     * patient is never shown a confirmed booking until the provider accepts.
     */
    app.post('/api/appointments', authMiddleware.authenticate, authMiddleware.requireRole('patient', 'admin', 'super_admin'),
        validate(requestSchema), (req, res, next) => {
            try {
                const { doctor_id, facility_id, date, time, reason } = req.body;
                const patientId = req.user.id;

                const doctor = db.prepare(`
                    SELECT d.id, d.verified, d.user_id AS doctor_user_id, u.name AS doctor_name
                    FROM doctors d JOIN users u ON d.user_id = u.id
                    WHERE d.id = ?
                `).get(doctor_id);
                if (!doctor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Doctor not found' });
                if (!doctor.verified) {
                    return res.status(409).json({ error: 'UNVERIFIED_DOCTOR', message: 'This doctor is not yet verified.' });
                }

                const facility = db.prepare('SELECT id, name FROM facilities WHERE id = ?').get(facility_id);
                if (!facility) return res.status(404).json({ error: 'NOT_FOUND', message: 'Facility not found' });

                const when = `${date} ${time}:00`;
                if (Number.isNaN(new Date(when).getTime())) {
                    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid date/time' });
                }
                if (new Date(when).getTime() < Date.now()) {
                    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Appointment date must be in the future' });
                }

                // Transactional insert. The partial unique index is the final
                // concurrency guard against two patients booking the same slot.
                db.exec('BEGIN IMMEDIATE');
                try {
                    const clash = db.prepare(`
                        SELECT id FROM appointments
                        WHERE doctor_id = ? AND date = ?
                          AND status IN ('requested', 'confirmed', 'completed')
                    `).get(doctor_id, when);

                    if (clash) {
                        db.exec('ROLLBACK');
                        return res.status(409).json({ error: 'SLOT_TAKEN', message: 'That time slot is no longer available.' });
                    }

                    const info = db.prepare(`
                        INSERT INTO appointments (patient_id, doctor_id, facility_id, date, status, notes)
                        VALUES (?, ?, ?, ?, 'requested', ?)
                    `).run(patientId, doctor_id, facility_id, when, reason || null);

                    db.exec('COMMIT');

                    const apptId = Number(info.lastInsertRowid);
                    notify(db, doctor.doctor_user_id, 'appointment_requested',
                        'New appointment request',
                        `${req.user.name} requested an appointment on ${date} at ${time}.`);
                    createAuditLog(db, req.user, 'request_appointment', 'appointment', apptId, { doctor_id, when }, req.ip);

                    return res.status(201).json({
                        id: apptId,
                        status: 'requested',
                        message: 'Appointment requested successfully. Awaiting provider confirmation.',
                    });
                } catch (err) {
                    try { db.exec('ROLLBACK'); } catch { /* noop */ }
                    throw err;
                }
            } catch (err) {
                return next(err);
            }
        });

    /** Doctor (or admin): accept a requested appointment. */
    app.put('/api/appointments/:id/accept', authMiddleware.authenticate, (req, res, next) => {
        try {
            const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
            if (!appt) return res.status(404).json({ error: 'NOT_FOUND', message: 'Appointment not found' });

            const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(appt.doctor_id);
            if (!isAdmin(req.user) && (!doctor || doctor.user_id !== req.user.id)) {
                return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the assigned provider can accept this appointment' });
            }
            if (appt.status !== 'requested') {
                return res.status(409).json({ error: 'INVALID_STATE', message: `Cannot accept a ${appt.status} appointment` });
            }

            db.prepare("UPDATE appointments SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(appt.id);
            notify(db, appt.patient_id, 'appointment_confirmed', 'Appointment confirmed',
                `Your appointment on ${appt.date} has been confirmed.`);
            createAuditLog(db, req.user, 'accept_appointment', 'appointment', appt.id, {}, req.ip);
            return res.json({ message: 'Appointment confirmed', status: 'confirmed' });
        } catch (err) {
            return next(err);
        }
    });

    /** Doctor (or admin): decline a requested appointment. */
    app.put('/api/appointments/:id/decline', authMiddleware.authenticate,
        validate(z.object({ reason: z.string().max(1000).optional().default('') })), (req, res, next) => {
            try {
                const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
                if (!appt) return res.status(404).json({ error: 'NOT_FOUND', message: 'Appointment not found' });

                const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(appt.doctor_id);
                if (!isAdmin(req.user) && (!doctor || doctor.user_id !== req.user.id)) {
                    return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the assigned provider can decline this appointment' });
                }
                if (appt.status !== 'requested') {
                    return res.status(409).json({ error: 'INVALID_STATE', message: `Cannot decline a ${appt.status} appointment` });
                }

                db.prepare("UPDATE appointments SET status = 'declined', notes = COALESCE(notes, '') || ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .run(req.body.reason ? `\nDeclined: ${req.body.reason}` : '\nDeclined by provider', appt.id);

                notify(db, appt.patient_id, 'appointment_declined', 'Appointment declined',
                    `Your appointment request for ${appt.date} was declined. ${req.body.reason || ''}`.trim());
                createAuditLog(db, req.user, 'decline_appointment', 'appointment', appt.id, { reason: req.body.reason }, req.ip);
                return res.json({ message: 'Appointment declined', status: 'declined' });
            } catch (err) {
                return next(err);
            }
        });

    /** Patient, doctor, or admin: cancel. */
    app.put('/api/appointments/:id/cancel', authMiddleware.authenticate,
        validate(z.object({ reason: z.string().max(1000).optional().default('') })), (req, res, next) => {
            try {
                const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
                if (!appt) return res.status(404).json({ error: 'NOT_FOUND', message: 'Appointment not found' });

                const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(appt.doctor_id);
                const allowed = isAdmin(req.user)
                    || appt.patient_id === req.user.id
                    || (doctor && doctor.user_id === req.user.id);
                if (!allowed) return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your appointment' });
                if (['cancelled', 'completed', 'declined'].includes(appt.status)) {
                    return res.status(409).json({ error: 'INVALID_STATE', message: `Appointment is already ${appt.status}` });
                }

                db.prepare("UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(appt.id);

                const counterpart = appt.patient_id === req.user.id
                    ? (doctor ? doctor.user_id : null)
                    : appt.patient_id;
                if (counterpart) {
                    notify(db, counterpart, 'appointment_cancelled', 'Appointment cancelled',
                        `The appointment on ${appt.date} was cancelled. ${req.body.reason || ''}`.trim());
                }
                createAuditLog(db, req.user, 'cancel_appointment', 'appointment', appt.id, { reason: req.body.reason }, req.ip);
                return res.json({ message: 'Appointment cancelled', status: 'cancelled' });
            } catch (err) {
                return next(err);
            }
        });

    /** Doctor/admin: mark a confirmed appointment as completed. */
    app.put('/api/appointments/:id/complete', authMiddleware.authenticate, (req, res, next) => {
        try {
            const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
            if (!appt) return res.status(404).json({ error: 'NOT_FOUND', message: 'Appointment not found' });

            const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(appt.doctor_id);
            if (!isAdmin(req.user) && (!doctor || doctor.user_id !== req.user.id)) {
                return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the provider can complete this appointment' });
            }
            if (appt.status !== 'confirmed') {
                return res.status(409).json({ error: 'INVALID_STATE', message: 'Only confirmed appointments can be completed' });
            }

            db.prepare("UPDATE appointments SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(appt.id);
            createAuditLog(db, req.user, 'complete_appointment', 'appointment', appt.id, {}, req.ip);
            return res.json({ message: 'Appointment completed', status: 'completed' });
        } catch (err) {
            return next(err);
        }
    });

    /** Patient: request a reschedule (provider must act on it). */
    app.post('/api/appointments/:id/reschedule', authMiddleware.authenticate,
        validate(z.object({
            proposed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            proposed_time: z.string().regex(/^\d{2}:\d{2}$/),
            reason: z.string().max(1000).optional(),
        })), (req, res, next) => {
            try {
                const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
                if (!appt) return res.status(404).json({ error: 'NOT_FOUND', message: 'Appointment not found' });
                if (appt.patient_id !== req.user.id && !isAdmin(req.user)) {
                    return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the patient can request a reschedule' });
                }
                if (!['requested', 'confirmed'].includes(appt.status)) {
                    return res.status(409).json({ error: 'INVALID_STATE', message: 'This appointment can no longer be rescheduled' });
                }

                const proposed = `${req.body.proposed_date} ${req.body.proposed_time}`;
                const info = db.prepare(`
                    INSERT INTO reschedule_requests (appointment_id, requested_by, proposed_date, reason)
                    VALUES (?, ?, ?, ?)
                `).run(appt.id, req.user.id, proposed, req.body.reason || null);

                const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(appt.doctor_id);
                if (doctor) {
                    notify(db, doctor.user_id, 'reschedule_requested', 'Reschedule requested',
                        `Patient requested to move the appointment to ${proposed}.`);
                }
                createAuditLog(db, req.user, 'request_reschedule', 'appointment', appt.id, { proposed }, req.ip);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Reschedule request submitted' });
            } catch (err) {
                return next(err);
            }
        });

    /** Availability slots for the booking form. */
    app.get('/api/appointments/slots', authMiddleware.authenticate, (req, res, next) => {
        try {
            const doctorId = parseInt(req.query.doctorId, 10);
            if (!doctorId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'doctorId required' });
            const date = req.query.date;

            let query = `SELECT id, date, start_time, end_time, location FROM doctor_availability WHERE doctor_id = ?`;
            const params = [doctorId];
            if (date) { query += ' AND date = ?'; params.push(date); }
            query += ' ORDER BY date, start_time';

            return res.json(db.prepare(query).all(...params));
        } catch (err) {
            return next(err);
        }
    });
}
