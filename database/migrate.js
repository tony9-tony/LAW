import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from '../backend/src/db.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
await query('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
const files = (await fs.readdir(path.join(directory, 'migrations'))).filter((file) => file.endsWith('.sql')).sort();
for (const filename of files) {
    const applied = await query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(directory, 'migrations', filename), 'utf8');
    /* Each migration runs in its own transaction so that DDL like
       ALTER TYPE ... ADD VALUE can commit before the next file runs. */
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`Applied ${filename}`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
await pool.end();
