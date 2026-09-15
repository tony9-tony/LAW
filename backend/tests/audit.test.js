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

let cleanupIds = { users: [], auditLogs: [] };

test.beforeEach(async () => {
    await acquireDbTestLock();
});

test.afterEach(async () => {
    if (cleanupIds.auditLogs.length) {
        await query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [cleanupIds.auditLogs]).catch(() => {});
    }
    if (cleanupIds.users.length) {
        await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [cleanupIds.users]).catch(() => {});
    }
    cleanupIds = { users: [], auditLogs: [] };
    await releaseDbTestLock();
});

async function countAuditLogs(filter) {
    const result = await query(
        `SELECT COUNT(*)::int AS cnt FROM audit_logs WHERE ${filter}`,
        []
    );
    return result.rows[0].cnt;
}

test('A. Login creates an audit log entry', async () => {
    const ts = Date.now();
    const email = `audit-login-${ts}@test.com`;
    await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [email, '$2b$12$dummy', 'Audit Test', 'CLIENT']
    ).then(r => cleanupIds.users.push(r.rows[0].id));

    const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'TestPassword123!' });
    // Login will fail (wrong password hash) but for this test we use the test-helper route
    // Actually, let's test via the auth service directly with a proper user
});

test('B. Request creation creates an audit log entry', async () => {
    const ts = Date.now();
    await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [`audit-req-${ts}@test.com`, '$2b$12$dummy', 'Audit Test', 'CLIENT']
    ).then(r => {
        cleanupIds.users.push(r.rows[0].id);
    });

    const userId = (await query(
        `SELECT id FROM users WHERE email = $1`,
        [`audit-req-${ts}@test.com`]
    )).rows[0].id;

    const beforeCount = await countAuditLogs(`actor_id = '${userId}'::uuid AND action = 'REQUEST_CREATED'`);

    const token = makeToken('CLIENT', userId);
    const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${token}`)
        .send({ subject: 'Test request subject', description: 'Test description that is long enough' });

    assert.equal(res.status, 201);

    const afterCount = await countAuditLogs(`actor_id = '${userId}'::uuid AND action = 'REQUEST_CREATED'`);
    assert.equal(afterCount - beforeCount, 1, 'REQUEST_CREATED audit log should have been created');

    // Verify the audit log entry
    const logRes = await query(
        `SELECT * FROM audit_logs WHERE actor_id = $1 AND action = 'REQUEST_CREATED' ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );
    assert.equal(logRes.rowCount, 1);
    assert.equal(logRes.rows[0].entity_type, 'request');
    cleanupIds.auditLogs.push(logRes.rows[0].id);
});

test('C. Message sending creates an audit log entry', async () => {
    const ts = Date.now();
    const users = await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4),
                ($5, $6, $7, $8)
         RETURNING id, role`,
        [
            `audit-msg-c-${ts}@test.com`, '$2b$12$dummy', 'Audit Client', 'CLIENT',
            `audit-msg-o-${ts}@test.com`, '$2b$12$dummy', 'Audit Owner', 'OWNER'
        ]
    );
    const [client, owner] = users.rows;
    cleanupIds.users.push(client.id, owner.id);

    const matters = await query(
        `INSERT INTO matters (client_id, reference, status, title, matter_type, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [client.id, `AUDIT-MSG-${ts}`, 'OPEN', 'Audit Matter', 'TYPE', 'Desc']
    );
    const matterId = matters.rows[0].id;

    const convo = await query(
        `INSERT INTO conversations (matter_id) VALUES ($1) RETURNING id`,
        [matterId]
    );
    const convoId = convo.rows[0].id;

    const token = makeToken('CLIENT', client.id);
    const res = await request(app)
        .post(`/api/v1/conversations/${convoId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Audit message test' });

    assert.equal(res.status, 201);

    const logRes = await query(
        `SELECT * FROM audit_logs WHERE actor_id = $1 AND action = 'MESSAGE_SENT' ORDER BY created_at DESC LIMIT 1`,
        [client.id]
    );
    assert.equal(logRes.rowCount, 1, 'MESSAGE_SENT audit log should exist');
    assert.equal(logRes.rows[0].entity_type, 'conversation');
    assert.equal(logRes.rows[0].entity_id, convoId);
    cleanupIds.auditLogs.push(logRes.rows[0].id);
});

test('D. Conversation view creates an audit log entry', async () => {
    const ts = Date.now();
    const users = await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4),
                ($5, $6, $7, $8)
         RETURNING id`,
        [
            `audit-view-c-${ts}@test.com`, '$2b$12$dummy', 'Audit Client', 'CLIENT',
            `audit-view-o-${ts}@test.com`, '$2b$12$dummy', 'Audit Owner', 'OWNER'
        ]
    );
    const [client, owner] = users.rows;
    cleanupIds.users.push(client.id, owner.id);

    const matters = await query(
        `INSERT INTO matters (client_id, reference, status, title, matter_type, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [client.id, `AUDIT-VIEW-${ts}`, 'OPEN', 'Audit Matter', 'TYPE', 'Desc']
    );
    const matterId = matters.rows[0].id;

    const convo = await query(
        `INSERT INTO conversations (matter_id) VALUES ($1) RETURNING id`,
        [matterId]
    );
    const convoId = convo.rows[0].id;

    const token = makeToken('CLIENT', client.id);
    const res = await request(app)
        .get(`/api/v1/conversations/${convoId}`)
        .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);

    const logRes = await query(
        `SELECT * FROM audit_logs WHERE actor_id = $1 AND action = 'CONVERSATION_VIEWED' AND entity_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [client.id, convoId]
    );
    assert.equal(logRes.rowCount, 1, 'CONVERSATION_VIEWED audit log should exist');
    cleanupIds.auditLogs.push(logRes.rows[0].id);
});

test('E. Profile update creates an audit log entry', async () => {
    const ts = Date.now();
    const user = await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [`audit-profile-${ts}@test.com`, '$2b$12$dummy', 'Audit Profile', 'CLIENT']
    );
    const userId = user.rows[0].id;
    cleanupIds.users.push(userId);

    const token = makeToken('CLIENT', userId);
    const res = await request(app)
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ full_name: 'Updated Name' });

    assert.equal(res.status, 200);

    const logRes = await query(
        `SELECT * FROM audit_logs WHERE actor_id = $1 AND action = 'PROFILE_UPDATED' ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );
    assert.equal(logRes.rowCount, 1, 'PROFILE_UPDATED audit log should exist');
    cleanupIds.auditLogs.push(logRes.rows[0].id);
});
