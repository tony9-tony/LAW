/* Ratings and comments.
   POST /api/v1/feedback            public: anyone can rate the service/system (1-5 stars)
   GET  /api/v1/owner/feedback       owner: list with the average and the star split
   PATCH /api/v1/owner/feedback/:id  owner: mark read / archive
   Public posts are rate limited and carry a hidden "website" trap for robots. */
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { verifiedUser } from '../lib/session.js';
import { logAudit } from '../lib/audit.js';

export const feedbackRouter = Router();
const postLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: process.env.NODE_ENV === 'test' ? 1000 : 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Thank you! You have already sent several ratings. Please try again later.' } }
});

const feedbackInput = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200).optional().or(z.literal('')),
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().max(1500).optional().or(z.literal('')),
    about: z.enum(['service', 'system', 'both']).optional(),
    website: z.string().optional() // robot trap: people never fill it
});

feedbackRouter.post('/', postLimiter, async (request, response, next) => {
    try {
        const input = feedbackInput.parse(request.body || {});
        if (input.website) return response.status(201).json({ data: { received: true } });
        const user = verifiedUser(request);
        const result = await query(
            `INSERT INTO feedback (name, email, rating, comment, about, user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, created_at`,
            [input.name, input.email || null, input.rating, input.comment || null, input.about || 'service', user && user.sub ? user.sub : null]
        );
        response.status(201).json({ data: { received: true, id: result.rows[0].id } });
    } catch (error) { next(error); }
});

export const ownerFeedbackRouter = Router();
ownerFeedbackRouter.use(authenticate, requireRole('OWNER'));

ownerFeedbackRouter.get('/', async (request, response, next) => {
    try {
        const q = z.object({ status: z.enum(['NEW', 'READ', 'ARCHIVED', 'ALL']).optional() }).parse(request.query);
        const status = q.status || 'ALL';
        const rows = (await query(
            `SELECT f.id, f.name, f.email, f.rating, f.comment, f.about, f.status, f.created_at,
                    u.full_name AS user_name, u.role AS user_role
               FROM feedback f LEFT JOIN users u ON u.id = f.user_id
              WHERE ($1 = 'ALL' AND f.status <> 'ARCHIVED') OR f.status = $1
              ORDER BY f.created_at DESC LIMIT 500`,
            [status]
        )).rows;
        const summary = (await query(
            `SELECT COUNT(*)::int AS total, COALESCE(ROUND(AVG(rating)::numeric, 2), 0)::float AS average,
                    COUNT(*) FILTER (WHERE status = 'NEW')::int AS unread,
                    COUNT(*) FILTER (WHERE rating = 5)::int AS r5, COUNT(*) FILTER (WHERE rating = 4)::int AS r4,
                    COUNT(*) FILTER (WHERE rating = 3)::int AS r3, COUNT(*) FILTER (WHERE rating = 2)::int AS r2,
                    COUNT(*) FILTER (WHERE rating = 1)::int AS r1
               FROM feedback WHERE status <> 'ARCHIVED'`
        )).rows[0];
        response.json({ data: rows, summary });
    } catch (error) { next(error); }
});

ownerFeedbackRouter.patch('/:id', async (request, response, next) => {
    try {
        const id = z.string().uuid().parse(request.params.id);
        const { status } = z.object({ status: z.enum(['NEW', 'READ', 'ARCHIVED']) }).parse(request.body || {});
        const result = await query(`UPDATE feedback SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`, [status, id]);
        if (result.rowCount === 0) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
        await logAudit({ actorId: request.user.sub, action: 'FEEDBACK_' + status, entityType: 'feedback', entityId: id });
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});
