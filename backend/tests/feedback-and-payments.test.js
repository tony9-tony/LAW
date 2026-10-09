// Ratings & comments, consultation payments set by the owner, "paid is one
// state", and profile photos.
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: request } = await import('supertest');
const { app } = await import('../src/app.js');
const { query } = await import('../src/db.js');
const { default: bcrypt } = await import('bcryptjs');

const stamp = Date.now();
const password = 'StrongPassword123!';
const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex').toString('base64');

const people = (async () => {
    const clientEmail = `fb-client-${stamp}@example.com`;
    const ownerEmail = `fb-owner-${stamp}@example.com`;
    await request(app).post('/api/v1/auth/register').send({ email: clientEmail, password, fullName: 'Feedback Client' }).expect(201);
    await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Feedback Owner', 'OWNER')`, [ownerEmail, await bcrypt.hash(password, 12)]);
    const client = (await request(app).post('/api/v1/auth/login').send({ email: clientEmail, password })).body.data.token;
    const owner = (await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password })).body.data.token;
    const clientId = (await query('SELECT id FROM users WHERE email = $1', [clientEmail])).rows[0].id;
    return { client, owner, clientId };
})();
const as = (token) => ({ Authorization: `Bearer ${token}` });

test('anyone can rate the firm; the owner sees it with the average', async () => {
    const { owner, client } = await people;
    const bad = await request(app).post('/api/v1/feedback').send({ name: 'X', rating: 9 });
    assert.equal(bad.status, 400);
    const ok = await request(app).post('/api/v1/feedback').send({ name: 'Visitor Rater', rating: 5, comment: `Very clear process ${stamp}`, about: 'both' });
    assert.equal(ok.status, 201);
    const trap = await request(app).post('/api/v1/feedback').send({ name: 'Robot', rating: 1, comment: `spam ${stamp}`, website: 'http://spam' });
    assert.equal(trap.status, 201, 'robots get a quiet success');
    assert.equal((await request(app).get('/api/v1/owner/feedback').set(as(client))).status, 403, 'clients cannot read ratings');
    const list = await request(app).get('/api/v1/owner/feedback').set(as(owner));
    assert.equal(list.status, 200);
    const mine = list.body.data.find((f) => f.comment === `Very clear process ${stamp}`);
    assert.ok(mine && mine.rating === 5 && mine.status === 'NEW');
    assert.ok(!list.body.data.some((f) => f.comment === `spam ${stamp}`), 'the robot trap stored nothing');
    assert.ok(list.body.summary.total >= 1 && list.body.summary.average > 0);
    const read = await request(app).patch(`/api/v1/owner/feedback/${mine.id}`).set(as(owner)).send({ status: 'READ' });
    assert.equal(read.body.data.status, 'READ');
});

test('the owner sets or changes what a consultation costs; a paid one is locked', async () => {
    const { owner, client, clientId } = await people;
    const start = new Date(Date.now() + 5 * 86400000);
    const appt = (await query(`INSERT INTO appointments (client_id, starts_at, ends_at, status) VALUES ($1, $2, $3, 'SCHEDULED') RETURNING id`, [clientId, start, new Date(start.getTime() + 3600000)])).rows[0];
    const set = await request(app).post(`/api/v1/owner/appointments/${appt.id}/set-payment`).set(as(owner)).send({ amount: 75000, description: 'Initial consultation' });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(Number(set.body.data.total), 75000);
    const change = await request(app).post(`/api/v1/owner/appointments/${appt.id}/set-payment`).set(as(owner)).send({ amount: 40000, description: 'Consultation (reduced)' });
    assert.equal(Number(change.body.data.total), 40000);
    const inv = (await request(app).get('/api/v1/invoices').set(as(client))).body.data.find((i) => i.appointment_id === appt.id);
    assert.ok(inv && Number(inv.total) === 40000 && inv.payment_status === 'PAYMENT_REQUIRED', 'the client sees the new amount to pay');
    assert.equal((await request(app).post(`/api/v1/owner/appointments/${appt.id}/set-payment`).set(as(client)).send({ amount: 1, description: 'x' })).status, 403);

    await request(app).patch(`/api/v1/owner/invoices/${inv.id}`).set(as(owner)).send({ status: 'PAID' }).expect(200);
    const after = (await request(app).get(`/api/v1/invoices/${inv.id}`).set(as(client))).body.data;
    assert.equal(after.payment_status, 'PAID', 'marking the invoice PAID also marks its payment PAID');
    assert.ok(after.paid_at);
    const locked = await request(app).post(`/api/v1/owner/appointments/${appt.id}/set-payment`).set(as(owner)).send({ amount: 1, description: 'x' });
    assert.equal(locked.status, 409);
});

test('a profile photo is saved and the owner can see a client\'s photo', async () => {
    const { owner, client, clientId } = await people;
    assert.equal((await request(app).post('/api/v1/profile/photo').set(as(client)).send({ photo: PNG })).status, 200);
    const own = await request(app).get('/api/v1/profile/photo').set(as(client));
    assert.equal(own.status, 200);
    const seen = await request(app).get(`/api/v1/owner/users/${clientId}/photo`).set(as(owner));
    assert.equal(seen.status, 200);
    assert.match(seen.headers['content-type'], /image\/png/);
    assert.equal((await request(app).get(`/api/v1/owner/users/${clientId}/photo`).set(as(client))).status, 403);
});
