// The owner can confirm/decline a booked consultation, ask a client for more
// information (as a list, the way the command centre sends it), and the client
// sees what was asked and can answer; the owner is told about the answer.
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

/* Test people sign in with a signed token only; their password is random and
   they are switched off at the end, so no usable test account is left behind. */
async function user(role) {
    const email = `wf-fix-${role.toLowerCase()}-${stamp}-${++seq}@example.com`;
    const r = await query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, email`,
        [email, await bcrypt.hash(crypto.randomUUID(), 4), `Workflow ${role}`, role]
    );
    created.push(r.rows[0].id);
    return { ...r.rows[0], token: jwt.sign({ sub: r.rows[0].id, role, email }, config.jwtSecret, { expiresIn: '1h' }) };
}

test.after(async () => {
    if (created.length) await query(`UPDATE users SET is_active = FALSE WHERE id = ANY($1::uuid[])`, [created]);
});

/* Each booking gets its own far-future hour so bookings never overlap. */
function slot(daysAhead) {
    const start = new Date(Date.UTC(2031, 0, 1, 6, 0, 0) + daysAhead * 864e5 + (stamp % 1000) * 3600e3);
    return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600e3).toISOString() };
}

test('the owner can confirm a booked consultation', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    const booked = await request(app).post('/api/v1/appointments').set('Authorization', `Bearer ${client.token}`)
        .send({ consultationType: 'INITIAL_CONSULTATION', meetingMode: 'IN_PERSON', ...slot(1) }).expect(201);
    const id = booked.body.data.appointment.id;

    const res = await request(app).post(`/api/v1/owner/appointments/${id}/accept`).set('Authorization', `Bearer ${owner.token}`).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.appointment.status, 'CONFIRMED');
    assert.ok(res.body.data.invoice && res.body.data.invoice.id, 'the consultation keeps its invoice');
});

test('the owner can decline a booked consultation', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    const booked = await request(app).post('/api/v1/appointments').set('Authorization', `Bearer ${client.token}`)
        .send({ consultationType: 'GENERAL_CONSULTATION', meetingMode: 'PHONE', ...slot(2) }).expect(201);
    const id = booked.body.data.appointment.id;

    const res = await request(app).post(`/api/v1/owner/appointments/${id}/decline`).set('Authorization', `Bearer ${owner.token}`).send({ reason: 'Fully booked that day' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'CANCELLED');
});

test('"Request info" accepts the items as a list (command centre) or as text', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    const first = await request(app).post('/api/v1/requests').set('Authorization', `Bearer ${client.token}`)
        .send({ subject: 'Plot boundary', description: 'My neighbour moved the beacons on our plot.' }).expect(201);
    const asList = await request(app).post(`/api/v1/owner/requests/${first.body.data.id}/request-info`).set('Authorization', `Bearer ${owner.token}`)
        .send({ items: ['Title deed', '  Survey map  ', ''], message: 'Please send these' });
    assert.equal(asList.status, 201, JSON.stringify(asList.body));
    assert.equal(asList.body.data.items, 'Title deed\nSurvey map');

    const second = await request(app).post('/api/v1/requests').set('Authorization', `Bearer ${client.token}`)
        .send({ subject: 'Rent arrears', description: 'My tenant has not paid rent for four months.' }).expect(201);
    const asText = await request(app).post(`/api/v1/owner/requests/${second.body.data.id}/request-info`).set('Authorization', `Bearer ${owner.token}`)
        .send({ items: 'Tenancy agreement' });
    assert.equal(asText.status, 201, JSON.stringify(asText.body));

    const empty = await request(app).post(`/api/v1/owner/requests/${second.body.data.id}/request-info`).set('Authorization', `Bearer ${owner.token}`)
        .send({ items: ['', '  '] });
    assert.equal(empty.status, 400, 'an empty list is refused');
});

test('the client sees what the firm asked for, answers it, and the owner is told', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    const made = await request(app).post('/api/v1/requests').set('Authorization', `Bearer ${client.token}`)
        .send({ subject: 'Deposit refund', description: 'My landlord keeps my deposit of three months.' }).expect(201);
    const requestId = made.body.data.id;
    await request(app).post(`/api/v1/owner/requests/${requestId}/request-info`).set('Authorization', `Bearer ${owner.token}`)
        .send({ items: ['Signed tenancy agreement', 'Deposit receipt'], message: 'We need two documents' }).expect(201);

    const seen = await request(app).get(`/api/v1/requests/${requestId}`).set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.equal(seen.body.data.status, 'ACTION_REQUIRED');
    const asked = seen.body.data.info_requests;
    assert.equal(asked.length, 1);
    assert.equal(asked[0].items, 'Signed tenancy agreement\nDeposit receipt');
    assert.equal(asked[0].message, 'We need two documents');
    assert.equal(asked[0].answered, false);

    await request(app).post(`/api/v1/requests/${requestId}/responses`).set('Authorization', `Bearer ${client.token}`)
        .send({ response: 'Agreement dated 1 March; receipt number 4471.', infoRequestId: asked[0].id }).expect(201);

    const after = await request(app).get(`/api/v1/requests/${requestId}`).set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.equal(after.body.data.status, 'UNDER_REVIEW');
    assert.equal(after.body.data.info_requests[0].answered, true);

    const ownerNotes = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${owner.token}`).expect(200);
    assert.ok(ownerNotes.body.data.some((n) => n.kind === 'CLIENT_RESPONSE' && n.entity_id === requestId), 'the owner gets a notification');

    const other = await user('CLIENT');
    await request(app).get(`/api/v1/requests/${requestId}`).set('Authorization', `Bearer ${other.token}`).expect(404);
});

test('pages do not tell browsers to switch every file to https', async () => {
    const res = await request(app).get('/frontend/index.html').expect(200);
    assert.doesNotMatch(res.headers['content-security-policy'] || '', /upgrade-insecure-requests/);
});
