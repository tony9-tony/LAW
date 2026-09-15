/* Add reaction and reply endpoints */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureOwned } from '../lib/authorization.js';

export const messageReactionsRouter = Router();
messageReactionsRouter.use(authenticate);

const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });

// Add or update a reaction
messageReactionsRouter.post('/:messageId/reactions', async (request, response, next) => {
    try {
        const input = reactionSchema.parse(request.body);
        // Verify message ownership
        const check = await query(
            `SELECT m.id FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             LEFT JOIN matters mat ON mat.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             WHERE m.id = $1 AND ($3 = 'OWNER' OR mat.client_id = $2 OR c.client_id = $2 OR r.client_id = $2)`,
            [request.params.messageId, request.user.sub, request.user.role]
        );
        if (check.rowCount === 0) {
            return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } });
        }

        const result = await query(
            `INSERT INTO message_reactions (message_id, user_id, emoji)
             VALUES ($1, $2, $3)
             ON CONFLICT (message_id, user_id, emoji) DO UPDATE SET updated_at = NOW()
             RETURNING id, message_id, user_id, emoji, created_at`,
            [request.params.messageId, request.user.sub, input.emoji]
        );

        // Real-time notification
        const { notifyReaction } = await import('../services/sse.js');
        const msgRow = await query(
            `SELECT conversation_id FROM messages WHERE id = $1 LIMIT 1`,
            [request.params.messageId]
        );
        if (msgRow.rowCount > 0) {
            notifyReaction(msgRow.rows[0].conversation_id, request.params.messageId, input.emoji, request.user.sub, 'add').catch(() => {});
        }

        response.status(201).json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

// Remove a reaction
messageReactionsRouter.delete('/:messageId/reactions/:emoji', async (request, response, next) => {
    try {
        const check = await query(
            `SELECT m.id FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             LEFT JOIN matters mat ON mat.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             WHERE m.id = $1 AND ($3 = 'OWNER' OR mat.client_id = $2 OR c.client_id = $2 OR r.client_id = $2)`,
            [request.params.messageId, request.user.sub, request.user.role]
        );
        if (check.rowCount === 0) {
            return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } });
        }

        await query(
            `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
            [request.params.messageId, request.user.sub, request.params.emoji]
        );

        const { notifyReaction } = await import('../services/sse.js');
        const msgRow = await query(
            `SELECT conversation_id FROM messages WHERE id = $1 LIMIT 1`,
            [request.params.messageId]
        );
        if (msgRow.rowCount > 0) {
            notifyReaction(msgRow.rows[0].conversation_id, request.params.messageId, request.params.emoji, request.user.sub, 'remove').catch(() => {});
        }

        response.json({ data: { deleted: true } });
    } catch (error) { next(error); }
});

// List reactions for a message
messageReactionsRouter.get('/:messageId/reactions', async (request, response, next) => {
    try {
        const check = await query(
            `SELECT m.id FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             LEFT JOIN matters mat ON mat.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             WHERE m.id = $1 AND ($3 = 'OWNER' OR mat.client_id = $2 OR c.client_id = $2 OR r.client_id = $2)`,
            [request.params.messageId, request.user.sub, request.user.role]
        );
        if (check.rowCount === 0) {
            return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } });
        }

        const result = await query(
            `SELECT emoji, user_id, created_at FROM message_reactions
             WHERE message_id = $1 ORDER BY created_at ASC`,
            [request.params.messageId]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});