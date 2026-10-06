// Lipa Namba is the only payment method: clients see it, and an old bank destination can be converted.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { query } from '../src/db.js';

const stamp = Date.now();
async function user(role) {
    const r = await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, email`, [`lipa-${role.toLowerCase()}-${stamp}@example.com`, await bcrypt.hash('StrongPassword123!', 4), `Lipa ${role}`, role]);
    return { ...r.rows[0], token: jwt.sign({ sub: r.rows[0].id, role, email: r.rows[0].email }, config.jwtSecret, { expiresIn: '1h' }) };
}

test('old bank destination is hidden from clients until converted to Lipa Namba', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    await query('UPDATE payment_destinations SET is_active = FALSE');
    const bank = (await query(`INSERT INTO payment_destinations (method, label, bank_name, bank_account_name, bank_account_number, is_active) VALUES ('bank', 'Bank Deposit', 'CRDB', 'Firm', '123', TRUE) RETURNING id`)).rows[0];

    const before = await request(app).get('/api/v1/payments/destinations').set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.equal(before.body.data.length, 0, 'bank is not offered to clients');

    // Only Lipa Namba can be created now.
    await request(app).post('/api/v1/owner/payment-destinations').set('Authorization', `Bearer ${owner.token}`).send({ method: 'bank', label: 'x' }).expect(400);

    // Editing the old row with method=mobile_money converts it.
    const patched = await request(app).patch(`/api/v1/owner/payment-destinations/${bank.id}`).set('Authorization', `Bearer ${owner.token}`)
        .send({ method: 'mobile_money', label: 'Lipa Namba', lipa_number: '5123456', is_active: true }).expect(200);
    assert.equal(patched.body.data.method, 'mobile_money');
    assert.equal(patched.body.data.bank_name, null);

    const after = await request(app).get('/api/v1/payments/destinations').set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.equal(after.body.data.length, 1);
    assert.equal(after.body.data[0].lipa_number, '5123456');

    await query('DELETE FROM payment_destinations WHERE id = $1', [bank.id]);
    await query('DELETE FROM users WHERE id = ANY($1)', [[owner.id, client.id]]);
});

test('Set Payment on a request reaches the client: issued invoice and a notification', async () => {
    const owner = await user('OWNER');
    const client = await user('CLIENT');
    const created = await request(app).post('/api/v1/requests').set('Authorization', `Bearer ${client.token}`)
        .send({ subject: 'Salary', description: 'I want my salary paid please', matterType: 'Employment', helpType: 'unsure', fullName: 'Test', email: 'a@b.co', phone: '1', preferredContact: 'phone' }).expect(201);
    await request(app).post(`/api/v1/owner/requests/${created.body.data.id}/set-payment`).set('Authorization', `Bearer ${owner.token}`)
        .send({ amount: 50000, description: 'Initial consultation' }).expect(200);
    const invoices = await request(app).get('/api/v1/invoices').set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.equal(invoices.body.data.length, 1);
    assert.equal(invoices.body.data[0].status, 'ISSUED');
    assert.equal(invoices.body.data[0].payment_status, 'PAYMENT_REQUIRED');
    const notes = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.ok(notes.body.data.some((n) => n.title === 'Payment requested'), 'the client is notified');
    const detail = await request(app).get(`/api/v1/requests/${created.body.data.id}`).set('Authorization', `Bearer ${client.token}`).expect(200);
    assert.equal(detail.body.data.invoice.total, '50000.00');
    await query('DELETE FROM users WHERE id = ANY($1)', [[owner.id, client.id]]).catch(() => {});
});
