import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

export function hashPassword(password) {
    const salt = randomBytes(SALT_LENGTH).toString('hex');
    const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
    return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const derivedHash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
    return timingSafeEqual(Buffer.from(derivedHash), Buffer.from(hash));
}

export function generateVerificationToken() {
    return randomBytes(32).toString('hex');
}

export function generateId() {
    return randomBytes(16).toString('hex');
}

export function createAuditLog(db, user, action, entity, entityId, details = {}, ip = null) {
    try {
        db.prepare(`
            INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            user.id,
            action,
            entity,
            entityId,
            JSON.stringify(details),
            ip
        );
    } catch (err) {
        console.error('Audit log failed:', err.message);
    }
}

export function generateOtp(length = 6) {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

export default { hashPassword, verifyPassword, generateVerificationToken, generateId, createAuditLog, generateOtp };