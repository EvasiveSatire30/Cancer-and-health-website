import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { hashPassword, verifyPassword, createAuditLog } from '../lib/crypto.js';

const TOKEN_TTL = '7d';

function secret() {
    return process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me-please-32chars';
}
function resetSecret() {
    return process.env.RESET_SECRET || 'dev-only-insecure-reset-secret-change-me-32ch';
}

/**
 * Single source of truth for authentication middleware.
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
            return jwt.sign({ email, purpose: 'password-reset' }, resetSecret(), { expiresIn: '1h' });
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

export default createAuthMiddleware;

