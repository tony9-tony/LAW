import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

// Map of userId -> Set of Response objects (SSE connections)
const userStreams = new Map();

export function setupSSE(server) {
    server.on('request', (req, res) => {
        if (req.url !== '/api/v1/events') return;

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }));
            return;
        }

        const token = authHeader.slice(7);
        let user;
        try {
            user = jwt.verify(token, config.jwtSecret);
        } catch {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'Authentication required' } }));
            return;
        }

        const userId = user.sub;

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        // Send initial connection event
        sendToUser(userId, { type: 'connected', timestamp: Date.now() });

        if (!userStreams.has(userId)) userStreams.set(userId, new Set());
        userStreams.get(userId).add(res);

        req.on('close', () => {
            const set = userStreams.get(userId);
            if (set) {
                set.delete(res);
                if (set.size === 0) userStreams.delete(userId);
            }
        });
    });
}

export function sendToUser(userId, event) {
    const set = userStreams.get(userId);
    if (!set) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of set) {
        try {
            res.write(payload);
        } catch { /* ignore dead connections */ }
    }
}

export async function notifyMessageCreated(conversationId, messageId, senderId, body) {
    const participants = await getConversationParticipants(conversationId);
    for (const pid of participants) {
        if (pid === senderId) continue;
        sendToUser(pid, {
            type: 'message.created',
            conversationId,
            message: { id: messageId, sender_id: senderId, body, created_at: new Date().toISOString() },
            timestamp: Date.now()
        });
    }
}

export async function notifyMessageDelivered(conversationId, messageId, deliveredTo) {
    sendToUser(deliveredTo, {
        type: 'message.delivered',
        conversationId,
        messageId,
        timestamp: Date.now()
    });
}

export async function notifyMessageRead(conversationId, messageId, readBy) {
    const participants = await getConversationParticipants(conversationId);
    for (const pid of participants) {
        if (pid === readBy) continue;
        sendToUser(pid, {
            type: 'message.read',
            conversationId,
            messageId,
            readBy,
            timestamp: Date.now()
        });
    }
}

export async function notifyTyping(conversationId, userId, userName, isTyping) {
    const participants = await getConversationParticipants(conversationId);
    for (const pid of participants) {
        if (pid === userId) continue;
        sendToUser(pid, {
            type: 'message.typing',
            conversationId,
            userId,
            userName,
            isTyping,
            timestamp: Date.now()
        });
    }
}

export async function notifyReaction(conversationId, messageId, emoji, userId, action) {
    const participants = await getConversationParticipants(conversationId);
    for (const pid of participants) {
        if (pid === userId) continue;
        sendToUser(pid, {
            type: action === 'add' ? 'message.reaction_added' : 'message.reaction_removed',
            conversationId,
            messageId,
            emoji,
            userId,
            timestamp: Date.now()
        });
    }
}

async function getConversationParticipants(conversationId) {
    const result = await query(
        `SELECT m.client_id
         FROM conversations c
         JOIN matters m ON m.id = c.matter_id
         WHERE c.id = $1 LIMIT 1`,
        [conversationId]
    );
    if (result.rowCount === 0) return [];
    const row = result.rows[0];
    const participants = [row.client_id];
    const owners = await query(
        `SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`
    );
    for (const o of owners.rows) participants.push(o.id);
    return participants;
}