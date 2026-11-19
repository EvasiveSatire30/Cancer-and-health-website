import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { createAuditLog } from '../lib/crypto.js';

const CATEGORIES = ['breast_cancer', 'cervical_cancer', 'general_cancer', 'prevention', 'treatment', 'financial_assistance', 'support'];
const STATUSES = ['draft', 'pending_review', 'reviewed', 'rejected', 'published', 'archived'];

const articleSchema = z.object({
    title: z.string().min(4).max(220),
    category: z.enum(CATEGORIES),
    summary: z.string().min(20).max(1000),
    content: z.string().min(40).max(60000),
    source_refs: z.string().max(4000).optional().nullable(),
    medical_reviewed: z.boolean().default(false),
    publication_status: z.enum(STATUSES).default('draft'),
});

export function initArticleRoutes(app, db, validateFn, authMiddleware) {
    const validate = validateFn || validate;

    // ---- Public: published articles only ----
    app.get('/api/articles', (req, res, next) => {
        try {
            const { category, search } = req.query;
            let query = `
                SELECT id, title, category, summary, medical_reviewed, last_reviewed,
                       publication_status, source_refs, created_at, updated_at
                FROM articles
                WHERE publication_status = 'published'
            `;
            const params = [];

            if (category) { query += ' AND category = ?'; params.push(category); }
            if (search) {
                query += ' AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            query += ' ORDER BY created_at DESC';

            return res.json(db.prepare(query).all(...params));
        } catch (err) {
            return next(err);
        }
    });

    app.get('/api/articles/:id', (req, res, next) => {
        try {
            const article = db.prepare("SELECT * FROM articles WHERE id = ? AND publication_status = 'published'").get(req.params.id);
            if (!article) return res.status(404).json({ error: 'NOT_FOUND', message: 'Article not found' });
            return res.json(article);
        } catch (err) {
            return next(err);
        }
    });

    // ---- Admin: create ----
    app.post('/api/articles', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(articleSchema), (req, res, next) => {
            try {
                const b = req.body;
                if (b.publication_status === 'published' && !b.medical_reviewed) {
                    return res.status(400).json({
                        error: 'REVIEW_REQUIRED',
                        message: 'Articles cannot be published as clinically verified without medical review.',
                    });
                }

                const info = db.prepare(`
                    INSERT INTO articles (title, category, summary, content, source_refs,
                        medical_reviewed, medical_reviewer_id, last_reviewed, publication_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(b.title, b.category, b.summary, b.content, b.source_refs || null,
                    b.medical_reviewed ? 1 : 0, b.medical_reviewed ? req.user.id : null,
                    b.medical_reviewed ? new Date().toISOString() : null, b.publication_status);

                createAuditLog(db, req.user, 'create_article', 'article', Number(info.lastInsertRowid),
                    { status: b.publication_status }, req.ip);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Article created' });
            } catch (err) {
                return next(err);
            }
        });

    // ---- Admin: update ----
    app.put('/api/articles/:id', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        validate(articleSchema), (req, res, next) => {
            try {
                const b = req.body;
                if (b.publication_status === 'published' && !b.medical_reviewed) {
                    return res.status(400).json({
                        error: 'REVIEW_REQUIRED',
                        message: 'Articles cannot be published as clinically verified without medical review.',
                    });
                }

                const info = db.prepare(`
                    UPDATE articles SET title = ?, category = ?, summary = ?, content = ?,
                        source_refs = ?, medical_reviewed = ?, publication_status = ?,
                        medical_reviewer_id = COALESCE(?, medical_reviewer_id),
                        last_reviewed = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_reviewed END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(b.title, b.category, b.summary, b.content, b.source_refs || null,
                    b.medical_reviewed ? 1 : 0, b.publication_status,
                    b.medical_reviewed ? req.user.id : null, b.medical_reviewed ? 1 : 0, req.params.id);

                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Article not found' });
                createAuditLog(db, req.user, 'update_article', 'article', Number(req.params.id), {}, req.ip);
                return res.json({ message: 'Article updated', changes: info.changes });
            } catch (err) {
                return next(err);
            }
        });

    // ---- Admin: delete / archive ----
    app.delete('/api/articles/:id', authMiddleware.authenticate, authMiddleware.requireRole('admin', 'super_admin'),
        (req, res, next) => {
            try {
                const info = db.prepare("UPDATE articles SET publication_status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .run(req.params.id);
                if (info.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Article not found' });
                createAuditLog(db, req.user, 'archive_article', 'article', Number(req.params.id), {}, req.ip);
                return res.json({ message: 'Article archived' });
            } catch (err) {
                return next(err);
            }
        });

    // ---- Medical reviewer: attach a review record ----
    app.post('/api/articles/:id/review', authMiddleware.authenticate,
        authMiddleware.requireRole('doctor', 'admin', 'super_admin'),
        validate(z.object({
            review_text: z.string().min(10).max(5000),
            score: z.number().int().min(1).max(5).optional(),
        })), (req, res, next) => {
            try {
                const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(req.params.id);
                if (!article) return res.status(404).json({ error: 'NOT_FOUND', message: 'Article not found' });

                const info = db.prepare(`
                    INSERT INTO article_reviews (article_id, reviewer_id, review_text, score)
                    VALUES (?, ?, ?, ?)
                `).run(req.params.id, req.user.id, req.body.review_text, req.body.score || null);

                db.prepare(`
                    UPDATE articles SET medical_reviewed = 1, medical_reviewer_id = ?,
                        last_reviewed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(req.user.id, req.params.id);

                createAuditLog(db, req.user, 'review_article', 'article', Number(req.params.id), {}, req.ip);
                return res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Review submitted' });
            } catch (err) {
                return next(err);
            }
        });
}
