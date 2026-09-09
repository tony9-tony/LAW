/* Request workflow service. Implements the SUBUI → backend workflow that
   accepts or declines a client request, creates the associated matter,
   emits timeline events, and notifies the client. */
import { query, withTransaction } from '../db.js';
import { notify } from './notification.service.js';

function referenceForMatter() {
    /* Deterministic-ish short reference: "M-" + 6 hex chars. The DB has a
       UNIQUE constraint on matters.reference so collisions retry. */
    return 'M-' + Math.random().toString(16).slice(2, 8).toUpperCase();
}

export async function recordRequestEvent(requestId, actorId, eventType, title, note = null) {
    await query(
        `INSERT INTO request_events (request_id, actor_id, event_type, title, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [requestId, actorId, eventType, title, note]
    );
}

export async function recordMatterEvent(matterId, actorId, eventType, title, note = null) {
    await query(
        `INSERT INTO matter_events (matter_id, actor_id, event_type, title, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [matterId, actorId, eventType, title, note]
    );
}

export async function acceptRequest({ requestId, actorId, matterType, title, description }) {
    /* Idempotent: refuse to create a second matter for a single request. */
    const existing = await query(
        `SELECT id FROM matters WHERE originating_request_id = $1`,
        [requestId]
    );
    if (existing.rowCount > 0) {
        const error = new Error('Matter already exists for this request');
        error.statusCode = 409;
        error.code = 'MATTER_EXISTS';
        throw error;
    }

    /* Try a few times for the unique reference. The matter INSERT + the
       follow-up updates run inside a single transaction so we never end up
       with a half-created matter. */
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const reference = referenceForMatter();
        try {
            const result = await withTransaction(async (client) => {
                const inserted = await client.query(
                    `INSERT INTO matters
                        (client_id, originating_request_id, reference, status,
                         title, matter_type, description, assigned_to)
                     SELECT client_id, id, $2, 'OPEN', $3, $4, $5, $6
                     FROM requests WHERE id = $1
                     RETURNING id, client_id, reference, status, created_at`,
                    [requestId, reference, title, matterType || null, description || null, actorId]
                );
                if (inserted.rowCount === 0) {
                    const error = new Error('Request not found');
                    error.statusCode = 404;
                    error.code = 'NOT_FOUND';
                    throw error;
                }
                const matter = inserted.rows[0];

                await client.query(
                    `UPDATE requests SET status = 'ACCEPTED', updated_at = NOW() WHERE id = $1`,
                    [requestId]
                );
                await client.query(
                    `INSERT INTO request_events (request_id, actor_id, event_type, title, note)
                     VALUES ($1, $2, 'ACCEPTED', 'Request accepted', 'The firm has accepted your matter.')`,
                    [requestId, actorId]
                );
                await client.query(
                    `INSERT INTO matter_events (matter_id, actor_id, event_type, title, note)
                     VALUES ($1, $2, 'OPENED', 'Matter opened', 'Initial review has begun.')`,
                    [matter.id, actorId]
                );
                return matter;
            });
            /* Notification is a side-effect after the transaction commits. */
            await notify(result.client_id, {
                kind: 'REQUEST_ACCEPTED',
                title: 'Your matter has been accepted',
                body: `Reference ${result.reference}`,
                entityType: 'matter',
                entityId: result.id
            });
            return result;
        } catch (err) {
            if (err && err.code === '23505') { lastError = err; continue; } /* unique_violation */
            throw err;
        }
    }
    const error = new Error('Could not generate unique matter reference');
    error.statusCode = 500;
    error.code = 'REFERENCE_GENERATION_FAILED';
    error.cause = lastError;
    throw error;
}

export async function declineRequest({ requestId, actorId, reason }) {
    const updated = await query(
        `UPDATE requests SET status = 'DECLINED', updated_at = NOW()
         WHERE id = $1 AND status NOT IN ('ACCEPTED', 'DECLINED')
         RETURNING client_id`,
        [requestId]
    );
    if (updated.rowCount === 0) {
        const error = new Error('Request not found or already resolved');
        error.statusCode = 409;
        error.code = 'ALREADY_RESOLVED';
        throw error;
    }
    await recordRequestEvent(requestId, actorId, 'DECLINED', 'Request declined', reason || null);
    await notify(updated.rows[0].client_id, {
        kind: 'REQUEST_DECLINED',
        title: 'Your matter could not be accepted',
        body: reason || 'The firm has reviewed your request and is unable to take it on at this time.',
        entityType: 'request',
        entityId: requestId
    });
    return { id: requestId, status: 'DECLINED' };
}

export async function updateRequestStatus({ requestId, actorId, status, note }) {
    const allowed = new Set(['UNDER_REVIEW', 'ACTION_REQUIRED', 'SCHEDULED', 'COMPLETED', 'CLOSED']);
    if (!allowed.has(status)) {
        const error = new Error('Unsupported status transition');
        error.statusCode = 400;
        error.code = 'INVALID_STATUS';
        throw error;
    }
    const updated = await query(
        `UPDATE requests SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING client_id`,
        [requestId, status]
    );
    if (updated.rowCount === 0) {
        const error = new Error('Request not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    await recordRequestEvent(requestId, actorId, 'STATUS_CHANGED', `Status: ${status}`, note || null);
    await notify(updated.rows[0].client_id, {
        kind: 'REQUEST_STATUS_CHANGED',
        title: 'Your request status has changed',
        body: `Status is now ${status.replace(/_/g, ' ').toLowerCase()}.`,
        entityType: 'request',
        entityId: requestId
    });
    return { id: requestId, status };
}
