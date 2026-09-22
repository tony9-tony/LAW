import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

test('registration rejects weak passwords before database access', async () => {
    const response = await request(app).post('/api/v1/auth/register').send({ email: 'client@example.com', password: 'short', fullName: 'Client Name' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('owner registration preserves OWNER role', async () => {
    const email = `owner-role-${Date.now()}@example.com`;
    const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password: 'StrongPassword123!', fullName: 'Owner Role', role: 'OWNER' });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.role, 'OWNER');
    assert.equal(response.body.data.fullName, 'Owner Role');
});
