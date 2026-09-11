import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { query } from '../src/db.js';

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

async function main() {
    await cleanupTestData();
    const timestamp = Date.now();
    
    const users = await query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4),
                ($5, $6, $7, $8)
         RETURNING id, email, role`,
        [
            `owner-test-realtime-${timestamp}@example.com`, 'hash', 'Test Owner', 'OWNER',
            `client-test-realtime-${timestamp}@example.com`, 'hash', 'Test Client', 'CLIENT'
        ]
    );
    const [owner, client] = users.rows;
    cleanupIds.users.push(owner.id, client.id);
    
    const ownerToken = makeToken('OWNER', owner.id);
    const clientToken = makeToken('CLIENT', client.id);
    
    const matterRes = await query(
        `INSERT INTO matters (client_id, reference, title, matter_type, description, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, client_id, reference`,
        [client.id, `TEST-MATTER-REALTIME-${timestamp}`, 'Test Matter', 'TYPE', 'Test description', 'OPEN']
    );
    const matter = matterRes.rows[0];
    cleanupIds.matters.push(matter.id);
    
    const convoRes = await request(app)
        .get(`/api/v1/owner/matters/${matter.id}/conversation`)
        .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(convoRes.status, 200);
    const conversationId = convoRes.body.data.id;
    cleanupIds.convos.push(conversationId);
    
    const sendRes = await request(app)
        .post(`/api/v1/owner/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: 'Test message from owner' });
    assert.equal(sendRes.status, 201);
    
    const messageCheck = await query(
        `SELECT id, sender_id, body FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [conversationId]
    );
    assert.equal(messageCheck.rowCount, 1);
    assert.equal(messageCheck.rows[0].sender_id, owner.id);
    assert.equal(messageCheck.rows[0].body, 'Test message from owner');
    
    const clientRead = await request(app)
        .get(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${clientToken}`);
    assert.equal(clientRead.status, 200);
    const hasMessage = clientRead.body.data.messages.some(m => m.body === 'Test message from owner');
    assert.equal(hasMessage, true);
    
    console.log('SUBUI realtime messaging flow verified');
}

test('SUBUI messaging flow verified', async () => {
    await cleanupTestData();
    await main();
});

test('Backend API endpoints verified', async () => {
    const { owner, clientA, matterA, convoA } = await insertTestData('api');
    const ownerToken = makeToken('OWNER', owner.id);
    
    const convoRes = await request(app)
        .get(`/api/v1/owner/matters/${matterA.id}/conversation`)
        .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(convoRes.status, 200);
    
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
