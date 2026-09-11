import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

// Map of userId -> Set of Response objects (SSE connections)
const userStreams = new Map();

/* Monotonic event id so clients can dedupe after a reconnect. */
let eventSequence = 0;
function nextEventId() { return ++eventSequence; }

/* Express middleware. Authenticates via Bearer header OR ?token= query
   parameter (EventSource cannot set custom headers). Only GET requests to
   /api/v1/events are handled; everything else falls through to the app. */
export function sseMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();

    const path = req.path || (req.url ? new URL(req.url, 'http://localhost').pathname : '');
    if (path !== '/api/v1/events' && path !== '/events') return next();

    let user;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try { user = jwt.verify(authHeader.slice(7), config.jwtSecret); } catch { user = null; }
    }
    if (!user) {
        const token = req.query && req.query.token;
        if (token) {
            try { user = jwt.verify(token, config.jwtSecret); } catch { user = null; }
        }
    }
    if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }));
        return;
    }

    const userId = user.sub;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    if (!userStreams.has(userId)) userStreams.set(userId, new Set());
    userStreams.get(userId).add(res);

    // Send initial connection event (after registration so it is delivered)
    sendToUser(userId, { type: 'connected', timestamp: Date.now() });

    const cleanup = () => {
        const set = userStreams.get(userId);
        if (set) {
            set.delete(res);
            if (set.size === 0) userStreams.delete(userId);
        }
    };
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
}

export function sendToUser(userId, event) {
    const set = userStreams.get(userId);
    if (!set) return;
    const payload = `id: ${nextEventId()}\ndata: ${JSON.stringify(event)}\n\n`;
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

/* Request events */
export async function notifyRequestCreated(requestId, clientId, subject) {
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'request.created',
            requestId,
            clientId,
            subject: subject.slice(0, 160),
            timestamp: Date.now()
        });
    }
}

export async function notifyRequestStatusChanged(requestId, clientId, status, note) {
    sendToUser(clientId, {
        type: 'request.status_changed',
        requestId,
        status,
        note: note || null,
        timestamp: Date.now()
    });
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'request.status_changed',
            requestId,
            clientId,
            status,
            note: note || null,
            timestamp: Date.now()
        });
    }
}

export async function notifyRequestMoreInfo(requestId, clientId, items) {
    sendToUser(clientId, {
        type: 'request.more_info_required',
        requestId,
        items: items.slice(0, 200),
        timestamp: Date.now()
    });
}

export async function notifyRequestAccepted(requestId, clientId, matterId, reference) {
    sendToUser(clientId, {
        type: 'request.accepted',
        requestId,
        matterId,
        reference,
        timestamp: Date.now()
    });
}

export async function notifyRequestDeclined(requestId, clientId, reason) {
    sendToUser(clientId, {
        type: 'request.declined',
        requestId,
        reason: reason || null,
        timestamp: Date.now()
    });
}

/* Matter events */
export async function notifyMatterCreated(matterId, clientId, reference, title) {
    sendToUser(clientId, {
        type: 'matter.created',
        matterId,
        reference,
        title: title || null,
        timestamp: Date.now()
    });
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'matter.created',
            matterId,
            clientId,
            reference,
            title: title || null,
            timestamp: Date.now()
        });
    }
}

export async function notifyMatterStatusChanged(matterId, clientId, status, reason) {
    sendToUser(clientId, {
        type: 'matter.status_changed',
        matterId,
        status,
        reason: reason || null,
        timestamp: Date.now()
    });
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'matter.status_changed',
            matterId,
            clientId,
            status,
            reason: reason || null,
            timestamp: Date.now()
        });
    }
}

/* Notification event */
export async function notifyNotificationCreated(userId, notification) {
    sendToUser(userId, {
        type: 'notification.created',
        notification: {
            id: notification.id,
            kind: notification.kind,
            title: notification.title,
            body: notification.body,
            entity_type: notification.entity_type,
            entity_id: notification.entity_id,
            created_at: notification.created_at
        },
        timestamp: Date.now()
    });
}

/* Appointment events */
export async function notifyAppointmentCreated(appointmentId, clientId, matterId, startsAt) {
    sendToUser(clientId, {
        type: 'appointment.created',
        appointmentId,
        matterId,
        starts_at: startsAt,
        timestamp: Date.now()
    });
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'appointment.created',
            appointmentId,
            clientId,
            matterId,
            starts_at: startsAt,
            timestamp: Date.now()
        });
    }
}

export async function notifyAppointmentUpdated(appointmentId, clientId, matterId, startsAt, status) {
    sendToUser(clientId, {
        type: 'appointment.updated',
        appointmentId,
        matterId,
        starts_at: startsAt,
        status,
        timestamp: Date.now()
    });
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'appointment.updated',
            appointmentId,
            clientId,
            matterId,
            starts_at: startsAt,
            status,
            timestamp: Date.now()
        });
    }
}

export async function notifyAppointmentCancelled(appointmentId, clientId, matterId) {
    sendToUser(clientId, {
        type: 'appointment.cancelled',
        appointmentId,
        matterId,
        timestamp: Date.now()
    });
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'appointment.cancelled',
            appointmentId,
            clientId,
            matterId,
            timestamp: Date.now()
        });
    }
}

export async function notifyAppointmentCompleted(appointmentId, clientId, matterId) {
    sendToUser(clientId, {
        type: 'appointment.completed',
        appointmentId,
        matterId,
        timestamp: Date.now()
    });
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'appointment.completed',
            appointmentId,
            clientId,
            matterId,
            timestamp: Date.now()
        });
    }
}

/* Document requested event */
export async function notifyDocumentRequested(matterId, clientId, description) {
    sendToUser(clientId, {
        type: 'document.requested',
        matterId,
        description: description.slice(0, 200),
        timestamp: Date.now()
    });
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) {
        sendToUser(o.id, {
            type: 'document.requested',
            matterId,
            clientId,
            description: description.slice(0, 200),
            timestamp: Date.now()
        });
    }
}

async function getConversationParticipants(conversationId) {
    const result = await query(
        `SELECT c.client_id AS convo_client, c.request_id, m.client_id AS matter_client, m.assigned_to
         FROM conversations c
         LEFT JOIN matters m ON m.id = c.matter_id
         WHERE c.id = $1 LIMIT 1`,
        [conversationId]
    );
    if (result.rowCount === 0) return [];
    const row = result.rows[0];
    const participants = [row.convo_client, row.matter_client].filter(Boolean);
    if (row.assigned_to) participants.push(row.assigned_to);
    const owners = await query(`SELECT id FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
    for (const o of owners.rows) participants.push(o.id);
    return [...new Set(participants)];
}
