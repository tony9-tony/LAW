/* Chat (reply, reactions, delete for me / for everyone, status, typing) and
   documents (arrive at the right place, document requests). Real database. */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { query } from '../src/db.js';
import { acquireDbTestLock, releaseDbTestLock } from './db-test-lock.js';

const SECRET = process.env.JWT_SECRET || 'development-only-secret';
const tok = (role, sub) => jwt.sign({ sub, role, email: `${sub}@example.com` }, SECRET, { expiresIn: '1h' });
const ids = { users: [], matters: [], convos: [] };

async function seed(tag) {
    const t = `${Date.now()}-${tag}`;
    const u = await query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,'h','Client A','CLIENT'),($2,'h','Client B','CLIENT'),($3,'h','The Owner','OWNER') RETURNING id`,
        [`a-${t}@t.com`, `b-${t}@t.com`, `o-${t}@t.com`]
    );
    const [a, b, o] = u.rows.map((r) => r.id);
    ids.users.push(a, b, o);
    const m = await query(
        `INSERT INTO matters (client_id, reference, status, title, matter_type, description) VALUES ($1,$2,'OPEN','Matter A','T','d'),($3,$4,'OPEN','Matter B','T','d') RETURNING id`,
        [a, `MA-${t}`, b, `MB-${t}`]
    );
    const [ma, mb] = m.rows.map((r) => r.id);
    ids.matters.push(ma, mb);
    const c = await query(`INSERT INTO conversations (matter_id) VALUES ($1),($2) RETURNING id`, [ma, mb]);
    const [ca, cb] = c.rows.map((r) => r.id);
    ids.convos.push(ca, cb);
    /* The firm speaks first: a client can only reply once the firm has written. */
    await query(`INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$3,'Welcome'),($2,$3,'Welcome')`, [ca, cb, o]);
    return { a, b, o, ma, mb, ca, cb, A: tok('CLIENT', a), B: tok('CLIENT', b), O: tok('OWNER', o) };
}

async function cleanup() {
    await query(`DELETE FROM documents WHERE matter_id = ANY($1::uuid[])`, [ids.matters]).catch(() => {});
    await query(`DELETE FROM messages WHERE conversation_id = ANY($1::uuid[])`, [ids.convos]).catch(() => {});
    await query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [ids.convos]).catch(() => {});
    await query(`DELETE FROM matters WHERE id = ANY($1::uuid[])`, [ids.matters]).catch(() => {});
    await query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [ids.users]).catch(() => {});
    await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [ids.users]).catch(() => {});
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids.users]).catch(() => {});
    ids.users.length = ids.matters.length = ids.convos.length = 0;
}
test.beforeEach(async () => { await acquireDbTestLock(); });
test.afterEach(async () => { await cleanup(); await releaseDbTestLock(); });

const send = (token, convo, body, parentMessageId) =>
    request(app).post(`/api/v1/conversations/${convo}/messages`).set('Authorization', `Bearer ${token}`).send({ body, parentMessageId });
const thread = (token, convo, owner = false) =>
    request(app).get(`/api/v1/${owner ? 'owner/' : ''}conversations/${convo}`).set('Authorization', `Bearer ${token}`);

test('reply: the quoted message comes back with the new one; foreign parents are refused', async () => {
    const s = await seed('reply');
    const first = await send(s.A, s.ca, 'Hello firm');
    assert.equal(first.status, 201);
    const reply = await request(app).post(`/api/v1/owner/conversations/${s.ca}/messages`).set('Authorization', `Bearer ${s.O}`).send({ body: 'Hello Client', parentMessageId: first.body.data.id });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.data.parent.body, 'Hello firm');
    const list = await thread(s.A, s.ca);
    const quoted = list.body.data.messages.find((m) => m.id === reply.body.data.id);
    assert.equal(quoted.parent.id, first.body.data.id);
    const other = await send(s.B, s.cb, 'B message');
    const bad = await send(s.A, s.ca, 'sneaky', other.body.data.id);
    assert.equal(bad.status, 403);
});

test('status: sent, then read once the other side opens it', async () => {
    const s = await seed('status');
    const m = await send(s.A, s.ca, 'Is anyone there?');
    assert.equal(m.body.data.status, 'sent');
    let mine = (await thread(s.A, s.ca)).body.data.messages.find((x) => x.id === m.body.data.id);
    assert.equal(mine.status, 'sent');
    const ownerView = await thread(s.O, s.ca, true);
    assert.equal(ownerView.status, 200);
    await request(app).post(`/api/v1/owner/conversations/${s.ca}/read`).set('Authorization', `Bearer ${s.O}`);
    mine = (await thread(s.A, s.ca)).body.data.messages.find((x) => x.id === m.body.data.id);
    assert.equal(mine.status, 'read');
});

test('delivered: opening the thread marks the sender\'s messages as delivered', async () => {
    const s = await seed('delivered');
    const m = await send(s.A, s.ca, 'ping');
    await thread(s.O, s.ca, true);
    await new Promise((r) => setTimeout(r, 150));
    const mine = (await thread(s.A, s.ca)).body.data.messages.find((x) => x.id === m.body.data.id);
    assert.equal(mine.status, 'delivered');
});

test('delete for me hides it for me only', async () => {
    const s = await seed('dme');
    const m = await send(s.A, s.ca, 'keep for the firm');
    const del = await request(app).delete(`/api/v1/messages/${m.body.data.id}?scope=me`).set('Authorization', `Bearer ${s.A}`);
    assert.equal(del.status, 200);
    assert.equal((await thread(s.A, s.ca)).body.data.messages.some((x) => x.id === m.body.data.id), false);
    assert.equal((await thread(s.O, s.ca, true)).body.data.messages.some((x) => x.id === m.body.data.id), true);
});

test('delete for everyone: only the sender, and nobody sees the text afterwards', async () => {
    const s = await seed('dall');
    const m = await send(s.A, s.ca, 'oops wrong chat');
    const notSender = await request(app).delete(`/api/v1/messages/${m.body.data.id}?scope=everyone`).set('Authorization', `Bearer ${s.O}`);
    assert.equal(notSender.status, 403);
    const stranger = await request(app).delete(`/api/v1/messages/${m.body.data.id}?scope=everyone`).set('Authorization', `Bearer ${s.B}`);
    assert.equal(stranger.status, 404);
    const ok = await request(app).delete(`/api/v1/messages/${m.body.data.id}?scope=everyone`).set('Authorization', `Bearer ${s.A}`);
    assert.equal(ok.status, 200);
    for (const view of [await thread(s.A, s.ca), await thread(s.O, s.ca, true)]) {
        const row = view.body.data.messages.find((x) => x.id === m.body.data.id);
        assert.equal(row.deleted, true);
        assert.equal(row.body, '');
    }
});

test('reactions show on the message, and a deleted message cannot be reacted to', async () => {
    const s = await seed('react');
    const m = await send(s.A, s.ca, 'react to me');
    const r = await request(app).post(`/api/v1/messages/${m.body.data.id}/reactions`).set('Authorization', `Bearer ${s.O}`).send({ emoji: '👍' });
    assert.equal(r.status, 201);
    const row = (await thread(s.A, s.ca)).body.data.messages.find((x) => x.id === m.body.data.id);
    assert.deepEqual(row.reactions.map((x) => x.emoji), ['👍']);
    await request(app).delete(`/api/v1/messages/${m.body.data.id}?scope=everyone`).set('Authorization', `Bearer ${s.A}`);
    const late = await request(app).post(`/api/v1/messages/${m.body.data.id}/reactions`).set('Authorization', `Bearer ${s.O}`).send({ emoji: '❤️' });
    assert.equal(late.status, 409);
    const foreign = await request(app).post(`/api/v1/messages/${m.body.data.id}/reactions`).set('Authorization', `Bearer ${s.B}`).send({ emoji: '👍' });
    assert.equal(foreign.status, 403);
});

test('typing: allowed in my conversation only', async () => {
    const s = await seed('typing');
    const ok = await request(app).post('/api/v1/messages/typing').set('Authorization', `Bearer ${s.A}`).send({ conversationId: s.ca, isTyping: true });
    assert.equal(ok.status, 200);
    const no = await request(app).post('/api/v1/messages/typing').set('Authorization', `Bearer ${s.A}`).send({ conversationId: s.cb, isTyping: true });
    assert.equal(no.status, 404);
});

const pdf = Buffer.from('%PDF-1.4 test');
const upload = (token, fields, name = 'id-card.pdf', url = '/api/v1/documents') => {
    let r = request(app).post(url).set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(fields)) if (v) r = r.field(k, v);
    return r.attach('file', pdf, name);
};

test('documents: a client upload reaches the firm (list, chat, timeline, notification)', async () => {
    const s = await seed('docs');
    const up = await upload(s.A, { matter_id: s.ma });
    assert.equal(up.status, 201);
    const owner = await request(app).get('/api/v1/owner/documents').set('Authorization', `Bearer ${s.O}`);
    const seen = owner.body.data.find((d) => d.id === up.body.data.id);
    assert.equal(seen.uploaded_by_role, 'CLIENT');
    const chat = (await thread(s.O, s.ca, true)).body.data.messages.find((m) => m.document_id === up.body.data.id);
    assert.equal(chat.kind, 'DOCUMENT');
    assert.match(chat.body, /id-card\.pdf/);
    const events = await query(`SELECT 1 FROM matter_events WHERE matter_id = $1 AND event_type = 'DOCUMENT_UPLOADED'`, [s.ma]);
    assert.equal(events.rowCount, 1);
    const note = await query(`SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE 'New document%'`, [s.o]);
    assert.ok(note.rowCount >= 1);
    const dl = await request(app).get(`/api/v1/owner/documents/${up.body.data.id}/download`).set('Authorization', `Bearer ${s.O}`);
    assert.equal(dl.status, 200);
});

test('documents: wrong matter, risky file types and strangers are refused', async () => {
    const s = await seed('docs-deny');
    assert.equal((await upload(s.A, { matter_id: s.mb })).status, 403);
    assert.equal((await upload(s.A, { matter_id: s.ma }, 'run.exe')).status, 400);
    const up = await upload(s.A, { matter_id: s.ma });
    assert.equal((await request(app).get(`/api/v1/documents/${up.body.data.id}`).set('Authorization', `Bearer ${s.B}`)).status, 404);
    assert.equal((await request(app).get(`/api/v1/documents/${up.body.data.id}/download`).set('Authorization', `Bearer ${s.B}`)).status, 404);
    assert.equal((await request(app).get(`/api/v1/documents/${up.body.data.id}`).set('Authorization', `Bearer ${s.A}`)).status, 200);
});

test('documents: a firm upload reaches the client and tells them', async () => {
    const s = await seed('docs-firm');
    const up = await upload(s.O, { matter_id: s.ma }, 'engagement-letter.pdf', '/api/v1/owner/documents');
    assert.equal(up.status, 201);
    const mine = (await request(app).get('/api/v1/documents').set('Authorization', `Bearer ${s.A}`)).body.data;
    assert.equal(mine.find((d) => d.id === up.body.data.id).uploaded_by_role, 'OWNER');
    const note = await query(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'New document from the firm'`, [s.a]);
    assert.equal(note.rowCount, 1);
    const none = (await request(app).get('/api/v1/documents').set('Authorization', `Bearer ${s.B}`)).body.data;
    assert.equal(none.length, 0);
});

