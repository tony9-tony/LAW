import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureOwned } from '../lib/authorization.js';
import { findConversationFor, listMessages, postMessage } from '../services/chat.service.js';
import { logAudit } from '../lib/audit.js';

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
                    (SELECT COUNT(*)::int FROM messages WHERE conversation_id = c.id AND sender_id <> $2 AND read_at IS NULL) AS unread_count,
                    (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'This message was deleted' ELSE body END FROM messages WHERE conversation_id = c.id AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = messages.id AND h.user_id = $2) ORDER BY created_at DESC LIMIT 1) AS last_message_body,
                    (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
             FROM conversations c
             LEFT JOIN matters m ON m.id = c.matter_id
             LEFT JOIN requests r ON r.id = c.request_id
              WHERE (m.client_id = $1 OR c.client_id = $1 OR r.client_id = $1)
              ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC
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
        await logAudit({ actorId: request.user.sub, action: 'CONVERSATION_VIEWED', entityType: 'conversation', entityId: convo.id });
        const messages = await listMessages(request.user, convo.id, q);
        const firm = await query(
            `SELECT 1 FROM messages m JOIN users u ON u.id = m.sender_id
             WHERE m.conversation_id = $1 AND u.role <> 'CLIENT' LIMIT 1`,
            [convo.id]
        );
        response.json({ data: { ...convo, firm_has_written: firm.rowCount > 0, messages } });
    } catch (error) { next(error); }
});

const sendInput = z.object({
    body: z.string().trim().min(1).max(4000),
    parentMessageId: z.string().uuid().optional()
});

conversationRouter.post('/:id/messages', async (request, response, next) => {
    try {
        const convoRow = await ensureOwned('conversations', request.params.id, request.user.sub);
        const input = sendInput.parse(request.body);
        const convo = await findConversationFor(request.user, convoRow.id);

        /* The firm speaks first: a client can only reply once someone from
           the firm (owner, lawyer or staff) has written in this conversation. */
        if (request.user.role === 'CLIENT') {
            const firmWrote = await query(
                `SELECT 1 FROM messages m JOIN users u ON u.id = m.sender_id
                 WHERE m.conversation_id = $1 AND u.role <> 'CLIENT' LIMIT 1`,
                [convo.id]
            );
            if (firmWrote.rowCount === 0) {
                return response.status(403).json({ error: { code: 'WAIT_FOR_FIRM', message: 'The firm will message you first. You can reply as soon as they do.' } });
            }
        }

        const message = await postMessage({ user: request.user, convo, body: input.body, parentMessageId: input.parentMessageId || null });
        await logAudit({ actorId: request.user.sub, action: 'MESSAGE_SENT', entityType: 'conversation', entityId: convo.id, metadata: { message_id: message.id, body_length: input.body.length } });
        response.status(201).json({ data: message });
    } catch (error) { next(error); }
});

conversationRouter.post('/:id/read', async (request, response, next) => {
    try {
        const convo = await ensureOwned('conversations', request.params.id, request.user.sub);
        await query(
            `UPDATE messages SET read_at = NOW(), delivered_at = COALESCE(delivered_at, NOW())
             WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
            [convo.id, request.user.sub]
        );
        const { notifyConversationReadAll } = await import('../services/sse.js');
        notifyConversationReadAll(convo.id, request.user.sub).catch(() => {});
        await logAudit({ actorId: request.user.sub, action: 'CONVERSATION_MARKED_READ', entityType: 'conversation', entityId: convo.id });
        response.json({ data: { conversation_id: convo.id, read: true } });
    } catch (error) { next(error); }
});
