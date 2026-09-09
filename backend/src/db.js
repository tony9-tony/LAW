import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

/* The default real-pool implementation. Tests can replace this by
   calling setQueryImpl(fn) to inject a stub without touching the rest
   of the codebase. */
let impl = makeDefaultImpl();

function makeDefaultImpl() {
    const pool = config.databaseUrl
        ? new Pool({ connectionString: config.databaseUrl, max: 10 })
        : null;
    return {
        pool,
        async query(text, values) {
            if (!pool) throw new Error('DATABASE_URL is not configured');
            return pool.query(text, values);
        },
        async withTransaction(fn) {
            if (!pool) throw new Error('DATABASE_URL is not configured');
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await fn(client);
                await client.query('COMMIT');
                return result;
            } catch (error) {
                try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
                throw error;
            } finally {
                client.release();
            }
        }
    };
}

export function setDbImpl(nextImpl) { impl = nextImpl; }
export function resetDbImpl() { impl = makeDefaultImpl(); }

export const pool = new Proxy({}, {
    get(_t, prop) { return impl.pool ? impl.pool[prop] : undefined; }
});

export async function query(text, values) { return impl.query(text, values); }

export async function withTransaction(fn) { return impl.withTransaction(fn); }
