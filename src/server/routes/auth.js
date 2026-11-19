import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { hashPassword, verifyPassword, createAuditLog } from '../lib/crypto.js';

const TOKEN_TTL = '7d';
const RESET_TTL = '1h';

function secret() {
    return process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me-please-32chars';
}
function resetSecret() {
    return process.env.RESET_SECRET || 'dev-only-insecure-reset-secret-change-me-32ch';
}

/**
 * Auth middleware factory. Returns helpers used by the route initialiser and by
 * protected route modules.
 */
export function createAuthMiddleware(db) {
    const auth = {
        createToken(user, ttl = TOKEN_TTL) {
            return jwt.sign(
                { id: user.id, email: user.email, role: user.role, name: user.name },
                secret(),
                { expiresIn: ttl, algorithm: 'HS256' }
            );
        },

        verifyToken(token) {
            try {
                return jwt.verify(token, secret(), { algorithms: ['HS256'] });
            } catch {
                return null;
            }
        },

        createResetToken(email) {
            return jwt.sign({ email, purpose: 'password-reset' }, resetSecret(), { expiresIn: RESET_TTL });
        },

        verifyResetToken(token) {
            try {
                const decoded = jwt.verify(token, resetSecret(), { algorithms: ['HS256'] });
                if (decoded.purpose !== 'password-reset') return null;
                return decoded;
            } catch {
                return null;
            }
        },

        authenticate(req, res, next) {
            const header = req.headers['authorization'];
            if (!header || !header.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required' });
            }
            const decoded = auth.verifyToken(header.slice(7));
            if (!decoded) {
                return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Invalid or expired token' });
            }
            // Re-confirm the user still exists on every request.
            const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(decoded.id);
            if (!user) {
                return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Account no longer exists' });
            }
            req.user = user;
            next();
        },

        requireRole(...allowedRoles) {
            return (req, res, next) => {
                if (!req.user) {
                    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required' });
                }
                if (!allowedRoles.includes(req.user.role)) {
                    return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient permissions' });
                }
                next();
            };
        },

        requireDoctorProfile(req, res, next) {
            const doctor = db.prepare('SELECT * FROM doctors WHERE user_id = ?').get(req.user.id);
            if (!doctor) {
                return res.status(403).json({ error: 'FORBIDDEN', message: 'No doctor profile linked to this account' });
            }
            req.doctor = doctor;
            next();
        },
    };

    return auth;
}

const registerSchema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(200),
    name: z.string().min(2).max(120),
    phone_number: z.string().max(40).optional(),
    emergency_contact: z.string().max(40).optional(),
    // Public self-registration can only create patients. Admin accounts are provisioned.
    role: z.literal('patient').optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(200),
});

export function initAuthRoutes(app, db, env, authMiddleware, validate) {
    // ---- Registration ----
    app.post('/api/auth/register', validate(registerSchema), (req, res, next) => {
        try {
            const { email, password, name, phone_number, emergency_contact } = req.body;
            const normalized = email.toLowerCase().trim();

            const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
            if (existing) {
                return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'Email already registered' });
            }

            const passwordHash = hashPassword(password);
            const info = db.prepare(`
                INSERT INTO users (email, password_hash, name, role, phone_number, emergency_contact,
                                   consent_medical, consent_data, consent_notifications)
                VALUES (?, ?, ?, 'patient', ?, ?, 1, 1, 0)
            `).run(normalized, passwordHash, name.trim(), phone_number || null, emergency_contact || null);

            const userId = Number(info.lastInsertRowid);
            createAuditLog(db, { id: userId }, 'register', 'user', userId, { role: 'patient' }, req.ip);

            const user = { id: userId, email: normalized, name: name.trim(), role: 'patient' };
            const token = authMiddleware.createToken(user);
            return res.status(201).json({ user, token, message: 'Registration successful' });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Login ----
    app.post('/api/auth/login', validate(loginSchema), (req, res, next) => {
        try {
            const email = req.body.email.toLowerCase().trim();
            const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

            // Constant-ish work regardless of whether the user exists.
            const ok = user ? verifyPassword(req.body.password, user.password_hash) : false;
            if (!user || !ok) {
                return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
            }

            createAuditLog(db, { id: user.id }, 'login', 'user', user.id, {}, req.ip);

            const token = authMiddleware.createToken({
                id: user.id, email: user.email, role: user.role, name: user.name,
            });

            return res.json({
                user: { id: user.id, email: user.email, name: user.name, role: user.role },
                token,
                message: 'Login successful',
            });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Forgot password ----
    app.post('/api/auth/forgot-password', validate(z.object({ email: z.string().email() })), (req, res, next) => {
        try {
            const email = req.body.email.toLowerCase().trim();
            const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);

            // Always return the same response shape to avoid account enumeration.
            const payload = { message: 'If that email is registered, password reset instructions have been sent.' };
            if (user) {
                const resetToken = authMiddleware.createResetToken(email);
                createAuditLog(db, { id: user.id }, 'request_password_reset', 'user', user.id, {}, req.ip);
                // In production this must be emailed, never returned in the response body.
                if (process.env.NODE_ENV !== 'production') {
                    payload.dev_reset_token = resetToken;
                }
            }
            return res.json(payload);
        } catch (err) {
            return next(err);
        }
    });

    // ---- Reset password ----
    app.post('/api/auth/reset-password', validate(z.object({
        resetToken: z.string().min(10),
        newPassword: z.string().min(8).max(200),
    })), (req, res, next) => {
        try {
            const decoded = authMiddleware.verifyResetToken(req.body.resetToken);
            if (!decoded) {
                return res.status(400).json({ error: 'INVALID_TOKEN', message: 'Reset link is invalid or expired' });
            }

            const user = db.prepare('SELECT id FROM users WHERE email = ?').get(decoded.email);
            if (!user) {
                return res.status(400).json({ error: 'INVALID_TOKEN', message: 'Reset link is invalid or expired' });
            }

            const passwordHash = hashPassword(req.body.newPassword);
            db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(passwordHash, user.id);

            createAuditLog(db, { id: user.id }, 'reset_password', 'user', user.id, {}, req.ip);
            return res.json({ message: 'Password reset successful' });
        } catch (err) {
            return next(err);
        }
    });

    // ---- Current user ----
    app.get('/api/auth/me', authMiddleware.authenticate, (req, res) => {
        res.json({ user: req.user });
    });

    // ---- Logout (client discards token; server records the event) ----
    app.post('/api/auth/logout', authMiddleware.authenticate, (req, res) => {
        createAuditLog(db, req.user, 'logout', 'user', req.user.id, {}, req.ip);
        res.json({ message: 'Logout successful' });
    });
}
