/* In-app notification service. Single source of truth for any user-visible
   notification. Designed to be transport-agnostic: today delivered via the
   REST list endpoint, later extendable to WebSockets without changing the
   underlying model. */
import { query } from '../db.js';

export async function notify(userId, { kind, title, body = null, entityType = null, entityId = null }) {
    const result = await query(
        `INSERT INTO notifications (user_id, kind, title, body, entity_type, entity_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, kind, title, body, entity_type, entity_id, read_at, created_at`,
        [userId, kind, title, body, entityType, entityId]
    );
    return result.rows[0];
}

export async function listForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
    const params = [userId, limit];
    const filter = unreadOnly ? 'AND read_at IS NULL' : '';
    const result = await query(
        `SELECT id, kind, title, body, entity_type, entity_id, read_at, created_at
         FROM notifications
         WHERE user_id = $1 ${filter}
         ORDER BY created_at DESC
         LIMIT $2`,
        params
    );
    return result.rows;
}

export async function markRead(notificationId, userId) {
    const result = await query(
        `UPDATE notifications SET read_at = NOW()
         WHERE id = $1 AND user_id = $2 AND read_at IS NULL
         RETURNING id`,
        [notificationId, userId]
    );
    return result.rowCount > 0;
}

export async function markAllRead(userId) {
    const result = await query(
        `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
    );
    return result.rowCount;
}

export async function unreadCount(userId) {
    const result = await query(
        `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
    );
    return result.rows[0].count;
}