test('document requests: the upload answers the request, deleting it reopens it', async () => {
    const s = await seed('docs-req');
    const ask = await request(app).post(`/api/v1/owner/matters/${s.ma}/document-request`).set('Authorization', `Bearer ${s.O}`).send({ description: 'Copy of your national ID' });
    assert.equal(ask.status, 201);
    const open = (await request(app).get('/api/v1/documents/requests').set('Authorization', `Bearer ${s.A}`)).body.data;
    assert.equal(open.length, 1);
    assert.equal((await request(app).get('/api/v1/documents/requests').set('Authorization', `Bearer ${s.B}`)).body.data.length, 0);
    assert.equal((await upload(s.B, { matter_id: s.ma, request_id: open[0].id })).status, 403);
    const up = await upload(s.A, { matter_id: s.ma, request_id: open[0].id });
    assert.equal(up.status, 201);
    assert.equal((await request(app).get('/api/v1/documents/requests').set('Authorization', `Bearer ${s.A}`)).body.data.length, 0);
    const status = await request(app).get(`/api/v1/owner/matters/${s.ma}/document-requests`).set('Authorization', `Bearer ${s.O}`);
    assert.equal(status.body.data[0].status, 'FULFILLED');
    assert.equal(status.body.data[0].fulfilled_document_name, 'id-card.pdf');
    assert.equal((await request(app).delete(`/api/v1/documents/${up.body.data.id}`).set('Authorization', `Bearer ${s.A}`)).status, 200);
    assert.equal((await request(app).get('/api/v1/documents/requests').set('Authorization', `Bearer ${s.A}`)).body.data.length, 1);
    assert.equal((await request(app).get(`/api/v1/documents/${up.body.data.id}`).set('Authorization', `Bearer ${s.A}`)).status, 404);
});
