// Bad input never shows up as a server error, and database error codes are
// never sent to the browser.
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: request } = await import('supertest');
const { app } = await import('../src/app.js');
const { errorHandler } = await import('../src/middleware/errors.js');

const stamp = Date.now();
const password = 'StrongPassword123!';

test('a malformed id is "not found", not a server error', async () => {
    const email = `err-${stamp}@example.com`;
    await request(app).post('/api/v1/auth/register').send({ email, password, fullName: 'Error Client' }).expect(201);
    const token = (await request(app).post('/api/v1/auth/login').send({ email, password })).body.data.token;
    for (const path of ['/api/v1/matters/not-a-uuid', '/api/v1/invoices/123', "/api/v1/requests/'%20OR%201=1--"]) {
        const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
        assert.equal(res.status, 404, path);
        assert.equal(res.body.error.code, 'NOT_FOUND');
    }
});

test('an unexpected database error hides its internal code', () => {
    let status; let body;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    const original = console.error; console.error = () => {};
    errorHandler(Object.assign(new Error('relation "secret_table" does not exist'), { code: '42P01' }), {}, res, () => {});
    console.error = original;
    assert.equal(status, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(body), /secret_table|42P01/);
});
