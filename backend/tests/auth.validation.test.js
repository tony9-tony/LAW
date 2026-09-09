import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

test('registration rejects weak passwords before database access', async () => {
    const response = await request(app).post('/api/v1/auth/register').send({ email: 'client@example.com', password: 'short', fullName: 'Client Name' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});
