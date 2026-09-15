/* Audit logging helper.
   Writes a row to audit_logs for security-relevant client actions so the
   OWNER admin page can review activity. Non-blocking: errors are swallowed
   to avoid disrupting the primary request flow. */
import { query } from '../db.js';

export async function logAudit({ actorId, action, entityType, entityId = null, metadata = {} }) {
    try {
        await query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [actorId, action, entityType, entityId, JSON.stringify(metadata)]
        );
    } catch (err) {
        console.error(`[AUDIT] Failed to write audit log for ${action} on ${entityType}:${entityId}:`, err.message);
    }
}
