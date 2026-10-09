// Each signed-in person has their own request allowance: one busy person (or a
// whole office on one connection) cannot lock everyone else out.
process.env.API_RATE_LIMIT = '6';
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: crypto } = await import('node:crypto');
const { default: request } = await import('supertest');
const { default: jwt } = await import('jsonwebtoken');
const { default: bcrypt } = await import('bcryptjs');
const { app } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const { query } = await import('../src/db.js');

const stamp = Date.now();
const created = [];
async function client(n) {
    const email = `ratelimit-${stamp}-${n}@example.com`;
    const r = await query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Rate Limit', 'CLIENT') RETURNING id`,
        [email, await bcrypt.hash(crypto.randomUUID(), 4)]
    );
    created.push(r.rows[0].id);
    return jwt.sign({ sub: r.rows[0].id, role: 'CLIENT', email }, config.jwtSecret, { expiresIn: '1h' });
}

test.after(async () => {
    if (created.length) await query(`UPDATE users SET is_active = FALSE WHERE id = ANY($1::uuid[])`, [created]);
});

test('one person reaching the limit does not block another person on the same connection', async () => {
    const first = await client(1);
    const second = await client(2);
    for (let i = 0; i < 6; i += 1) {
        await request(app).get('/api/v1/requests').set('Authorization', `Bearer ${first}`).expect(200);
    }
    const blocked = await request(app).get('/api/v1/requests').set('Authorization', `Bearer ${first}`);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'TOO_MANY_REQUESTS');

    await request(app).get('/api/v1/requests').set('Authorization', `Bearer ${second}`).expect(200);
});
