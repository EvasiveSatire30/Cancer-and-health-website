import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import runMigrations from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../..', process.env.DB_PATH || 'cancercare.db');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

let db;

// Synchronous initialization function
export function initDatabase() {
    console.log(`Initializing database at: ${DB_PATH}`);
    db = new DatabaseSync(DB_PATH);
    db.exec(`PRAGMA journal_mode=WAL`);
    db.exec(`PRAGMA foreign_keys=ON`);

    // Load and apply schema
    if (fs.existsSync(SCHEMA_PATH)) {
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
        db.exec(schema);
        console.log('Database schema applied successfully');
    } else {
        console.warn('Schema file not found, using existing database');
    }

    // Back up and migrate non-destructively. The backup is written next to the
    // live database before any column is added.
    try {
        const backup = `${DB_PATH}.pre-phase5.bak`;
        if (fs.existsSync(DB_PATH) && !fs.existsSync(backup)) {
            fs.copyFileSync(DB_PATH, backup);
            console.log(`Database backup created at ${backup}`);
        }
    } catch (err) {
        console.warn('Could not create pre-migration backup:', err.message);
    }

    runMigrations(db);

    return db;
}

// Get the active database connection
export function getDatabase() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

export default initDatabase;