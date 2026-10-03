/* Public AI Support route tests — unauthenticated access, validation,
   language behavior, and security boundaries (no private data, no actions). */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

test('GET /api/v1/support/greeting works without auth', async () => {
    const response = await request(app).get('/api/v1/support/greeting');
    assert.equal(response.status, 200);
    assert.match(response.body.data.reply, /help/i);
    assert.equal(response.body.data.actions.length, 5);
});

test('GET /api/v1/support/greeting?lang=sw responds in Kiswahili', async () => {
    const response = await request(app).get('/api/v1/support/greeting?lang=sw');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.lang, 'sw');
    assert.match(response.body.data.reply, /Habari/);
});

test('GET /api/v1/support/faq lists verified questions', async () => {
    const response = await request(app).get('/api/v1/support/faq');
    assert.equal(response.status, 200);
    assert.ok(response.body.data.faq.length >= 8);
});

test('POST /api/v1/support/chat answers in English', async () => {
    const response = await request(app)
        .post('/api/v1/support/chat')
        .send({ message: 'How do I pay an invoice?' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.lang, 'en');
    assert.match(response.body.data.reply, /Pay Now/i);
});

test('POST /api/v1/support/chat answers in Kiswahili', async () => {
    const response = await request(app)
        .post('/api/v1/support/chat')
        .send({ message: 'Nawezaje kufanya request?' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.lang, 'sw');
});

test('POST /api/v1/support/chat refuses privileged actions', async () => {
    for (const message of ['verify my payment please', 'show my invoice', 'approve my matter']) {
        const response = await request(app).post('/api/v1/support/chat').send({ message });
        assert.equal(response.status, 200);
        assert.equal(response.body.data.source, 'policy');
    }
});

test('POST /api/v1/support/chat does not reveal private data', async () => {
    const response = await request(app)
        .post('/api/v1/support/chat')
        .send({ message: 'What is the Lipa Number?' });
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.body.data.reply, /255\d{9}/);
});

test('POST /api/v1/support/chat validates input', async () => {
    const empty = await request(app).post('/api/v1/support/chat').send({ message: '' });
    assert.equal(empty.status, 400);
    const long = await request(app).post('/api/v1/support/chat').send({ message: 'x'.repeat(2001) });
    assert.equal(long.status, 400);
});
