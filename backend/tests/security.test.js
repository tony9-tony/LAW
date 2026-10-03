// Sign-in security: client-only sign-up, httpOnly session cookie, sign-out,
// failed sign-in limit and no fixed JWT secret.
process.env.LOGIN_ATTEMPT_LIMIT = '3';
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: request } = await import('supertest');
const { app } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const { query } = await import('../src/db.js');

const stamp = Date.now();
const email = `security-${stamp}@example.com`;
const password = 'StrongPassword123!';

test('there is no fixed development JWT secret', () => {
    assert.notEqual(config.jwtSecret, 'development-only-secret');
    assert.ok(String(config.jwtSecret).length >= 32);
});

test('sign-up always creates a client, whatever role is sent', async () => {
    for (const role of ['OWNER', 'LAWYER', 'STAFF']) {
        const res = await request(app).post('/api/v1/auth/register').send({ email: `${role.toLowerCase()}-${stamp}@example.com`, password, fullName: 'Role Try', role });
        assert.equal(res.status, 201);
        assert.equal(res.body.data.role, 'CLIENT', `${role} must not be granted by sign-up`);
    }
});

test('sign-in sets an httpOnly session cookie that works on its own', async () => {
    await request(app).post('/api/v1/auth/register').send({ email, password, fullName: 'Cookie Client' }).expect(201);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    const cookie = (login.headers['set-cookie'] || []).find((c) => c.startsWith('law_session='));
    assert.ok(cookie, 'a law_session cookie is set');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const pair = cookie.split(';')[0];
    const me = await request(app).get('/api/v1/profile').set('Cookie', pair);
    assert.equal(me.status, 200);
    // The pages keep the word "session" where the token used to be: it is ignored, the cookie is used.
    const withMarker = await request(app).get('/api/v1/profile').set('Cookie', pair).set('Authorization', 'Bearer session');
    assert.equal(withMarker.status, 200);
    assert.equal((await request(app).get('/api/v1/profile').set('Authorization', 'Bearer session')).status, 401, 'the marker alone is not a credential');
    // API clients can still use the token itself.
    assert.equal((await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${login.body.data.token}`)).status, 200);
});

test('sign-out removes the session cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout').expect(200);
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('law_session='));
    assert.ok(cookie && /Expires=Thu, 01 Jan 1970/i.test(cookie), 'the cookie is cleared');
});

test('repeated failed sign-ins are blocked for that e-mail', async () => {
    const target = `brute-${stamp}@example.com`;
    for (let i = 0; i < 3; i += 1) {
        const res = await request(app).post('/api/v1/auth/login').send({ email: target, password: 'WrongPassword123!' });
        assert.equal(res.status, 401);
    }
    const blocked = await request(app).post('/api/v1/auth/login').send({ email: target, password: 'WrongPassword123!' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'TOO_MANY_ATTEMPTS');
    // Another e-mail from the same address is not blocked by it.
    const other = await request(app).post('/api/v1/auth/login').send({ email, password });
    assert.equal(other.status, 200);
});

test.after(async () => {
    await query("DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE email LIKE $1)", [`%-${stamp}@example.com`]).catch(() => {});
    await query('DELETE FROM users WHERE email LIKE $1', [`%-${stamp}@example.com`]).catch(() => {});
});
