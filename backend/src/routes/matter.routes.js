import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureOwned } from '../lib/authorization.js';
import { logAudit } from '../lib/audit.js';

export const matterRouter = Router();
matterRouter.use(authenticate);

/* Matters belonging to the authenticated client. */
matterRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT id, reference, title, matter_type, description, status,
                    originating_request_id, assigned_to, created_at, updated_at
             FROM matters WHERE client_id = $1
             ORDER BY created_at DESC`,
            [request.user.sub]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

matterRouter.get('/:id', async (request, response, next) => {
    try {
        const row = await ensureOwned('matters', request.params.id, request.user.sub);
        response.json({ data: row });
    } catch (error) { next(error); }
});

matterRouter.get('/:id/events', async (request, response, next) => {
    try {
        await ensureOwned('matters', request.params.id, request.user.sub);
        const result = await query(
            `SELECT id, event_type, title, note, created_at
             FROM matter_events WHERE matter_id = $1
             ORDER BY created_at ASC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* Documents for a matter the client owns. */
matterRouter.get('/:id/documents', async (request, response, next) => {
    try {
        await ensureOwned('matters', request.params.id, request.user.sub);
        const result = await query(
            `SELECT d.id, d.original_name, d.content_type, d.size_bytes, d.status, d.created_at, d.updated_at,
                    uu.role AS uploaded_by_role, uu.full_name AS uploaded_by_name
             FROM documents d JOIN users uu ON uu.id = d.uploaded_by
             WHERE d.matter_id = $1 AND d.status <> 'DELETED'
             ORDER BY d.created_at DESC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* Appointments for a matter the client owns. */
matterRouter.get('/:id/appointments', async (request, response, next) => {
    try {
        await ensureOwned('matters', request.params.id, request.user.sub);
        const result = await query(
            `SELECT id, starts_at, ends_at, status, notes, created_at, updated_at
             FROM appointments WHERE matter_id = $1
             ORDER BY starts_at ASC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* Conversation for a matter the client owns (1:1).
   Race-safe via the conversations_matter_unique constraint. */
matterRouter.get('/:id/conversation', async (request, response, next) => {
    try {
        await ensureOwned('matters', request.params.id, request.user.sub);
        await logAudit({ actorId: request.user.sub, action: 'CONVERSATION_ACCESSED', entityType: 'matter', entityId: request.params.id });
        const result = await query(
            `INSERT INTO conversations (matter_id) VALUES ($1)
             ON CONFLICT (matter_id) DO NOTHING
             RETURNING id, matter_id, created_at`,
            [request.params.id]
        );
        if (result.rowCount === 1) {
            return response.json({ data: result.rows[0] });
        }
        /* A row already existed — fetch it. */
        const existing = await query(
            `SELECT id, matter_id, created_at FROM conversations WHERE matter_id = $1 LIMIT 1`,
            [request.params.id]
        );
        response.json({ data: existing.rows[0] });
    } catch (error) { next(error); }
});
