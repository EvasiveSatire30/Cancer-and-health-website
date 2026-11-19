import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, validateEnv } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { validate } from './middleware/validation.js';
import initDatabase from './db/database.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(ROOT, 'dist');

const app = express();
const PORT = env.PORT;

// ==========================================
// Database Initialization
// ==========================================
const db = initDatabase();

// ==========================================
// Middleware Setup
// ==========================================

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
}));

// Compression
app.use(compression());

// CORS - allow configured origins
const origins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true, credentials: true }));

// Body parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Rate limiting
const globalRateLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(globalRateLimiter);

// ==========================================
// API Routes
// ==========================================

// Auth routes
import { initAuthRoutes } from './routes/auth.js';
const authMiddleware = createAuthMiddleware(db);
initAuthRoutes(app, db, env, authMiddleware, validate);

// Screening routes
import { initScreeningRoutes } from './routes/screening.js';
initScreeningRoutes(app, db, validate, authMiddleware);

// Doctor routes
import { initDoctorRoutes } from './routes/doctors.js';
initDoctorRoutes(app, db, validate, authMiddleware);

// Facility routes
import { initFacilityRoutes } from './routes/facilities.js';
initFacilityRoutes(app, db, validate, authMiddleware);

// Radiotherapy routes
import { initRadiotherapyRoutes } from './routes/radiotherapy.js';
initRadiotherapyRoutes(app, db, validate, authMiddleware);

// Financial assistance routes
import { initFinancialRoutes } from './routes/financial.js';
initFinancialRoutes(app, db, validate, authMiddleware);

// Article routes
import { initArticleRoutes } from './routes/articles.js';
initArticleRoutes(app, db, validate, authMiddleware);

// Appointment routes
import { initAppointmentRoutes } from './routes/appointments.js';
initAppointmentRoutes(app, db, validate, authMiddleware);

// AI routes
import { initAIRoutes } from './routes/ai.js';
initAIRoutes(app, db, env);

// Profile routes
import { initProfileRoutes } from './routes/profile.js';
initProfileRoutes(app, db, authMiddleware, validate);

// Symptom recognition routes (uses Python service internally)
import { initAdminRoutes } from './routes/admin.js';
initAdminRoutes(app, db, authMiddleware);

// Source registry and verification routes
import { initSourceRoutes } from './routes/sources.js';
initSourceRoutes(app, db, authMiddleware);

// Public verified directory and administrative verification workflow
import { initDirectoryRoutes } from './routes/directory.js';
initDirectoryRoutes(app, db);

import { initDirectoryAdminRoutes } from './routes/directoryAdmin.js';
initDirectoryAdminRoutes(app, db, authMiddleware);

// Health check (no DB dependency)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        ai: { enabled: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'your_gemini_api_key_here') },
    });
});

// ==========================================
// Serve Frontend (Vite build)
// ==========================================

// Serve static assets from the dist directory
import { existsSync } from 'node:fs';
if (existsSync(DIST)) {
    app.use(express.static(DIST));

    // SPA fallback - serve index.html for any non-API route
    app.get('*', (_req, res) => {
        if (_req.originalUrl.startsWith('/api/')) {
            res.status(404).json({ error: 'Not Found', message: 'API endpoint not found.' });
        } else {
            res.sendFile(path.join(DIST, 'index.html'));
        }
    });
}

app.use(notFound);
app.use(errorHandler);

// ==========================================
// Start Server
// ==========================================

let server;

async function start() {
    try {
        console.log('Database initialized');
        server = app.listen(PORT, () => {
            const check = validateEnv();
            console.log(`🏥 CancerCare Zimbabwe Server started`);
            console.log(`   Port: ${PORT}`);
            console.log(`   Environment: ${env.NODE_ENV}`);
            console.log(`   Database: ${env.DB_PATH}`);
            if (!check.ok) {
                console.warn(`   Missing env vars: ${check.missing.join(', ')}`);
                console.warn('   Default values in use - configure .env for production');
            }
            console.log(`   Health check: http://localhost:${PORT}/api/health`);
            console.log(`   CORS origins: ${env.CORS_ORIGIN}`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM received. Shutting down gracefully...');
            server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10000).unref();
        });

        process.on('SIGINT', () => {
            console.log('SIGINT received. Shutting down gracefully...');
            server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
        });

    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();

export default app;