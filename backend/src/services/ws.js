import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

// Map of userId -> Set of WebSocket connections
const userSockets = new Map();

// Map of conversationId -> Set of userIds currently viewing
const activeViewers = new Map();

export function setupWebSocket(server) {
    const wss = new WebSocketServer({
        server,
        path: '/ws',
        verifyClient: (info, callback) => {
            const url = new URL(info.req.url, `http://${info.req.headers.host}`);
            const token = url.searchParams.get('token');
            if (!token) {
                callback(false, 401, 'Unauthorized');
                return;
            }
            try {
                const payload = jwt.verify(token, config.jwtSecret);
                info.req.user = payload;
                callback(true);
            } catch {
                callback(false, 401, 'Invalid token');
            }
        }
    });

    wss.on('connection', (ws, req) => {
        const user = req.user;
        const userId = user.sub;

        // Track user sockets
        if (!userSockets.has(userId)) userSockets.set(userId, new Set());
        userSockets.get(userId).add(ws);

        ws.on('message', async (raw) => {
            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                return;
            }
            const { type, conversationId, payload } = data;

            try {
                // Verify conversation ownership
                const convo = await query(
                    `SELECT c.id, c.matter_id, m.client_id
                     FROM conversations c
                     JOIN matters m ON m.id = c.matter_id
                     WHERE c.id = $1 LIMIT 1`,
                    [conversationId]
                );
                if (convo.rowCount === 0) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found' }));
                    return;
                }
                const row = convo.rows[0];
                const isOwner = user.role === 'OWNER';
                const isClient = row.client_id === userId;

                if (!isOwner && !isClient) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Not authorized' }));
                    return;
                }

                switch (type) {
                    case 'typing':
                        broadcastToConversation(conversationId, {
                            type: 'message.typing',
                            userId,
                            userName: user.full_name || user.email,
                            isTyping: payload.isTyping,
                            timestamp: Date.now()
                        }, userId);
                        break;

                    case 'read':
                        await markConversationRead(conversationId, userId);
                        broadcastToConversation(conversationId, {
                            type: 'message.read',
                            conversationId,
                            readBy: userId,
                            timestamp: Date.now()
                        }, userId);
                        break;

                    case 'reaction':
                        // REST endpoint handles persistence; WS just relays
                        broadcastToConversation(conversationId, {
                            type: payload.emoji ? 'message.reaction_added' : 'message.reaction_removed',
                            conversationId,
                            messageId: payload.messageId,
                            emoji: payload.emoji,
                            userId,
                            timestamp: Date.now()
                        }, userId);
                        break;
                }
            } catch (err) {
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
        });

        ws.on('close', () => {
            const sockets = userSockets.get(userId);
            if (sockets) {
                sockets.delete(ws);
                if (sockets.size === 0) userSockets.delete(userId);
            }
        });
    });

    // Broadcast to all sockets of authorized participants
    async function broadcastToConversation(conversationId, event, excludeUserId) {
        const participants = await getConversationParticipants(conversationId);
        for (const participantId of participants) {
            if (participantId === excludeUserId) continue;
            const sockets = userSockets.get(participantId);
            if (sockets) {
                const payload = JSON.stringify(event);
                for (const sock of sockets) {
                    if (sock.readyState === WebSocket.OPEN) sock.send(payload);
                }
            }
        }
    }

    return wss;
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

async function markConversationRead(conversationId, userId) {
    await query(
        `UPDATE messages SET read_at = NOW()
         WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
        [conversationId, userId]
    );
}

// Helper for REST endpoints to notify via WebSocket
export function notifyMessageCreated(conversationId, messageId, senderId, body) {
    broadcastToConversation(conversationId, {
        type: 'message.created',
        conversationId,
        message: { id: messageId, sender_id: senderId, body, created_at: new Date().toISOString() },
        timestamp: Date.now()
    }, senderId);
}

export function notifyMessageDelivered(conversationId, messageId, deliveredTo) {
    broadcastToConversation(conversationId, {
        type: 'message.delivered',
        conversationId,
        messageId,
        deliveredTo,
        timestamp: Date.now()
    }, deliveredTo);
}

export function notifyMessageRead(conversationId, messageId, readBy) {
    broadcastToConversation(conversationId, {
        type: 'message.read',
        conversationId,
        messageId,
        readBy,
        timestamp: Date.now()
    }, readBy);
}

export function notifyReaction(conversationId, messageId, emoji, userId, action) {
    broadcastToConversation(conversationId, {
        type: action === 'add' ? 'message.reaction_added' : 'message.reaction_removed',
        conversationId,
        messageId,
        emoji,
        userId,
        timestamp: Date.now()
    }, userId);
}