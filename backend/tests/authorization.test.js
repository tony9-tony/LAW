/* Endpoints that require DB access cannot be exercised in this environment
   when Postgres is unavailable, so the suite focuses on what we can verify
   without a live database: authentication guards, validation errors, the
   404 fallback, and the response shape contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';

const JWT_SECRET = process.env.JWT_SECRET || 'development-only-secret';
function makeToken(role) {
    return jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', role, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
}

const guarded = [
    ['get', '/api/v1/profile'],
    ['get', '/api/v1/matters'],
    ['get', '/api/v1/appointments'],
    ['get', '/api/v1/notifications'],
    ['get', '/api/v1/documents'],
    ['get', '/api/v1/conversations/00000000-0000-0000-0000-000000000000'],
    ['get', '/api/v1/requests'],
    ['get', '/api/v1/requests/00000000-0000-0000-0000-000000000000'],
    ['get', '/api/v1/requests/00000000-0000-0000-0000-000000000000/events'],
    ['get', '/api/v1/matters/00000000-0000-0000-0000-000000000000'],
    ['get', '/api/v1/matters/00000000-0000-0000-0000-000000000000/events'],
    ['get', '/api/v1/matters/00000000-0000-0000-0000-000000000000/conversation'],
    ['get', '/api/v1/matters/00000000-0000-0000-0000-000000000000/documents'],
    ['get', '/api/v1/matters/00000000-0000-0000-0000-000000000000/appointments'],
    ['get', '/api/v1/staff/requests'],
    ['post', '/api/v1/staff/requests/00000000-0000-0000-0000-000000000000/accept'],
    ['post', '/api/v1/staff/requests/00000000-0000-0000-0000-000000000000/decline'],
    ['post', '/api/v1/staff/requests/00000000-0000-0000-0000-000000000000/status'],
    ['get', '/api/v1/documents/00000000-0000-0000-0000-000000000000/download'],
    ['post', '/api/v1/conversations/00000000-0000-0000-0000-000000000000/messages'],
    ['post', '/api/v1/conversations/00000000-0000-0000-0000-000000000000/read'],
    ['post', '/api/v1/notifications/00000000-0000-0000-0000-000000000000/read'],
    ['post', '/api/v1/notifications/read-all']
];

for (const [method, path] of guarded) {
    test(`${method.toUpperCase()} ${path} requires authentication`, async () => {
        const response = await request(app)[method](path);
        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, 'UNAUTHENTICATED');
    });
}

test('malformed bearer token is rejected with INVALID_TOKEN', async () => {
    const response = await request(app)
        .get('/api/v1/requests')
        .set('Authorization', 'Bearer not-a-jwt');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'INVALID_TOKEN');
});

test('POST /auth/register validates password length', async () => {
    const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'a@b.co', password: 'short', fullName: 'A' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /auth/register validates email format', async () => {
    const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'not-email', password: 'longenoughpw1', fullName: 'A' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /auth/login validates input', async () => {
    const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.co', password: 'x' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('unknown route returns 404 with stable code', async () => {
    const response = await request(app).get('/api/v1/nope');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'NOT_FOUND');
});

test('error envelope shape is stable', async () => {
    const response = await request(app).get('/api/v1/nope');
    assert.ok(response.body && typeof response.body === 'object');
    assert.ok(response.body.error && typeof response.body.error === 'object');
    assert.equal(typeof response.body.error.code, 'string');
    assert.equal(typeof response.body.error.message, 'string');
});

/* --- OWNER authorization tests --- */
test('CLIENT cannot access OWNER endpoints', async () => {
    const token = makeToken('CLIENT');
    const response = await request(app)
        .get('/api/v1/owner/users')
        .set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('LAWYER cannot access OWNER endpoints', async () => {
    const token = makeToken('LAWYER');
    const response = await request(app)
        .get('/api/v1/owner/analytics')
        .set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('STAFF cannot access OWNER endpoints', async () => {
    const token = makeToken('STAFF');
    const response = await request(app)
        .get('/api/v1/owner/settings')
        .set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('OWNER endpoint requires authentication', async () => {
    const response = await request(app).get('/api/v1/owner/analytics');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
});
