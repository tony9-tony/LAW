import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureOwned } from '../lib/authorization.js';
import { notify } from '../services/notification.service.js';

export const conversationRouter = Router();
conversationRouter.use(authenticate);

const messageListSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().uuid().optional(),
    after: z.string().uuid().optional()
});

/* List conversations for the authenticated client. */
conversationRouter.get('/', async (request, response, next) => {
    try {
        const q = z.object({
            limit: z.coerce.number().int().min(1).max(100).default(20),
            offset: z.coerce.number().int().min(0).default(0)
        }).parse(request.query);

        const result = await query(
            `SELECT c.id, c.matter_id, c.request_id, c.client_id, c.subject,
                    m.reference, m.title, m.status AS matter_status, m.client_id AS matter_client_id,
                    r.subject AS request_subject,
                    c.created_at,
                    (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id <> $2 AND read_at IS NULL) AS unread_count,
                    (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_body,
                    (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
             FROM conversations c
             LEFT JOIN matters m ON m.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             WHERE (m.client_id = $1 OR c.client_id = $1 OR r.client_id = $1)
             ORDER BY c.created_at DESC
             LIMIT $3 OFFSET $4`,
            [request.user.sub, request.user.sub, q.limit, q.offset]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* Conversation the client is a participant in. */
conversationRouter.get('/:id', async (request, response, next) => {
    try {
        const q = messageListSchema.parse(request.query);
        const convo = await ensureOwned('conversations', request.params.id, request.user.sub);

        let messagesQuery = `
            SELECT m.id, m.sender_id, m.body, m.created_at, m.read_at,
                    u.role AS sender_role, u.full_name AS sender_name
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = $1
        `;
        const params = [convo.id];

        if (q.before) {
            messagesQuery += ` AND m.created_at < (SELECT created_at FROM messages WHERE id = $${params.length + 1})`;
            params.push(q.before);
        } else if (q.after) {
            messagesQuery += ` AND m.created_at > (SELECT created_at FROM messages WHERE id = $${params.length + 1})`;
            params.push(q.after);
        }

        messagesQuery += ` ORDER BY m.created_at ASC LIMIT $${params.length + 1}`;
        params.push(q.limit);

        const messages = await query(messagesQuery, params);
        response.json({ data: { ...convo, messages: messages.rows } });
    } catch (error) { next(error); }
});

const sendInput = z.object({
    body: z.string().trim().min(1).max(4000),
    parentMessageId: z.string().uuid().optional()
});

conversationRouter.post('/:id/messages', async (request, response, next) => {
    try {
        const convo = await ensureOwned('conversations', request.params.id, request.user.sub);
        const input = sendInput.parse(request.body);

        // Validate parent message ownership if provided
        if (input.parentMessageId) {
            const parentCheck = await query(
                `SELECT m.id FROM messages m
                 JOIN conversations c ON c.id = m.conversation_id
                 LEFT JOIN matters mat ON mat.id = c.matter_id
                 LEFT JOIN requests r ON r.id = c.request_id
                 WHERE m.id = $1
                   AND (mat.client_id = $2 OR c.client_id = $2 OR r.client_id = $2 OR $3 = 'OWNER')`,
                [input.parentMessageId, request.user.sub, request.user.role]
            );
            if (parentCheck.rowCount === 0) {
                return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot reference this message' } });
            }
        }

        const inserted = await query(
            `INSERT INTO messages (conversation_id, sender_id, body, parent_message_id)
             VALUES ($1, $2, $3, $4)
             RETURNING id, sender_id, body, created_at, parent_message_id`,
            [convo.id, request.user.sub, input.body, input.parentMessageId || null]
        );

        /* Resolve participants across matter / request / client scoping. */
        const info = await query(
            `SELECT c.matter_id, c.client_id AS convo_client, c.request_id,
                    m.client_id AS matter_client, m.assigned_to,
                    r.client_id AS request_client
             FROM conversations c
             LEFT JOIN matters m ON m.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
             WHERE c.id = $1 LIMIT 1`,
            [convo.id]
        );
        const row = info.rows[0] || {};
        const recipients = new Set();
        if (row.matter_client) recipients.add(row.matter_client);
        if (row.convo_client) recipients.add(row.convo_client);
        if (row.request_client) recipients.add(row.request_client);
        if (row.assigned_to) recipients.add(row.assigned_to);
        const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
        for (const o of owners.rows) recipients.add(o.id);
        recipients.delete(request.user.sub);

        for (const recipientId of recipients) {
            await notify(recipientId, {
                kind: 'NEW_MESSAGE',
                title: 'New message',
                body: input.body.slice(0, 120),
                entityType: 'conversation',
                entityId: convo.id
            });
        }

        // Real-time notification via SSE
        const { notifyMessageCreated } = await import('../services/sse.js');
        const senderUser = await query('SELECT full_name FROM users WHERE id = $1', [request.user.sub]);
        notifyMessageCreated(convo.id, inserted.rows[0].id, request.user.sub, input.body, request.user.role, senderUser.rows[0]?.full_name || null);

        response.status(201).json({ data: inserted.rows[0] });
    } catch (error) { next(error); }
});

conversationRouter.post('/:id/read', async (request, response, next) => {
    try {
        const convo = await ensureOwned('conversations', request.params.id, request.user.sub);
        await query(
            `UPDATE messages SET read_at = NOW()
             WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
            [convo.id, request.user.sub]
        );
        response.json({ data: { conversation_id: convo.id, read: true } });
    } catch (error) { next(error); }
});
