/* Request workflow service. Implements the SUBUI → backend workflow that
   accepts or declines a client request, creates the associated matter,
   emits timeline events, and notifies the client. */
import { query, withTransaction } from '../db.js';
import { notify } from './notification.service.js';
import { notifyMessageCreated, notifyRequestCreated, notifyRequestStatusChanged, notifyRequestMoreInfo, notifyRequestAccepted, notifyRequestDeclined, notifyMatterCreated, notifyMatterStatusChanged, notifyAppointmentCreated, notifyAppointmentUpdated, notifyAppointmentCancelled, notifyAppointmentCompleted, notifyDocumentRequested, notifyNotificationCreated } from './sse.js';

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
            await notifyRequestAccepted(requestId, result.client_id, result.id, result.reference);
            await notifyMatterCreated(result.id, result.client_id, result.reference, title);
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
    await notifyRequestDeclined(requestId, updated.rows[0].client_id, reason || null);
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
    await notifyRequestStatusChanged(requestId, updated.rows[0].client_id, status, note || null);
    return { id: requestId, status };
}

export async function requestMoreInfo({ requestId, actorId, items, message, deadline }) {
    const req = await query(
        `SELECT r.id, r.client_id, r.status FROM requests r WHERE r.id = $1 LIMIT 1`,
        [requestId]
    );
    if (req.rowCount === 0) {
        const error = new Error('Request not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const row = req.rows[0];
    const blocked = new Set(['ACCEPTED', 'DECLINED', 'CLOSED']);
    if (blocked.has(row.status)) {
        const error = new Error('Cannot request information for a resolved request');
        error.statusCode = 409;
        error.code = 'INVALID_STATUS';
        throw error;
    }
    const inserted = await withTransaction(async (client) => {
        const info = await client.query(
            `INSERT INTO request_info_requests (request_id, requested_by, items, message, deadline)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, request_id, requested_by, items, message, deadline, created_at`,
            [requestId, actorId, items, message || null, deadline || null]
        );
        await client.query(
            `UPDATE requests SET status = 'ACTION_REQUIRED', updated_at = NOW() WHERE id = $1`,
            [requestId]
        );
        await client.query(
            `INSERT INTO request_events (request_id, actor_id, event_type, title, note)
             VALUES ($1, $2, 'INFO_REQUESTED', 'Additional information requested', $3)`,
            [requestId, actorId, message || null]
        );
        return info.rows[0];
    });
    await notify(row.client_id, {
        kind: 'INFO_REQUESTED',
        title: 'Information requested',
        body: message ? (message.slice(0, 160) + (message.length > 160 ? '…' : '')) : 'The firm has requested additional information for your request.',
        entityType: 'request',
        entityId: requestId
    });
    await notifyRequestMoreInfo(requestId, row.client_id, items);
    return inserted;
}

export async function processClientResponse({ requestId, clientId, response }) {
    const req = await query(
        `SELECT id, client_id, status FROM requests WHERE id = $1 LIMIT 1`,
        [requestId]
    );
    if (req.rowCount === 0) {
        const error = new Error('Request not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const row = req.rows[0];
    if (row.client_id !== clientId) {
        const error = new Error('Resource not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    if (row.status !== 'ACTION_REQUIRED') {
        const error = new Error('This request does not have an outstanding information request');
        error.statusCode = 409;
        error.code = 'INVALID_STATUS';
        throw error;
    }
    const inserted = await withTransaction(async (client) => {
        const infoReq = await client.query(
            `SELECT id FROM request_info_requests WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [requestId]
        );
        const infoRequestId = infoReq.rowCount > 0 ? infoReq.rows[0].id : null;
        const resp = await client.query(
            `INSERT INTO client_responses (request_id, info_request_id, client_id, response)
             VALUES ($1, $2, $3, $4)
             RETURNING id, request_id, client_id, response, created_at`,
            [requestId, infoRequestId, clientId, response]
        );
        await client.query(
            `UPDATE requests SET status = 'UNDER_REVIEW', updated_at = NOW() WHERE id = $1`,
            [requestId]
        );
        await client.query(
            `INSERT INTO request_events (request_id, actor_id, event_type, title, note)
             VALUES ($1, $2, 'CLIENT_RESPONSE', 'Client submitted additional information', $3)`,
            [requestId, clientId, response]
        );
        return resp.rows[0];
    });
    const staff = await query(`SELECT id FROM users WHERE role IN ('LAWYER','STAFF') AND is_active = TRUE`);
    for (const s of staff.rows) {
        await notify(s.id, {
            kind: 'CLIENT_RESPONSE',
            title: 'Client submitted additional information',
            body: response.slice(0, 160),
            entityType: 'request',
            entityId: requestId
        });
    }
    await notifyRequestStatusChanged(requestId, clientId, 'UNDER_REVIEW', 'Client submitted additional information');
    return inserted;
}

const MATTER_STATUSES = new Set(['OPEN', 'ACTIVE', 'ON_HOLD', 'RESOLVED', 'CLOSED']);

export async function updateMatterStatus({ matterId, actorId, status, reason }) {
    if (!MATTER_STATUSES.has(status)) {
        const error = new Error('Unsupported matter status');
        error.statusCode = 400;
        error.code = 'INVALID_STATUS';
        throw error;
    }
    const updated = await query(
        `UPDATE matters SET status = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING client_id, reference`,
        [matterId, status]
    );
    if (updated.rowCount === 0) {
        const error = new Error('Matter not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    await recordMatterEvent(matterId, actorId, 'STATUS_CHANGED', `Matter ${status}`, reason || null);
    await notify(updated.rows[0].client_id, {
        kind: 'MATTER_STATUS_CHANGED',
        title: 'Matter status updated',
        body: `Your matter ${updated.rows[0].reference} is now ${status.toLowerCase()}.`,
        entityType: 'matter',
        entityId: matterId
    });
    await notifyMatterStatusChanged(matterId, updated.rows[0].client_id, status, reason || null);
    return { id: matterId, status, clientId: updated.rows[0].client_id };
}

export async function addInternalNote({ entityType, entityId, authorId, note }) {
    const inserted = await query(
        `INSERT INTO internal_notes (entity_type, entity_id, author_id, note)
         VALUES ($1, $2, $3, $4)
         RETURNING id, entity_type, entity_id, author_id, note, created_at`,
        [entityType, entityId, authorId, note]
    );
    await query(
        entityType === 'matter'
            ? `INSERT INTO matter_events (matter_id, actor_id, event_type, title, note)
               VALUES ($1, $2, 'NOTE_ADDED', 'Internal note added', $3)`
            : `INSERT INTO request_events (request_id, actor_id, event_type, title, note)
               VALUES ($1, $2, 'NOTE_ADDED', 'Internal note added', $3)`,
        [entityId, authorId, note]
    );
    return inserted.rows[0];
}

const APPOINTMENT_STATUSES = new Set(['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']);
const CONSULTATION_TYPES = new Set(['INITIAL_CONSULTATION', 'MATTER_CONSULTATION', 'FOLLOW_UP', 'GENERAL_CONSULTATION']);
const MEETING_MODES = new Set(['IN_PERSON', 'PHONE', 'VIDEO']);

async function checkOverlap(startsAt, endsAt, excludeId = null) {
    const result = await query(
        `SELECT id FROM appointments
         WHERE status NOT IN ('CANCELLED','COMPLETED','NO_SHOW')
           AND starts_at < $1 AND ends_at > $2
           ${excludeId ? 'AND id <> $3' : 'AND FALSE'}
         LIMIT 1`,
        excludeId ? [endsAt, startsAt, excludeId] : [endsAt, startsAt]
    );
    return result.rowCount > 0;
}

export async function scheduleAppointment({ matterId, requestId, actorId, clientId, startsAt, endsAt, consultationType, meetingMode, durationMinutes, locationDetails, notes }) {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (end <= start) {
        const error = new Error('endsAt must be after startsAt');
        error.statusCode = 400;
        error.code = 'INVALID_TIMING';
        throw error;
    }
    if (consultationType && !CONSULTATION_TYPES.has(consultationType)) {
        const error = new Error('Invalid consultation type');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    if (meetingMode && !MEETING_MODES.has(meetingMode)) {
        const error = new Error('Invalid meeting mode');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    /* Resolve the matter: either supplied directly or derived from a requestId.
       General consultations (no matter) are allowed — matterId stays null. */
    let resolvedMatterId = matterId || null;
    if (!resolvedMatterId && requestId) {
        const reqRow = await query(`SELECT id FROM matters WHERE originating_request_id = $1 LIMIT 1`, [requestId]);
        resolvedMatterId = reqRow.rowCount > 0 ? reqRow.rows[0].id : null;
    }

    /* Validate the client + that any matter belongs to that client. */
    const client = await query(`SELECT id FROM users WHERE id = $1 AND role = 'CLIENT' AND is_active = TRUE LIMIT 1`, [clientId]);
    if (client.rowCount === 0) {
        const error = new Error('Client not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    if (resolvedMatterId) {
        const matter = await query(`SELECT id, client_id FROM matters WHERE id = $1 LIMIT 1`, [resolvedMatterId]);
        if (matter.rowCount === 0) {
            const error = new Error('Matter not found');
            error.statusCode = 404;
            error.code = 'NOT_FOUND';
            throw error;
        }
        if (matter.rows[0].client_id !== clientId) {
            const error = new Error('Matter does not belong to the selected client');
            error.statusCode = 400;
            error.code = 'VALIDATION_ERROR';
            throw error;
        }
    }

    /* Double-booking prevention: the firm (single lawyer) cannot be in two
       active appointments at the same time. */
    if (await checkOverlap(startsAt, endsAt)) {
        const error = new Error('This time slot overlaps an existing appointment');
        error.statusCode = 409;
        error.code = 'DOUBLE_BOOKING';
        throw error;
    }

    const inserted = await withTransaction(async (client) => {
        const appt = await client.query(
            `INSERT INTO appointments
                (client_id, matter_id, request_id, consultation_type, meeting_mode, duration_minutes, location_details,
                 starts_at, ends_at, status, notes, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SCHEDULED', $10, NOW(), NOW())
             RETURNING id, client_id, matter_id, consultation_type, meeting_mode, duration_minutes,
                       location_details, starts_at, ends_at, status, notes, created_at, updated_at`,
            [clientId, resolvedMatterId, requestId || null, consultationType || null, meetingMode || null,
             durationMinutes || null, locationDetails || null, startsAt, endsAt, notes || null]
        );
        if (resolvedMatterId) {
            await client.query(
                `INSERT INTO matter_events (matter_id, actor_id, event_type, title, note)
                 VALUES ($1, $2, 'APPOINTMENT_SCHEDULED', 'Appointment scheduled', $3)`,
                [resolvedMatterId, actorId, notes || null]
            );
        }
        return appt.rows[0];
    });

    await notify(clientId, {
        kind: 'APPOINTMENT_SCHEDULED',
        title: 'Appointment scheduled',
        body: `An appointment has been scheduled for ${start.toLocaleString()}.`,
        entityType: 'appointment',
        entityId: inserted.id
    });
    await notifyAppointmentCreated(inserted.id, clientId, resolvedMatterId, startsAt);
    return inserted;
}

export async function rescheduleAppointment({ appointmentId, actorId, startsAt, endsAt, consultationType, meetingMode, durationMinutes, locationDetails, notes }) {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (end <= start) {
        const error = new Error('endsAt must be after startsAt');
        error.statusCode = 400;
        error.code = 'INVALID_TIMING';
        throw error;
    }
    const existing = await query(
        `SELECT id, client_id, matter_id, status FROM appointments WHERE id = $1 LIMIT 1`,
        [appointmentId]
    );
    if (existing.rowCount === 0) {
        const error = new Error('Appointment not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const row = existing.rows[0];

    let updates = [];
    if (startsAt) updates.push('starts_at');
    if (endsAt) updates.push('ends_at');

    /* Only enforce double-booking when the time window actually changes. */
    if (startsAt || endsAt) {
        const newStart = startsAt || row.starts_at;
        const newEnd = endsAt || row.ends_at;
        if (await checkOverlap(newStart, newEnd, appointmentId)) {
            const error = new Error('This time slot overlaps an existing appointment');
            error.statusCode = 409;
            error.code = 'DOUBLE_BOOKING';
            throw error;
        }
    }

    const updated = await query(
        `UPDATE appointments
         SET starts_at = COALESCE($1, starts_at),
             ends_at = COALESCE($2, ends_at),
             consultation_type = COALESCE($3, consultation_type),
             meeting_mode = COALESCE($4, meeting_mode),
             duration_minutes = COALESCE($5, duration_minutes),
             location_details = COALESCE($6, location_details),
             notes = COALESCE($7, notes),
             updated_at = NOW()
         WHERE id = $8
         RETURNING id, client_id, matter_id, starts_at, ends_at, status, notes, updated_at`,
        [startsAt || null, endsAt || null, consultationType || null, meetingMode || null,
         durationMinutes || null, locationDetails || null, notes !== undefined ? notes : null, appointmentId]
    );

    if (row.matter_id) {
        await recordMatterEvent(row.matter_id, actorId, 'APPOINTMENT_RESCHEDULED', 'Appointment rescheduled',
            (startsAt || endsAt) ? null : (notes || null));
    }

    const timeChanged = !!(startsAt || endsAt);
    if (timeChanged) {
        await notify(row.client_id, {
            kind: 'APPOINTMENT_UPDATED',
            title: 'Appointment rescheduled',
            body: `Your appointment has been rescheduled to ${new Date(startsAt || row.starts_at).toLocaleString()}.`,
            entityType: 'appointment',
            entityId: appointmentId
        });
        await notifyAppointmentUpdated(appointmentId, row.client_id, row.matter_id, startsAt || row.starts_at, row.status);
    }
    return updated.rows[0];
}

export async function changeAppointmentStatus({ appointmentId, actorId, status, reason }) {
    if (!APPOINTMENT_STATUSES.has(status)) {
        const error = new Error('Invalid appointment status');
        error.statusCode = 400;
        error.code = 'INVALID_STATUS';
        throw error;
    }
    const existing = await query(`SELECT id, client_id, matter_id, status FROM appointments WHERE id = $1 LIMIT 1`, [appointmentId]);
    if (existing.rowCount === 0) {
        const error = new Error('Appointment not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const row = existing.rows[0];
    const terminal = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW']);
    if (terminal.has(row.status)) {
        const error = new Error('Appointment already resolved');
        error.statusCode = 409;
        error.code = 'ALREADY_RESOLVED';
        throw error;
    }

    const updated = await query(
        `UPDATE appointments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status, updated_at`,
        [status, appointmentId]
    );

    if (row.matter_id) {
        await recordMatterEvent(row.matter_id, actorId, 'APPOINTMENT_STATUS', `Appointment ${status}`, reason || null);
    }

    let kind = 'APPOINTMENT_UPDATED';
    let title = 'Appointment updated';
    let body = `Your appointment status is now ${status.toLowerCase()}.`;
    if (status === 'CANCELLED') { kind = 'APPOINTMENT_CANCELLED'; title = 'Appointment cancelled'; body = 'Your appointment has been cancelled.'; notifyAppointmentCancelled(appointmentId, row.client_id, row.matter_id); }
    else if (status === 'COMPLETED') { kind = 'APPOINTMENT_COMPLETED'; title = 'Appointment completed'; body = 'Your appointment has been marked as completed.'; notifyAppointmentCompleted(appointmentId, row.client_id, row.matter_id); }
    else if (status === 'NO_SHOW') { notifyAppointmentUpdated(appointmentId, row.client_id, row.matter_id, row.starts_at, status); }
    else { notifyAppointmentUpdated(appointmentId, row.client_id, row.matter_id, row.starts_at, status); }

    await notify(row.client_id, { kind, title, body, entityType: 'appointment', entityId: appointmentId });
    return updated.rows[0];
}
