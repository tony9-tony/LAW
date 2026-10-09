// Profile photos can be seen by the right people: the firm's photos by every
// signed-in person, a client's photo by the owner (and the client), never by
// another client. Chat messages carry the sender's photo date.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { query } from '../src/db.js';

const stamp = Date.now();
let seq = 0;
const created = [];
/* A tiny valid PNG (1x1). */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function user(role) {
    const email = `photo-${role.toLowerCase()}-${stamp}-${++seq}@example.com`;
    const r = await query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, await bcrypt.hash(crypto.randomUUID(), 4), `Photo ${role}`, role]
    );
    created.push(r.rows[0].id);
    return { id: r.rows[0].id, token: jwt.sign({ sub: r.rows[0].id, role, email }, config.jwtSecret, { expiresIn: '1h' }) };
}

test.after(async () => {
    if (created.length) await query(`UPDATE users SET is_active = FALSE WHERE id = ANY($1::uuid[])`, [created]);
});

test('who may see whose photo', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    const otherClient = await user('CLIENT');
    await request(app).post('/api/v1/profile/photo').set('Authorization', `Bearer ${owner.token}`).send({ photo: PNG }).expect(200);
    await request(app).post('/api/v1/profile/photo').set('Authorization', `Bearer ${client.token}`).send({ photo: PNG }).expect(200);

    const firmPhoto = await request(app).get(`/api/v1/profile/people/${owner.id}/photo`).set('Authorization', `Bearer ${client.token}`);
    assert.equal(firmPhoto.status, 200, 'a client sees the firm\'s photo');
    assert.match(firmPhoto.headers['content-type'], /image\/png/);

    await request(app).get(`/api/v1/profile/people/${client.id}/photo`).set('Authorization', `Bearer ${owner.token}`).expect(200);
    await request(app).get(`/api/v1/profile/people/${client.id}/photo`).set('Authorization', `Bearer ${client.token}`).expect(200);
    await request(app).get(`/api/v1/profile/people/${client.id}/photo`).set('Authorization', `Bearer ${otherClient.token}`).expect(404);
    await request(app).get(`/api/v1/profile/people/${otherClient.id}/photo`).set('Authorization', `Bearer ${owner.token}`).expect(404);
    await request(app).get(`/api/v1/profile/people/${owner.id}/photo`).expect(401);
});

test('chat messages carry the sender\'s photo date, and the owner\'s lists carry the client\'s', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    await request(app).post('/api/v1/profile/photo').set('Authorization', `Bearer ${owner.token}`).send({ photo: PNG }).expect(200);
    await request(app).post('/api/v1/profile/photo').set('Authorization', `Bearer ${client.token}`).send({ photo: PNG }).expect(200);
    const made = await request(app).post('/api/v1/requests').set('Authorization', `Bearer ${client.token}`)
        .send({ subject: 'Photo check', description: 'Checking that photos travel with messages.' }).expect(201);
    const sent = await request(app).post(`/api/v1/owner/requests/${made.body.data.id}/message`).set('Authorization', `Bearer ${owner.token}`)
        .send({ body: 'Hello from the firm' }).expect(201);
    assert.ok(sent.body.data.message.sender_photo_at, 'the sent message has the owner\'s photo date');

    const thread = await request(app).get(`/api/v1/conversations/${sent.body.data.conversation_id}`).set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.ok(thread.body.data.messages[0].sender_photo_at, 'the client sees the firm\'s photo date');

    const detail = await request(app).get(`/api/v1/owner/requests/${made.body.data.id}`).set('Authorization', `Bearer ${owner.token}`).expect(200);
    assert.ok(detail.body.data.client_photo_at, 'request detail has the client\'s photo date');
    const list = await request(app).get('/api/v1/owner/requests').set('Authorization', `Bearer ${owner.token}`).expect(200);
    assert.ok(list.body.data.find((r) => r.id === made.body.data.id).client_photo_at, 'request list has it too');
});
