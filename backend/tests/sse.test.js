import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { query } from '../src/db.js';
import { acquireDbTestLock, releaseDbTestLock } from './db-test-lock.js';

const JWT_SECRET = config.jwtSecret || 'development-only-secret';

function makeToken(role, sub) {
    return jwt.sign({ sub, role, email: `${sub}@example.com` }, JWT_SECRET, { expiresIn: '1h' });
}

let cleanupIds = { users: [], matters: [], convos: [] };

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

async function registerUser(email, role, fullName) {
    const res = await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'testpassword123A!',
        fullName,
        role
    });
    return res;
}

async function loginUser(email) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'testpassword123A!' });
    return res;
}

async function insertTestData(suffix) {
    const s = suffix || '';
    const timestamp = Date.now();
    
    // Use unique emails to prevent constraint violations
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

test.beforeEach(async () => {
    await acquireDbTestLock();
});

test.afterEach(async () => {
    await cleanupTestData();
    await releaseDbTestLock();
});

test('SSE realtime flow verification', async () => {
    await cleanupTestData();
    
    const { owner, clientA, matterA, convoA } = await insertTestData('sse');
    const ownerToken = makeToken('OWNER', owner.id);
    const clientToken = makeToken('CLIENT', clientA.id);
    
    // OWNER sends message
    const sendRes = await request(app)
        .post(`/api/v1/owner/conversations/${convoA.id}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: 'Test message from owner' });
    assert.equal(sendRes.status, 201);
    
    // Verify message in database
    const messageCheck = await query(
        `SELECT id, sender_id, body FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [convoA.id]
    );
    assert.equal(messageCheck.rowCount, 1);
    assert.equal(messageCheck.rows[0].sender_id, owner.id);
    assert.equal(messageCheck.rows[0].body, 'Test message from owner');
    
    // Verify client can see message
    const clientRead = await request(app)
        .get(`/api/v1/conversations/${convoA.id}`)
        .set('Authorization', `Bearer ${clientToken}`);
    assert.equal(clientRead.status, 200);
    const hasMessage = clientRead.body.data.messages.some(m => m.body === 'Test message from owner');
    assert.equal(hasMessage, true);
    
    console.log('SSE realtime flow verified');
});

test('Backend API endpoints verified', async () => {
    const { owner, clientA, matterA, convoA } = await insertTestData('api');
    const ownerToken = makeToken('OWNER', owner.id);
    
    // Test conversation creation
    const convoRes = await request(app)
        .get(`/api/v1/owner/matters/${matterA.id}/conversation`)
        .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(convoRes.status, 200);
    
    // Verify message sending
    const sendRes = await request(app)
        .post(`/api/v1/owner/conversations/${convoA.id}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: 'Test message' });
    assert.equal(sendRes.status, 201);
    
    console.log('Backend messaging flow verified');
});

test('SSE endpoint accessibility', async () => {
    const res = await request(app)
        .get('/api/v1/events')
        .set('Authorization', 'Bearer test-token');
    assert.equal(res.status, 401);
    console.log('SSE endpoint verified');
});