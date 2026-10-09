// A document can never be served as a web page: the type comes from the file
// name, only PDFs and images open inline, and a sandbox CSP is always sent.
import os from 'node:os';
import path from 'node:path';
process.chdir(os.tmpdir()); // documents are stored under ./storage of the working directory
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: request } = await import('supertest');
const { app } = await import('../src/app.js');
const { query } = await import('../src/db.js');
const { default: bcrypt } = await import('bcryptjs');
const { contentTypeForName } = await import('../src/services/document.service.js');

const stamp = Date.now();
const password = 'StrongPassword123!';

test('the stored type comes from the name, not from the browser', () => {
    assert.equal(contentTypeForName('report.pdf'), 'application/pdf');
    assert.equal(contentTypeForName('photo.JPG'), 'image/jpeg');
    assert.equal(contentTypeForName('notes.unknown'), 'application/octet-stream');
});

test('a "pdf" uploaded as text/html is served as a PDF, inside a sandbox', async () => {
    const clientEmail = `doc-client-${stamp}@example.com`;
    const ownerEmail = `doc-owner-${stamp}@example.com`;
    await request(app).post('/api/v1/auth/register').send({ email: clientEmail, password, fullName: 'Doc Client' }).expect(201);
    await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Doc Owner', 'OWNER')`, [ownerEmail, await bcrypt.hash(password, 12)]);
    const client = (await request(app).post('/api/v1/auth/login').send({ email: clientEmail, password })).body.data.token;
    const owner = (await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password })).body.data.token;
    const clientId = (await query('SELECT id FROM users WHERE email = $1', [clientEmail])).rows[0].id;
    const matter = (await query(`INSERT INTO matters (client_id, reference, status, title) VALUES ($1, $2, 'OPEN', 'Doc safety') RETURNING id`, [clientId, `DS-${stamp}`])).rows[0];

    const evil = Buffer.from('<html><script>alert(document.cookie)</script></html>');
    const up = await request(app).post('/api/v1/documents').set('Authorization', `Bearer ${client}`)
        .field('matter_id', matter.id)
        .attach('file', evil, { filename: 'report.pdf', contentType: 'text/html' });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.data.content_type, 'application/pdf');

    const inline = await request(app).get(`/api/v1/documents/${up.body.data.id}/download?inline=1`).set('Authorization', `Bearer ${client}`);
    assert.equal(inline.status, 200);
    assert.match(inline.headers['content-type'], /application\/pdf/);
    assert.match(inline.headers['content-security-policy'], /sandbox/);
    assert.equal(inline.headers['x-content-type-options'], 'nosniff');

    const asOwner = await request(app).get(`/api/v1/owner/documents/${up.body.data.id}/download`).set('Authorization', `Bearer ${owner}`);
    assert.equal(asOwner.status, 200);
    assert.doesNotMatch(asOwner.headers['content-type'], /html/);
    assert.match(asOwner.headers['content-security-policy'], /sandbox/);

    const html = await request(app).post('/api/v1/documents').set('Authorization', `Bearer ${client}`)
        .field('matter_id', matter.id)
        .attach('file', evil, { filename: 'page.html', contentType: 'text/html' });
    assert.equal(html.status, 400, 'an .html file is refused outright');
});
