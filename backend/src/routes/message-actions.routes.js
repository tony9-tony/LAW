/* Chat actions shared by the client portal and the owner centre:
   typing, delete for me / for everyone. Reactions live in message-reactions.routes.js. */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { findConversationFor, findMessageFor } from '../services/chat.service.js';
import { notifyTyping, notifyMessageDeleted } from '../services/sse.js';

export const messageActionsRouter = Router();
messageActionsRouter.use(authenticate);

const typingSchema = z.object({ conversationId: z.string().uuid(), isTyping: z.boolean() });

/* POST /api/v1/messages/typing — "is typing…" for the other side. */
messageActionsRouter.post('/typing', async (request, response, next) => {
    try {
        const input = typingSchema.parse(request.body);
        const convo = await findConversationFor(request.user, input.conversationId);
        if (!convo) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        const who = await query('SELECT full_name FROM users WHERE id = $1', [request.user.sub]);
        notifyTyping(convo.id, request.user.sub, who.rows[0]?.full_name || null, input.isTyping).catch(() => {});
        response.json({ data: { ok: true } });
    } catch (error) { next(error); }
});

const deleteSchema = z.object({ scope: z.enum(['me', 'everyone']).default('me') });

/* DELETE /api/v1/messages/:id?scope=me|everyone
   "me" hides it for the caller only. "everyone" is for the sender's own messages:
   the text is removed for both sides and a "This message was deleted" note stays. */
messageActionsRouter.delete('/:messageId', async (request, response, next) => {
    try {
        const { scope } = deleteSchema.parse(request.query);
        const message = await findMessageFor(request.user, request.params.messageId);
        if (!message) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Message not found' } });
        if (scope === 'everyone') {
            if (message.sender_id !== request.user.sub) {
                return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the sender can delete a message for everyone' } });
            }
            await query(`UPDATE messages SET deleted_at = COALESCE(deleted_at, NOW()), deleted_by = $2 WHERE id = $1`, [message.id, request.user.sub]);
            await query(`DELETE FROM message_reactions WHERE message_id = $1`, [message.id]);
        } else {
            await query(
                `INSERT INTO message_hidden (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [message.id, request.user.sub]
            );
        }
        notifyMessageDeleted(message.conversation_id, message.id, request.user.sub, scope).catch(() => {});
        await logAudit({ actorId: request.user.sub, action: scope === 'everyone' ? 'MESSAGE_DELETED_FOR_EVERYONE' : 'MESSAGE_DELETED_FOR_ME', entityType: 'message', entityId: message.id, metadata: { conversation_id: message.conversation_id } });
        response.json({ data: { id: message.id, scope, deleted: true } });
    } catch (error) { next(error); }
});
