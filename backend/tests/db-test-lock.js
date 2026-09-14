import { pool } from '../src/db.js';

const TEST_DB_LOCK_ID = 724721975;
let lockClient;

export async function acquireDbTestLock() {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1::bigint)', [TEST_DB_LOCK_ID]);
        lockClient = client;
    } catch (error) {
        client.release();
        throw error;
    }
}

export async function releaseDbTestLock() {
    if (!lockClient) return;
    const client = lockClient;
    lockClient = null;
    try {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [TEST_DB_LOCK_ID]);
    } finally {
        client.release();
    }
}
