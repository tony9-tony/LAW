/* Staff routes — for SUBUI and internal workflows. Guarded by requireRole
   so CLIENT users cannot reach these endpoints. */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../db.js';
import { acceptRequest, declineRequest, updateRequestStatus } from '../services/workflow.service.js';

export const staffRouter = Router();
staffRouter.use(authenticate, requireRole('LAWYER', 'STAFF', 'OWNER'));

/* All requests across all clients. */
staffRouter.get('/requests', async (_request, response, next) => {
    try {
        const result = await query(
            `SELECT r.id, r.subject, r.status, r.created_at, r.updated_at,
                    u.email AS client_email, u.full_name AS client_name
             FROM requests r JOIN users u ON u.id = r.client_id
             ORDER BY r.created_at DESC`
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

const acceptInput = z.object({
    matterType: z.string().trim().max(120).optional(),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(4000).optional()
});

staffRouter.post('/requests/:id/accept', async (request, response, next) => {
    try {
        const input = acceptInput.parse(request.body);
        const matter = await acceptRequest({
            requestId: request.params.id,
            actorId: request.user.sub,
            matterType: input.matterType,
            title: input.title,
            description: input.description
        });
        response.status(201).json({ data: matter });
    } catch (error) { next(error); }
});

const declineInput = z.object({ reason: z.string().trim().max(2000).optional() });

staffRouter.post('/requests/:id/decline', async (request, response, next) => {
    try {
        const input = declineInput.parse(request.body || {});
        const result = await declineRequest({
            requestId: request.params.id,
            actorId: request.user.sub,
            reason: input.reason
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});

const statusInput = z.object({
    status: z.enum(['UNDER_REVIEW', 'ACTION_REQUIRED', 'SCHEDULED', 'COMPLETED', 'CLOSED']),
    note: z.string().trim().max(2000).optional()
});

staffRouter.post('/requests/:id/status', async (request, response, next) => {
    try {
        const input = statusInput.parse(request.body);
        const result = await updateRequestStatus({
            requestId: request.params.id,
            actorId: request.user.sub,
            status: input.status,
            note: input.note
        });
        response.json({ data: result });
    } catch (error) { next(error); }
});
