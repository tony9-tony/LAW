/* Integration tests for OWNER audit logging.
   Uses the real database — verifies that OWNER actions create audit_logs entries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { query } from '../src/db.js';
import { acquireDbTestLock, releaseDbTestLock } from './db-test-lock.js';

const JWT_SECRET = process.env.JWT_SECRET || 'development-only-secret';

function makeToken(role, sub) {
    return jwt.sign({ sub, role, email: `${sub}@example.com` }, JWT_SECRET, { expiresIn: '1h' });
}

let cleanupIds = { users: [], requests: [], matters: [], convos: [], messages: [], auditLogs: [], appointments: [] };

async function insertOwnerTestData(suffix) {
    const s = suffix || '';
    const timestamp = Date.now();

    const users = await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4),
                ($5, $6, $7, $8)
         RETURNING id, email, full_name, role`,
        [
            `owner-audit-c-${timestamp}-${s}@test.com`, 'hash', 'Audit Client', 'CLIENT',
            `owner-audit-o-${timestamp}-${s}@test.com`, 'hash', 'Audit Owner', 'OWNER'
        ]
    );
    const [client, owner] = users.rows;
    cleanupIds.users.push(client.id, owner.id);

    const requests = await query(
        `INSERT INTO requests (client_id, subject, description)
         VALUES ($1, $2, $3)
         RETURNING id, subject, status`,
        [client.id, 'Test request for audit', 'Description long enough for testing']
    );
    const req = requests.rows[0];
    cleanupIds.requests.push(req.id);

    return { client, owner, req };
}

async function cleanupTestData() {
    if (cleanupIds.appointments.length) {
        await query(`DELETE FROM appointments WHERE id = ANY($1::uuid[])`, [cleanupIds.appointments]).catch(() => {});
    }
    if (cleanupIds.auditLogs.length) {
        await query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [cleanupIds.auditLogs]).catch(() => {});
    }
    if (cleanupIds.messages.length) {
        await query(`DELETE FROM messages WHERE id = ANY($1::uuid[])`, [cleanupIds.messages]).catch(() => {});
    }
    if (cleanupIds.convos.length) {
        await query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [cleanupIds.convos]).catch(() => {});
    }
    if (cleanupIds.matters.length) {
        await query(`DELETE FROM matters WHERE id = ANY($1::uuid[])`, [cleanupIds.matters]).catch(() => {});
    }
    if (cleanupIds.requests.length) {
        await query(`DELETE FROM requests WHERE id = ANY($1::uuid[])`, [cleanupIds.requests]).catch(() => {});
    }
    if (cleanupIds.users.length) {
        await query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [cleanupIds.users]).catch(() => {});
        await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [cleanupIds.users]).catch(() => {});
    }
    cleanupIds = { users: [], requests: [], matters: [], convos: [], messages: [], auditLogs: [], appointments: [] };
}

async function getAuditLogs(action) {
    const result = await query(
        `SELECT * FROM audit_logs WHERE action = $1 ORDER BY created_at DESC`,
        [action]
    );
    return result.rows;
}

test.beforeEach(async () => {
    await acquireDbTestLock();
});

test.afterEach(async () => {
    await cleanupTestData();
    await releaseDbTestLock();
});

test('A. Accepting a request creates REQUEST_ACCEPTED audit log', async () => {
    const { client, owner, req } = await insertOwnerTestData('A1');
    const token = makeToken('OWNER', owner.id);

    const res = await request(app)
        .post(`/api/v1/owner/requests/${req.id}/accept`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Test Matter', description: 'Matter description' });

    assert.equal(res.status, 201);
    assert.ok(res.body.data.id, 'Matter should have an id');

    const logs = await getAuditLogs('REQUEST_ACCEPTED');
    const log = logs.find(l => l.actor_id === owner.id && l.metadata.matter_id === res.body.data.id);
    assert.ok(log, 'REQUEST_ACCEPTED audit log should exist with matter_id in metadata');
    cleanupIds.auditLogs.push(log.id);
    cleanupIds.matters.push(res.body.data.id);
});

test('B. Declining a request creates REQUEST_DECLINED audit log', async () => {
    const { client, owner, req } = await insertOwnerTestData('B1');
    const token = makeToken('OWNER', owner.id);

    const res = await request(app)
        .post(`/api/v1/owner/requests/${req.id}/decline`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Not applicable' });

    assert.equal(res.status, 200);

    const logs = await getAuditLogs('REQUEST_DECLINED');
    const log = logs.find(l => l.actor_id === owner.id && l.entity_id === req.id);
    assert.ok(log, 'REQUEST_DECLINED audit log should exist');
    cleanupIds.auditLogs.push(log.id);
});

test('C. Requesting info creates REQUEST_INFO_REQUESTED audit log', async () => {
    const { client, owner, req } = await insertOwnerTestData('C1');
    const token = makeToken('OWNER', owner.id);

    const res = await request(app)
        .post(`/api/v1/owner/requests/${req.id}/request-info`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: 'bank statements', message: 'Please provide', deadline: '2026-12-31T23:59:59Z' });

    assert.equal(res.status, 201);

    const logs = await getAuditLogs('REQUEST_INFO_REQUESTED');
    const log = logs.find(l => l.actor_id === owner.id && l.entity_id === req.id);
    assert.ok(log, 'REQUEST_INFO_REQUESTED audit log should exist');
    assert.equal(log.metadata.has_message, true);
    cleanupIds.auditLogs.push(log.id);
});

test('D. Owner sending message creates OWNER_MESSAGE_SENT audit log', async () => {
    const { client, owner, req } = await insertOwnerTestData('D1');
    const token = makeToken('OWNER', owner.id);

    const convoRes = await request(app)
        .post(`/api/v1/owner/requests/${req.id}/message`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Hello from the firm' });

    assert.equal(convoRes.status, 201);
    const convoId = convoRes.body.data.conversation_id;
    const msgId = convoRes.body.data.message.id;
    cleanupIds.convos.push(convoId);
    cleanupIds.messages.push(msgId);

    const logs = await getAuditLogs('OWNER_MESSAGE_SENT');
    const log = logs.find(l => l.actor_id === owner.id && l.entity_id === convoId);
    assert.ok(log, 'OWNER_MESSAGE_SENT audit log should exist');
    assert.equal(log.metadata.message_id, msgId);
    assert.equal(log.metadata.body_length, 19);
    cleanupIds.auditLogs.push(log.id);
});

test('E. Creating appointment creates APPOINTMENT_CREATED audit log', async () => {
    const { client, owner, req } = await insertOwnerTestData('E1');
    const ownerToken = makeToken('OWNER', owner.id);

    const matterRes = await request(app)
        .post(`/api/v1/owner/requests/${req.id}/accept`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Test Matter', description: 'Matter description' });

    assert.equal(matterRes.status, 201);
    const matterId = matterRes.body.data.id;
    cleanupIds.matters.push(matterId);

    const startsAt = new Date(Date.now() + 86400000 * 2).toISOString();
    const endsAt = new Date(Date.now() + 86400000 * 2 + 3600000).toISOString();

    const apptRes = await request(app)
        .post('/api/v1/owner/appointments')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
            clientId: client.id,
            matterId: matterId,
            startsAt: startsAt,
            endsAt: endsAt,
            durationMinutes: 60,
            notes: 'Initial consultation'
        });

    assert.equal(apptRes.status, 201);

    const logs = await getAuditLogs('APPOINTMENT_CREATED');
    const log = logs.find(l => l.actor_id === owner.id);
    assert.ok(log, 'APPOINTMENT_CREATED audit log should exist');
    assert.equal(log.metadata.matter_id, matterId);
    assert.equal(log.metadata.client_id, client.id);
    cleanupIds.auditLogs.push(log.id);
    cleanupIds.appointments.push(apptRes.body.data.id);
});

test('F. Canceling appointment creates APPOINTMENT_CANCELLED audit log', async () => {
    const { client, owner, req } = await insertOwnerTestData('F1');
    const ownerToken = makeToken('OWNER', owner.id);

    const matterRes = await request(app)
        .post(`/api/v1/owner/requests/${req.id}/accept`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Test Matter', description: 'Matter description' });

    assert.equal(matterRes.status, 201);
    const matterId = matterRes.body.data.id;
    cleanupIds.matters.push(matterId);

    const startsAt = new Date(Date.now() + 86400000 * 3).toISOString();
    const endsAt = new Date(Date.now() + 86400000 * 3 + 3600000).toISOString();

    const apptRes = await request(app)
        .post('/api/v1/owner/appointments')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
            clientId: client.id,
            matterId: matterId,
            startsAt: startsAt,
            endsAt: endsAt,
            durationMinutes: 60,
            notes: 'Test appointment'
        });

    assert.equal(apptRes.status, 201);
    const apptId = apptRes.body.data.id;
    cleanupIds.appointments.push(apptId);

    const cancelRes = await request(app)
        .post(`/api/v1/owner/appointments/${apptId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ reason: 'Client request' });

    assert.equal(cancelRes.status, 200);

    const logs = await getAuditLogs('APPOINTMENT_CANCELLED');
    const log = logs.find(l => l.actor_id === owner.id && l.entity_id === apptId);
    assert.ok(log, 'APPOINTMENT_CANCELLED audit log should exist');
    cleanupIds.auditLogs.push(log.id);
});

test('G. Creating user creates USER_CREATED audit log', async () => {
    const { owner } = await insertOwnerTestData('G1');
    const token = makeToken('OWNER', owner.id);

    const res = await request(app)
        .post('/api/v1/owner/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
            email: `new-user-${Date.now()}@test.com`,
            password: 'TestPassword123!',
            fullName: 'New Staff User',
            role: 'STAFF'
        });

    assert.equal(res.status, 201);
    const userId = res.body.data.id;
    cleanupIds.users.push(userId);

    const logs = await getAuditLogs('USER_CREATED');
    const log = logs.find(l => l.actor_id === owner.id && l.entity_id === userId);
    assert.ok(log, 'USER_CREATED audit log should exist');
    assert.equal(log.metadata.role, 'STAFF');
    cleanupIds.auditLogs.push(log.id);
});

test('H. Adding internal note creates INTERNAL_NOTE_ADDED audit log', async () => {
    const { client, owner, req } = await insertOwnerTestData('H1');
    const token = makeToken('OWNER', owner.id);

    const res = await request(app)
        .post(`/api/v1/owner/requests/${req.id}/internal-note`)
        .set('Authorization', `Bearer ${token}`)
        .send({ note: 'This is an internal note for review' });

    assert.equal(res.status, 201);

    const logs = await getAuditLogs('INTERNAL_NOTE_ADDED');
    const log = logs.find(l => l.actor_id === owner.id && l.entity_id === req.id);
    assert.ok(log, 'INTERNAL_NOTE_ADDED audit log should exist');
    assert.equal(log.metadata.note_id, res.body.data.id);
    cleanupIds.auditLogs.push(log.id);
});

test('I. Audit metadata does not contain sensitive data', async () => {
    const { client, owner, req } = await insertOwnerTestData('I1');
    const token = makeToken('OWNER', owner.id);

    const res = await request(app)
        .post(`/api/v1/owner/requests/${req.id}/message`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Secret sensitive message body' });

    assert.equal(res.status, 201);
    const convoId = res.body.data.conversation_id;
    const msgId = res.body.data.message.id;
    cleanupIds.convos.push(convoId);
    cleanupIds.messages.push(msgId);

    const logs = await getAuditLogs('OWNER_MESSAGE_SENT');
    const log = logs.find(l => l.actor_id === owner.id && l.entity_id === convoId);
    assert.ok(log, 'OWNER_MESSAGE_SENT audit log should exist');

    const metadataStr = JSON.stringify(log.metadata);
    assert.ok(!metadataStr.includes('Secret'), 'Metadata should not contain message body');
    assert.ok(!metadataStr.includes('password'), 'Metadata should not contain password');
    cleanupIds.auditLogs.push(log.id);
});
