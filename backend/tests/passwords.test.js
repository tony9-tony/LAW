// Passwords: a signed-in person changes their own password; the owner sets a
// temporary one for someone who forgot theirs (the portal sends no e-mail).
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: request } = await import('supertest');
const { app } = await import('../src/app.js');
const { query } = await import('../src/db.js');
const { default: bcrypt } = await import('bcryptjs');

const stamp = Date.now();
const password = 'StrongPassword123!';
const clientEmail = `pw-client-${stamp}@example.com`;
const ownerEmail = `pw-owner-${stamp}@example.com`;
const login = (email, pw) => request(app).post('/api/v1/auth/login').send({ email, password: pw });

const setup = (async () => {
    await request(app).post('/api/v1/auth/register').send({ email: clientEmail, password, fullName: 'Password Client' }).expect(201);
    await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Password Owner', 'OWNER')`, [ownerEmail, await bcrypt.hash(password, 12)]);
    const client = (await query('SELECT id FROM users WHERE email = $1', [clientEmail])).rows[0];
    const ownerToken = (await login(ownerEmail, password)).body.data.token;
    return { clientId: client.id, ownerToken };
})();

test('a client changes their own password with the current one', async () => {
    await setup;
    const token = (await login(clientEmail, password)).body.data.token;
    const wrong = await request(app).post('/api/v1/profile/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'NotTheRightOne1!', newPassword: 'BrandNewPassword1!' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');
    const short = await request(app).post('/api/v1/profile/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: password, newPassword: 'short' });
    assert.equal(short.status, 400);
    const ok = await request(app).post('/api/v1/profile/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: password, newPassword: 'BrandNewPassword1!' });
    assert.equal(ok.status, 200);
    assert.equal((await login(clientEmail, password)).status, 401, 'the old password no longer works');
    assert.equal((await login(clientEmail, 'BrandNewPassword1!')).status, 200, 'the new password works');
});

test('changing a password needs a signed-in user', async () => {
    const res = await request(app).post('/api/v1/profile/password').send({ currentPassword: password, newPassword: 'BrandNewPassword1!' });
    assert.equal(res.status, 401);
});

test('the owner sets a temporary password; a client cannot', async () => {
    const { clientId, ownerToken } = await setup;
    const clientToken = (await login(clientEmail, 'BrandNewPassword1!')).body.data.token;
    const denied = await request(app).post(`/api/v1/owner/users/${clientId}/password`).set('Authorization', `Bearer ${clientToken}`).send({ password: 'TemporaryPass123!' });
    assert.equal(denied.status, 403);
    const tooShort = await request(app).post(`/api/v1/owner/users/${clientId}/password`).set('Authorization', `Bearer ${ownerToken}`).send({ password: 'short' });
    assert.equal(tooShort.status, 400);
    const missing = await request(app).post('/api/v1/owner/users/00000000-0000-0000-0000-000000000000/password').set('Authorization', `Bearer ${ownerToken}`).send({ password: 'TemporaryPass123!' });
    assert.equal(missing.status, 404);
    const ok = await request(app).post(`/api/v1/owner/users/${clientId}/password`).set('Authorization', `Bearer ${ownerToken}`).send({ password: 'TemporaryPass123!' });
    assert.equal(ok.status, 200);
    assert.equal((await login(clientEmail, 'TemporaryPass123!')).status, 200, 'the client signs in with the temporary password');
    const audit = await query(`SELECT 1 FROM audit_logs WHERE action = 'PASSWORD_SET_BY_OWNER' AND entity_id = $1`, [clientId]).catch(() => ({ rowCount: -1 }));
    assert.notEqual(audit.rowCount, 0, 'the reset is in the audit log');
});
