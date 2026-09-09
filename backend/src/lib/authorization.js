/* Authorization helper. Confirms that a row identified by id belongs to
   the authenticated user. Use in every client-facing route that fetches
   a single resource. */
import { query } from '../db.js';

/* Fixed allowlist — never user-controlled, prevents SQL injection via table name. */
const ALLOWED = new Set(['requests', 'matters', 'appointments', 'conversations', 'documents']);

function ownershipQuery(table, id, userId) {
    switch (table) {
        case 'conversations':
            return {
                text: `SELECT conversations.* FROM conversations JOIN matters ON conversations.matter_id = matters.id WHERE conversations.id = $1 AND matters.client_id = $2 LIMIT 1`,
                params: [id, userId]
            };
        default:
            return {
                text: `SELECT * FROM ${table} WHERE id = $1 AND client_id = $2 LIMIT 1`,
                params: [id, userId]
            };
    }
}

export async function findOwned(table, id, userId) {
    if (!ALLOWED.has(table)) throw new Error('findOwned: unsupported table');
    const q = ownershipQuery(table, id, userId);
    const result = await query(q.text, q.params);
    return result.rows[0] || null;
}

export async function ensureOwned(table, id, userId) {
    const row = await findOwned(table, id, userId);
    if (!row) {
        const error = new Error('Resource not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    return row;
}
