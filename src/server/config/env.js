import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
    const result = { ok: true, missing: [] };

    // Required for production
    const requiredProd = ['JWT_SECRET', 'RESET_SECRET'];
    for (const key of requiredProd) {
        if (!process.env[key]) {
            result.ok = false;
            result.missing.push(key);
        }
    }

    return result;
}

export const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '3000', 10),
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
    DB_PATH: process.env.DB_PATH || './cancercare.db',
    JWT_SECRET: process.env.JWT_SECRET || '',
    RESET_SECRET: process.env.RESET_SECRET || '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    AI_PROVIDER_BASE_URL: process.env.AI_PROVIDER_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    EMAIL_FROM: process.env.EMAIL_FROM || 'no-reply@cancercarezim.co.zw',
    SMS_ENABLED: process.env.SMS_ENABLED === 'true',
    SMS_PROVIDER_URL: process.env.SMS_PROVIDER_URL || '',
    SMS_API_KEY: process.env.SMS_API_KEY || '',
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
    MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10),
    CONTENT_REVIEW_ENABLED: process.env.CONTENT_REVIEW_ENABLED !== 'false',
    MAX_ARTICLE_WORDS: parseInt(process.env.MAX_ARTICLE_WORDS || '5000', 10),
};

export const validateEnv = loadEnv;

export default env;