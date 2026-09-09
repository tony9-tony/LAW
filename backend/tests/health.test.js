import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

test('health endpoint reports an available API', async () => {
    const response = await request(app).get('/api/v1/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, { status: 'ok' });
});

test('requests endpoint requires authentication', async () => {
    const response = await request(app).get('/api/v1/requests');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
});
