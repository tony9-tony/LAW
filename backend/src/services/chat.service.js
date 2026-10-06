/* Shared chat logic for the client portal and the owner centre: who may see a
   conversation, how messages are read (replies, reactions, delete for me /
   for everyone, delivery status) and how a new message is stored and announced. */
import { query } from '../db.js';
import { notify } from './notification.service.js';
import { notifyMessageCreated, notifyMessageDelivered } from './sse.js';

export const DELETED_TEXT = 'This message was deleted';

const isOwnerRole = (user) => user?.role === 'OWNER';

/* The conversation row when this user may take part in it, otherwise null. */
export async function findConversationFor(user, conversationId) {
    const result = await query(
        `SELECT c.*, COALESCE(m.client_id, r.client_id, c.client_id) AS resolved_client_id, m.assigned_to
         FROM conversations c
         LEFT JOIN matters m ON m.id = c.matter_id
         LEFT JOIN requests r ON r.id = c.request_id
         WHERE c.id = $1 LIMIT 1`,
        [conversationId]
    );
    const convo = result.rows[0];
    if (!convo) return null;
    if (isOwnerRole(user)) return convo;
    const ids = [convo.resolved_client_id, convo.client_id, convo.assigned_to].filter(Boolean);
    return ids.includes(user.sub) ? convo : null;
}

/* The conversation a message belongs to, when this user may see it. */
export async function findMessageFor(user, messageId) {
    const result = await query(
        `SELECT m.id, m.conversation_id, m.sender_id, m.deleted_at FROM messages m WHERE m.id = $1 LIMIT 1`,
        [messageId]
    );
    const message = result.rows[0];
    if (!message) return null;
    const convo = await findConversationFor(user, message.conversation_id);
    return convo ? { ...message, convo } : null;
}

/* Delivery status of one of my own messages: sent, delivered or read. */
export function statusOf(row) {
    if (row.read_at) return 'read';
    if (row.delivered_at) return 'delivered';
    return 'sent';
}

const MESSAGE_COLUMNS = `
    m.id, m.conversation_id, m.sender_id, m.created_at, m.read_at, m.delivered_at, m.kind, m.document_id, m.parent_message_id,
    (m.deleted_at IS NOT NULL) AS deleted,
    CASE WHEN m.deleted_at IS NOT NULL THEN '' ELSE m.body END AS body,
    u.role AS sender_role, u.full_name AS sender_name,
    d.original_name AS document_name, d.size_bytes AS document_size, d.content_type AS document_type,
    CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
        'id', p.id,
        'body', CASE WHEN p.deleted_at IS NOT NULL THEN '${DELETED_TEXT}' ELSE LEFT(p.body, 160) END,
        'deleted', (p.deleted_at IS NOT NULL),
        'sender_id', p.sender_id,
        'sender_name', pu.full_name
    ) END AS parent,
    COALESCE((SELECT json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id) ORDER BY r.created_at)
              FROM message_reactions r WHERE r.message_id = m.id), '[]'::json) AS reactions`;

const MESSAGE_FROM = `
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN documents d ON d.id = m.document_id
    LEFT JOIN messages p ON p.id = m.parent_message_id
    LEFT JOIN users pu ON pu.id = p.sender_id`;

function present(row, userId) {
    return { ...row, status: row.sender_id === userId ? statusOf(row) : undefined };
}

/* Messages of a conversation for this user: without the ones they deleted for
   themselves; deleted-for-everyone ones come back as an empty tombstone. */
export async function listMessages(user, conversationId, { limit = 50, before, after } = {}) {
    const params = [conversationId, user.sub];
    let where = `WHERE m.conversation_id = $1
                 AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $2)`;
    if (before) { params.push(before); where += ` AND m.created_at < (SELECT created_at FROM messages WHERE id = $${params.length})`; }
    else if (after) { params.push(after); where += ` AND m.created_at > (SELECT created_at FROM messages WHERE id = $${params.length})`; }
    params.push(limit);
    const result = await query(
        `SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM} ${where} ORDER BY m.created_at ASC LIMIT $${params.length}`,
        params
    );
    /* Opening the thread means those messages reached this person. */
    query(`UPDATE messages SET delivered_at = NOW() WHERE conversation_id = $1 AND sender_id <> $2 AND delivered_at IS NULL`, [conversationId, user.sub])
        .then((r) => { if (r.rowCount) announceDelivered(conversationId, user.sub); }).catch(() => {});
    return result.rows.map((row) => present(row, user.sub));
}

export async function getMessage(user, messageId) {
    const result = await query(`SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM} WHERE m.id = $1`, [messageId]);
    return result.rows[0] ? present(result.rows[0], user.sub) : null;
}

async function announceDelivered(conversationId, receiverId) {
    const senders = await query(
        `SELECT DISTINCT sender_id FROM messages WHERE conversation_id = $1 AND sender_id <> $2 AND delivered_at IS NOT NULL`,
        [conversationId, receiverId]
    );
    for (const row of senders.rows) notifyMessageDelivered(conversationId, null, row.sender_id).catch(() => {});
}

/* Who else should hear about a message in this conversation. */
async function recipientsOf(convo, senderId) {
    const recipients = new Set([convo.resolved_client_id, convo.client_id, convo.assigned_to].filter(Boolean));
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) recipients.add(o.id);
    recipients.delete(senderId);
    return recipients;
}

/* Stores a message (text, or a note about a document), tells the other side in
   real time, and marks it delivered when someone received it live. */
export async function postMessage({ user, convo, body, parentMessageId = null, kind = 'TEXT', documentId = null, notifyTitle = null }) {
    if (parentMessageId) {
        const parent = await query(`SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2`, [parentMessageId, convo.id]);
        if (parent.rowCount === 0) {
            const error = new Error('Cannot reply to that message');
            error.statusCode = 403; error.code = 'FORBIDDEN';
            throw error;
        }
    }
    const inserted = await query(
        `INSERT INTO messages (conversation_id, sender_id, body, parent_message_id, kind, document_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [convo.id, user.sub, body, parentMessageId, kind, documentId]
    );
    const messageId = inserted.rows[0].id;
    const message = await getMessage(user, messageId);

    const title = notifyTitle || (isOwnerRole(user) ? 'New message from the firm' : 'New message');
    for (const recipientId of await recipientsOf(convo, user.sub)) {
        await notify(recipientId, { kind: 'NEW_MESSAGE', title, body: body.slice(0, 120), entityType: 'conversation', entityId: convo.id });
    }

    const online = await notifyMessageCreated(convo.id, messageId, user.sub, body, user.role, message.sender_name, {
        parent_message_id: message.parent_message_id, parent: message.parent, kind: message.kind,
        document_id: message.document_id, document_name: message.document_name, document_size: message.document_size
    });
    if (online.length) {
        await query(`UPDATE messages SET delivered_at = NOW() WHERE id = $1`, [messageId]);
        message.delivered_at = new Date().toISOString();
        message.status = 'delivered';
        notifyMessageDelivered(convo.id, messageId, user.sub).catch(() => {});
    }
    return message;
}

/* The conversation of a matter, created on first use. */
export async function conversationForMatter(matterId) {
    await query(`INSERT INTO conversations (matter_id) VALUES ($1) ON CONFLICT (matter_id) DO NOTHING`, [matterId]);
    const result = await query(`SELECT id FROM conversations WHERE matter_id = $1 LIMIT 1`, [matterId]);
    return result.rows[0].id;
}
