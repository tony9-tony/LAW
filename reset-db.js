import { query } from './backend/src/db.js';

async function reset() {
    console.log('Dropping all tables...');
    await query('DROP TABLE IF EXISTS schema_migrations CASCADE');
    await query('DROP TABLE IF EXISTS notifications CASCADE');
    await query('DROP TABLE IF EXISTS audit_logs CASCADE');
    await query('DROP TABLE IF EXISTS security_events CASCADE');
    await query('DROP TABLE IF EXISTS appointments CASCADE');
    await query('DROP TABLE IF EXISTS documents CASCADE');
    await query('DROP TABLE IF EXISTS matter_assignments CASCADE');
    await query('DROP TABLE IF EXISTS matters CASCADE');
    await query('DROP TABLE IF EXISTS request_events CASCADE');
    await query('DROP TABLE IF EXISTS requests CASCADE');
    await query('DROP TABLE IF EXISTS conversations CASCADE');
    await query('DROP TABLE IF EXISTS messages CASCADE');
    await query('DROP TABLE IF EXISTS users CASCADE');
    await query('DROP TABLE IF EXISTS permissions CASCADE');
    await query('DROP TABLE IF EXISTS roles CASCADE');
    await query('DROP TABLE IF EXISTS settings CASCADE');
    await query('DROP TABLE IF EXISTS system_settings CASCADE');
    console.log('Tables dropped.');

    console.log('Re-running migrations...');
    const { execSync } = await import('node:child_process');
    execSync('node database/migrate.js', { stdio: 'inherit', cwd: '.' });
    console.log('Migrations complete.');
    process.exit(0);
}

reset().catch((err) => { console.error(err); process.exit(1); });