/* Static + dependency-injected ownership test.
   Stubs db.query via setDbImpl so we can verify that even with a fake token, a
   client cannot read another client's request/matter/document.

   This protects against regressions where someone accidentally derives the
   user from a request body or query param instead of the JWT. */
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { setDbImpl, resetDbImpl } from '../src/db.js';

function makeStub(rows) {
    const tableRows = new Map(rows);
    return {
        pool: null,
        async query(text, params = []) {
            const t = String(text).trim().toLowerCase();
            if (t.startsWith('select') && /\bfrom\s+(\w+)/.test(t)) {
                const table = t.match(/from\s+(\w+)/)[1];
                const rows = tableRows.get(table) || [];
                /* Heuristic: apply `id = $1` and `client_id = $2` filters when present. */
                const idIdx = t.indexOf('id = $1') >= 0 ? 0 : -1;
                const clientIdx = t.indexOf('client_id = $2') >= 0 ? 1 : -1;
                const filtered = rows.filter((r) => {
                    if (idIdx >= 0 && params[idIdx] !== undefined && r.id !== params[idIdx]) return false;
                    if (clientIdx >= 0 && params[clientIdx] !== undefined && r.client_id !== params[clientIdx]) return false;
                    return true;
                });
                return { rows: filtered, rowCount: filtered.length };
            }
            if (t.startsWith('insert into conversations')) {
                /* On-conflict stub: pretend conflict occurred; the route falls back to SELECT. */
                return { rows: [], rowCount: 0 };
            }
            return { rows: [], rowCount: 0 };
        },
        async withTransaction() { throw new Error('withTransaction not stubbed'); }
    };
}

const tokenA = jwt.sign({ sub: 'user-A', role: 'CLIENT', email: 'a@x' }, config.jwtSecret, { expiresIn: '1h' });
const tokenStaff = jwt.sign({ sub: 'user-staff', role: 'LAWYER', email: 's@x' }, config.jwtSecret, { expiresIn: '1h' });

test.after(() => resetDbImpl());

test('client A cannot read client B\'s request (IDOR)', async () => {
    setDbImpl(makeStub(new Map([
        ['requests', [
            { id: 'r-A', client_id: 'user-A', subject: 'A', status: 'SUBMITTED', created_at: '2025-01-01', updated_at: '2025-01-01' },
            { id: 'r-B', client_id: 'user-B', subject: 'B', status: 'SUBMITTED', created_at: '2025-01-01', updated_at: '2025-01-01' }
        ]],
        ['matters', []]
    ])));
    const res = await request(app).get('/api/v1/requests/r-B').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('client A cannot read client B\'s matter', async () => {
    setDbImpl(makeStub(new Map([
        ['requests', []],
        ['matters', [
            { id: 'm-B', client_id: 'user-B', reference: 'M-B', title: 'B', status: 'OPEN', created_at: '2025-01-01', updated_at: '2025-01-01' }
        ]]
    ])));
    const res = await request(app).get('/api/v1/matters/m-B').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('client A cannot download client B\'s document', async () => {
    setDbImpl(makeStub(new Map([
        ['requests', []],
        ['matters', [{ id: 'm-B', client_id: 'user-B' }]]
    ])));
    const res = await request(app).get('/api/v1/documents/d-B/download').set('Authorization', `Bearer ${tokenA}`);
    /* Stub returns no document row → 404. */
    assert.equal(res.status, 404);
});

test('client role cannot reach staff endpoints', async () => {
    setDbImpl(makeStub(new Map()));
    const res = await request(app).get('/api/v1/staff/requests').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('staff role can reach staff endpoints', async () => {
    setDbImpl(makeStub(new Map([['requests', []], ['users', []]])));
    const res = await request(app).get('/api/v1/staff/requests').set('Authorization', `Bearer ${tokenStaff}`);
    assert.equal(res.status, 200);
});
