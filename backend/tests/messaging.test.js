/* Real integration tests for messaging/conversation authorization.
   These tests use the actual database to verify the SQL ownership checks,
   not stubs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { query } from '../src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'development-only-secret';

function makeToken(role, sub) {
    return jwt.sign({ sub, role, email: `${sub}@example.com` }, JWT_SECRET, { expiresIn: '1h' });
}

let cleanupIds = { users: [], matters: [], convos: [] };

async function insertTestData(suffix) {
    const s = suffix || '';
    const timestamp = Date.now();
    
    const users = await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4),
                ($5, $6, $7, $8),
                ($9, $10, $11, $12)
         RETURNING id, email, role`,
        [
            `client-a-${timestamp}-${s}@test.com`, 'hash', 'Client A', 'CLIENT',
            `client-b-${timestamp}-${s}@test.com`, 'hash', 'Client B', 'CLIENT',
            `owner-${timestamp}-${s}@test.com`, 'hash', 'Owner', 'OWNER'
        ]
    );
    const [clientA, clientB, owner] = users.rows;
    cleanupIds.users.push(clientA.id, clientB.id, owner.id);

    const matters = await query(
        `INSERT INTO matters (client_id, reference, status, title, matter_type, description)
         VALUES ($1, $2, $3, $4, $5, $6),
                ($7, $8, $9, $10, $11, $12)
         RETURNING id, client_id, reference`,
        [
            clientA.id, `M-A-${s}-${timestamp}`, 'OPEN', 'Matter A', 'TYPE', 'Desc A',
            clientB.id, `M-B-${s}-${timestamp}`, 'OPEN', 'Matter B', 'TYPE', 'Desc B'
        ]
    );
    const [matterA, matterB] = matters.rows;
    cleanupIds.matters.push(matterA.id, matterB.id);

    const convos = await query(
        `INSERT INTO conversations (matter_id) VALUES ($1), ($2) RETURNING id, matter_id`,
        [matterA.id, matterB.id]
    );
    const [convoA, convoB] = convos.rows;
    cleanupIds.convos.push(convoA.id, convoB.id);

    await query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3), ($4, $5, $6)`,
        [convoA.id, clientA.id, 'Hello from A', convoB.id, clientB.id, 'Hello from B']
    );

    return { clientA, clientB, owner, matterA, matterB, convoA, convoB };
}

async function cleanupTestData() {
    if (cleanupIds.convos.length) {
        await query(`DELETE FROM messages WHERE conversation_id = ANY($1::uuid[])`, [cleanupIds.convos]).catch(() => {});
        await query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [cleanupIds.convos]).catch(() => {});
    }
    if (cleanupIds.matters.length) {
        await query(`DELETE FROM matters WHERE id = ANY($1::uuid[])`, [cleanupIds.matters]).catch(() => {});
    }
    if (cleanupIds.users.length) {
        await query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [cleanupIds.users]).catch(() => {});
        await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [cleanupIds.users]).catch(() => {});
    }
    cleanupIds = { users: [], matters: [], convos: [] };
}

test.afterEach(async () => {
    await cleanupTestData();
});

test('A. CLIENT A can access own conversation', async () => {
    const { clientA, convoA } = await insertTestData('A1');
    const token = makeToken('CLIENT', clientA.id);
    const res = await request(app)
        .get(`/api/v1/conversations/${convoA.id}`)
        .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data);
    assert.equal(res.body.data.id, convoA.id);
});

test('B. CLIENT A cannot access CLIENT B conversation', async () => {
    const { clientA, convoB } = await insertTestData('B1');
    const token = makeToken('CLIENT', clientA.id);
    const res = await request(app)
        .get(`/api/v1/conversations/${convoB.id}`)
        .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('C. CLIENT cannot access OWNER-only endpoints', async () => {
    await insertTestData('C1');
    const token = makeToken('CLIENT', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const res = await request(app)
        .get('/api/v1/owner/analytics')
        .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('D. LAWYER cannot access OWNER-only endpoints', async () => {
    const token = makeToken('LAWYER', '11111111-1111-1111-1111-111111111111');
    const res = await request(app)
        .get('/api/v1/owner/analytics')
        .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('E. STAFF cannot access OWNER-only endpoints', async () => {
    const token = makeToken('STAFF', '22222222-2222-2222-2222-222222222222');
    const res = await request(app)
        .get('/api/v1/owner/analytics')
        .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('F. OWNER can access any conversation', async () => {
    const { owner, convoA } = await insertTestData('F1');
    const token = makeToken('OWNER', owner.id);
    const res = await request(app)
        .get(`/api/v1/owner/conversations/${convoA.id}`)
        .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data);
    assert.equal(res.body.data.id, convoA.id);
});

test('G. CLIENT cannot send message as another user', async () => {
    const { clientA, clientB, convoA } = await insertTestData('G1');
    const token = makeToken('CLIENT', clientA.id);
    const res = await request(app)
        .post(`/api/v1/conversations/${convoA.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'test', sender_id: clientB.id });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.sender_id, clientA.id);
});

test('H. OWNER reply uses OWNER sender_id, not client-supplied', async () => {
    const { owner, clientA, convoA } = await insertTestData('H1');
    const token = makeToken('OWNER', owner.id);
    const res = await request(app)
        .post(`/api/v1/owner/conversations/${convoA.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Owner reply', sender_id: clientA.id });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.sender_id, owner.id);
});

test('I. Invalid conversation ID returns 404', async () => {
    const token = makeToken('CLIENT', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const res = await request(app)
        .get('/api/v1/conversations/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('J. Empty message body is rejected', async () => {
    const { clientA, convoA } = await insertTestData('J1');
    const token = makeToken('CLIENT', clientA.id);
    const res = await request(app)
        .post(`/api/v1/conversations/${convoA.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('K. Message body >4000 characters is rejected', async () => {
    const { clientA, convoA } = await insertTestData('K1');
    const token = makeToken('CLIENT', clientA.id);
    const res = await request(app)
        .post(`/api/v1/conversations/${convoA.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'x'.repeat(4001) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('L. Pagination parameters are validated', async () => {
    const { clientA, convoA } = await insertTestData('L1');
    const token = makeToken('CLIENT', clientA.id);
    const res = await request(app)
        .get(`/api/v1/conversations/${convoA.id}?limit=abc`)
        .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('M. Client message creates notification for OWNER', async () => {
    const { clientA, owner, convoA } = await insertTestData('M1');
    const token = makeToken('CLIENT', clientA.id);
    const res = await request(app)
        .post(`/api/v1/conversations/${convoA.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Notify owner test' });
    assert.equal(res.status, 201);

    const notifRes = await request(app)
        .get('/api/v1/notifications?unread=true')
        .set('Authorization', `Bearer ${makeToken('OWNER', owner.id)}`);
    assert.equal(notifRes.status, 200);
    assert.ok(notifRes.body.data.some(n => n.kind === 'NEW_MESSAGE' && n.entity_id === convoA.id));
});

test('N. Message persists after retrieval', async () => {
    const { clientA, convoA } = await insertTestData('N1');
    const token = makeToken('CLIENT', clientA.id);
    const sendRes = await request(app)
        .post(`/api/v1/conversations/${convoA.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Persistent message' });
    assert.equal(sendRes.status, 201);
    const messageId = sendRes.body.data.id;

    const getRes = await request(app)
        .get(`/api/v1/conversations/${convoA.id}`)
        .set('Authorization', `Bearer ${token}`);
    assert.equal(getRes.status, 200);
    assert.ok(getRes.body.data.messages.some(m => m.id === messageId));
});

test('O. Mark-read is ownership protected', async () => {
    const { clientB, convoA } = await insertTestData('O1');
    const clientBToken = makeToken('CLIENT', clientB.id);
    const res = await request(app)
        .post(`/api/v1/conversations/${convoA.id}/read`)
        .set('Authorization', `Bearer ${clientBToken}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
});
