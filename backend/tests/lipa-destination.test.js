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
