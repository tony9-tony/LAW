// The owner can open the receipt a client uploaded (the route used the
// promise-only fs module and failed with a 500 on every receipt).
import os from 'node:os';
import path from 'node:path';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `law-receipts-${Date.now()}`);
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: request } = await import('supertest');
const { app } = await import('../src/app.js');
const { query } = await import('../src/db.js');
const { default: bcrypt } = await import('bcryptjs');

const stamp = Date.now();
const password = 'StrongPassword123!';
const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex').toString('base64');

test('the owner opens the receipt image a client uploaded', async () => {
    const clientEmail = `rc-client-${stamp}@example.com`;
    const ownerEmail = `rc-owner-${stamp}@example.com`;
    await request(app).post('/api/v1/auth/register').send({ email: clientEmail, password, fullName: 'Receipt Client' }).expect(201);
    await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Receipt Owner', 'OWNER')`, [ownerEmail, await bcrypt.hash(password, 12)]);
    const client = (await request(app).post('/api/v1/auth/login').send({ email: clientEmail, password })).body.data.token;
    const owner = (await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password })).body.data.token;
    const as = (token) => ({ Authorization: `Bearer ${token}` });

    await request(app).post('/api/v1/owner/payment-destinations').set(as(owner)).send({ method: 'mobile_money', label: 'Lipa Namba', lipa_number: '5584 2201' });
    const req = await request(app).post('/api/v1/requests').set(as(client)).send({ subject: 'Receipt test request', description: 'A request used to check that receipts open for the owner.' }).expect(201);
    await request(app).post(`/api/v1/owner/requests/${req.body.data.id}/accept`).set(as(owner)).send({ title: 'Receipt test matter' }).expect((r) => assert.ok(r.status < 300, 'accept failed: ' + r.status));
    await request(app).post(`/api/v1/owner/requests/${req.body.data.id}/set-payment`).set(as(owner)).send({ amount: 1000, description: 'Receipt test' }).expect((r) => assert.ok(r.status < 300, `set-payment: ${r.status}`));
    const invoice = (await request(app).get('/api/v1/invoices').set(as(client))).body.data.find((i) => i.request_id === req.body.data.id);
    assert.ok(invoice, 'the client has the invoice');
    const pay = await request(app).post('/api/v1/payments').set(as(client)).send({ invoice_id: invoice.id, method: 'mobile_money', reference_number: `RC${stamp}`, receipt: PNG });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));

    const receipt = await request(app).get(`/api/v1/owner/payments/${pay.body.data.id}/receipt`).set(as(owner));
    assert.equal(receipt.status, 200);
    assert.match(receipt.headers['content-type'], /image\/png/);
    assert.ok(receipt.body.length > 0 || Number(receipt.headers['content-length']) > 0, 'the image bytes are sent');

    assert.equal((await request(app).get(`/api/v1/owner/payments/${pay.body.data.id}/receipt`).set(as(client))).status, 403, 'a client cannot use the owner route');
});
