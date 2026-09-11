import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureOwned } from '../lib/authorization.js';
import { notifyRequestCreated } from '../services/sse.js';

const requestInput = z.object({
    subject: z.string().trim().min(3).max(200),
    description: z.string().trim().min(10).max(10000)
});

export const requestRouter = Router();
requestRouter.use(authenticate);

requestRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT id, subject, status, created_at, updated_at
             FROM requests WHERE client_id = $1
             ORDER BY created_at DESC`,
            [request.user.sub]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

requestRouter.post('/', async (request, response, next) => {
    try {
        const input = requestInput.parse(request.body);
        const result = await query(
            `INSERT INTO requests (client_id, subject, description)
             VALUES ($1, $2, $3)
             RETURNING id, subject, status, created_at`,
            [request.user.sub, input.subject, input.description]
        );
        const row = result.rows[0];
        /* Timeline: the submission itself is the first event. */
        await query(
            `INSERT INTO request_events (request_id, actor_id, event_type, title)
             VALUES ($1, $2, 'SUBMITTED', 'Request submitted')`,
            [row.id, request.user.sub]
        );
        /* Notify all internal staff with a NEW_REQUEST entry. */
        const staff = await query(`SELECT id FROM users WHERE role IN ('LAWYER','STAFF') AND is_active = TRUE`);
        for (const s of staff.rows) {
            await query(
                `INSERT INTO notifications (user_id, kind, title, body, entity_type, entity_id)
                 VALUES ($1, 'NEW_REQUEST', 'New client request', $2, 'request', $3)`,
                [s.id, row.subject.slice(0, 120), row.id]
            );
        }
        await notifyRequestCreated(row.id, request.user.sub, row.subject);
        response.status(201).json({ data: row });
    } catch (error) { next(error); }
});

/* Single request, owned by the caller. */
requestRouter.get('/:id', async (request, response, next) => {
    try {
        const row = await ensureOwned('requests', request.params.id, request.user.sub);
        /* Join the originating matter so the portal can deep-link to it. */
        const matter = await query(
            `SELECT id, reference, status FROM matters WHERE originating_request_id = $1 LIMIT 1`,
            [row.id]
        );
        response.json({ data: { ...row, originating_matter: matter.rows[0] || null } });
    } catch (error) { next(error); }
});

/* Client-visible timeline for a single request. */
requestRouter.get('/:id/events', async (request, response, next) => {
    try {
        await ensureOwned('requests', request.params.id, request.user.sub);
        const result = await query(
            `SELECT id, event_type, title, note, created_at
             FROM request_events WHERE request_id = $1
             ORDER BY created_at ASC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* Client submits a response to an information request. */
requestRouter.post('/:id/responses', async (request, response, next) => {
    try {
        await ensureOwned('requests', request.params.id, request.user.sub);
        const input = z.object({
            response: z.string().trim().min(1).max(10000),
            infoRequestId: z.string().uuid().optional()
        }).parse(request.body);
        const { processClientResponse } = await import('../services/workflow.service.js');
        const result = await processClientResponse({
            requestId: request.params.id,
            clientId: request.user.sub,
            response: input.response,
            infoRequestId: input.infoRequestId || null
        });
        response.status(201).json({ data: result });
    } catch (error) { next(error); }
});
