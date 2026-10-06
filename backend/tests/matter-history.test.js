// A matter keeps the whole conversation (request chat + matter chat), even once closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { query } from '../src/db.js';
import { createMatterForRequest } from '../src/services/workflow.service.js';

const stamp = Date.now();
let seq = 0;
async function user(role) {
    const r = await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, email`, [`hist-${role.toLowerCase()}-${stamp}-${++seq}@example.com`, await bcrypt.hash('StrongPassword123!', 4), `Hist ${role}`, role]);
    return { ...r.rows[0], token: jwt.sign({ sub: r.rows[0].id, role, email: r.rows[0].email }, config.jwtSecret, { expiresIn: '1h' }) };
}

test('request chat moves into the matter conversation and stays after the matter is closed', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    const created = await request(app).post('/api/v1/requests').set('Authorization', `Bearer ${client.token}`)
        .send({ subject: 'Lease', description: 'Landlord dispute about my lease', matterType: 'Property', helpType: 'unsure', fullName: 'Hist', email: 'a@b.co', phone: '1', preferredContact: 'phone' }).expect(201);
    const requestId = created.body.data.id;

    // The firm writes first, about the request (before any matter exists).
    await request(app).post(`/api/v1/owner/requests/${requestId}/message`).set('Authorization', `Bearer ${owner.token}`).send({ body: 'Before-matter hello' }).expect(201);

    // The matter opens.
    const matter = await createMatterForRequest({ requestId, actorId: owner.id, title: 'Lease dispute', matterType: 'Property', description: 'x' });

    // After opening, more is said in the matter conversation.
    await request(app).post(`/api/v1/owner/requests/${requestId}/message`).set('Authorization', `Bearer ${owner.token}`).send({ body: 'After-matter hello' }).expect(201);

    const convo = await request(app).get(`/api/v1/matters/${matter.id}/conversation`).set('Authorization', `Bearer ${client.token}`).expect(200);
    const thread = await request(app).get(`/api/v1/conversations/${convo.body.data.id}`).set('Authorization', `Bearer ${client.token}`).expect(200);
    const bodies = thread.body.data.messages.map((m) => m.body);
    assert.ok(bodies.includes('Before-matter hello'), 'request-time chat is in the matter conversation');
    assert.ok(bodies.includes('After-matter hello'), 'matter-time chat is in the same conversation');

    // Close the matter: it is still listed with its conversation.
    await query(`UPDATE matters SET status = 'CLOSED' WHERE id = $1`, [matter.id]);
    const list = await request(app).get('/api/v1/matters').set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.ok(list.body.data.some((m) => m.id === matter.id && m.status === 'CLOSED'), 'closed matter stays in My Matters');
    const again = await request(app).get(`/api/v1/conversations/${convo.body.data.id}`).set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.equal(again.body.data.messages.length, 2);
});
