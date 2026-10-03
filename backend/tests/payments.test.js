/* Payment route tests — auth guards, role enforcement, and validation.
   DB-dependent flow tests are skipped when Postgres is unavailable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';

const JWT_SECRET = (await import('../src/config.js')).config.jwtSecret; // the same secret the app uses
function makeToken(role) {
    return jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', role, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
}

test('GET /api/v1/payments/destinations requires authentication', async () => {
    const response = await request(app).get('/api/v1/payments/destinations');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
});

test('GET /api/v1/payments requires authentication', async () => {
    const response = await request(app).get('/api/v1/payments');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
});

test('POST /api/v1/payments requires authentication', async () => {
    const response = await request(app)
        .post('/api/v1/payments')
        .send({ invoice_id: '00000000-0000-0000-0000-000000000000', method: 'bank', receipt: 'data:image/png;base64,iVBOR==' });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
});

test('POST /api/v1/payments validates method enum', async () => {
    const token = makeToken('CLIENT');
    const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
            invoice_id: '00000000-0000-0000-0000-000000000000',
            method: 'cash',
            receipt: 'data:image/png;base64,iVBORw0KGgo='
        });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/payments validates invoice_id format', async () => {
    const token = makeToken('CLIENT');
    const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
            invoice_id: 'not-a-uuid',
            method: 'bank',
            receipt: 'data:image/png;base64,iVBORw0KGgo='
        });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/payments requires receipt image', async () => {
    const token = makeToken('CLIENT');
    const response = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
            invoice_id: '00000000-0000-0000-0000-000000000000',
            method: 'bank',
            receipt: ''
        });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/payments/invoice/:invoiceId requires authentication', async () => {
    const response = await request(app).get('/api/v1/payments/invoice/00000000-0000-0000-0000-000000000000');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
});

/* --- OWNER payment management auth tests --- */

test('CLIENT cannot access OWNER payment management endpoints', async () => {
    const token = makeToken('CLIENT');
    const endpoints = [
        ['get', '/api/v1/owner/payments'],
        ['get', '/api/v1/owner/payments/00000000-0000-0000-0000-000000000000'],
        ['post', '/api/v1/owner/payments/00000000-0000-0000-0000-000000000000/verify'],
        ['post', '/api/v1/owner/payments/00000000-0000-0000-0000-000000000000/reject'],
        ['get', '/api/v1/owner/payment-destinations'],
        ['get', '/api/v1/owner/service-catalog'],
    ];
    for (const [method, path] of endpoints) {
        const response = await request(app)[method](path).set('Authorization', `Bearer ${token}`);
        assert.equal(response.status, 403, `${method.toUpperCase()} ${path} should be 403`);
        assert.equal(response.body.error.code, 'FORBIDDEN', `${method.toUpperCase()} ${path} should be FORBIDDEN`);
    }
});

test('OWNER payment management endpoints require authentication', async () => {
    const response = await request(app).get('/api/v1/owner/payments');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
});

test('OWNER can access /api/v1/owner/payments (non-DB guard passes)', async () => {
    const token = makeToken('OWNER');
    const response = await request(app)
        .get('/api/v1/owner/payments')
        .set('Authorization', `Bearer ${token}`);
    assert.notEqual(response.status, 401);
    assert.notEqual(response.status, 403);
    assert.ok([200, 500].includes(response.status), `Expected 200 (OK) or 500 (DB error), got ${response.status}`);
});

test('OWNER can access /api/v1/owner/payment-destinations (non-DB guard passes)', async () => {
    const token = makeToken('OWNER');
    const response = await request(app)
        .get('/api/v1/owner/payment-destinations')
        .set('Authorization', `Bearer ${token}`);
    assert.notEqual(response.status, 401);
    assert.notEqual(response.status, 403);
    assert.ok([200, 500].includes(response.status), `Expected 200 (OK) or 500 (DB error), got ${response.status}`);
});

test('OWNER can access /api/v1/owner/service-catalog (non-DB guard passes)', async () => {
    const token = makeToken('OWNER');
    const response = await request(app)
        .get('/api/v1/owner/service-catalog')
        .set('Authorization', `Bearer ${token}`);
    assert.notEqual(response.status, 401);
    assert.notEqual(response.status, 403);
    assert.ok([200, 500].includes(response.status), `Expected 200 (OK) or 500 (DB error), got ${response.status}`);
});

test('POST /api/v1/owner/payment-destinations validates method enum', async () => {
    const token = makeToken('OWNER');
    const response = await request(app)
        .post('/api/v1/owner/payment-destinations')
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'cash', label: 'Cash' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/owner/payment-destinations validates label required', async () => {
    const token = makeToken('OWNER');
    const response = await request(app)
        .post('/api/v1/owner/payment-destinations')
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'bank' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/owner/service-catalog validates pricing_mode', async () => {
    const token = makeToken('OWNER');
    const response = await request(app)
        .post('/api/v1/owner/service-catalog')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'CONSULT', name: 'Consultation', pricing_mode: 'HOURLY' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/owner/service-catalog validates required fields', async () => {
    const token = makeToken('OWNER');
    const response = await request(app)
        .post('/api/v1/owner/service-catalog')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '', name: '', pricing_mode: 'FIXED' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});
