// Create a fresh, empty production database for the site, with its own login.
//
// Usage (Git Bash or PowerShell, in the project folder):
//   node scripts/create-production-db.js
//   node scripts/create-production-db.js --name et_cetra_production --user law_app
//
// What it does:
//   1. Connects with the DATABASE_URL in .env (a PostgreSQL superuser such as "postgres").
//   2. Creates a new login (default "law_app") with a long random password, and a new
//      database (default "et_cetra_production") owned by it. Your current database is
//      not touched.
//   3. Builds every table (npm run db:migrate) in the new database, as the new login.
//   4. Copies .env to .env.before-production, then points .env at the new database.
//
// Afterwards: start the site, open /subui/login.html at once and create the owner
// account (until an owner exists, anyone who can reach the site could create it).
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const dbName = arg('name', 'et_cetra_production');
const appUser = arg('user', 'law_app');
const safeName = /^[a-z_][a-z0-9_]{0,62}$/;
if (!safeName.test(dbName) || !safeName.test(appUser)) {
    console.error('Use lower-case letters, digits and _ only for --name and --user.');
    process.exit(1);
}

const adminUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
if (!adminUrl) {
    console.error('DATABASE_URL is not set in .env. Set it to your PostgreSQL superuser (e.g. postgresql://postgres:PASSWORD@localhost:5432/postgres).');
    process.exit(1);
}

const admin = new pg.Client({ connectionString: adminUrl });
try {
    await admin.connect();
} catch (error) {
    console.error(`Could not connect to PostgreSQL with DATABASE_URL: ${error.message}`);
    process.exit(1);
}

const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (exists.rowCount) {
    console.error(`A database called "${dbName}" already exists, so nothing was changed. Pick another name with --name.`);
    await admin.end();
    process.exit(1);
}

/* Letters and digits only, so it can sit in a URL without escaping. */
const password = crypto.randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
if (role.rowCount) {
    await admin.query(`ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${password}'`);
    console.log(`Login "${appUser}" already existed: it got a new password.`);
} else {
    await admin.query(`CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    console.log(`Created login "${appUser}".`);
}
await admin.query(`CREATE DATABASE ${dbName} OWNER ${appUser} ENCODING 'UTF8' TEMPLATE template0`);
await admin.query(`REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC`);
console.log(`Created database "${dbName}".`);
await admin.end();

/* The first migration needs pgcrypto; a superuser adds it so the app login does not need to be one. */
const adminTarget = new URL(adminUrl);
adminTarget.pathname = `/${dbName}`;
const adminOnNew = new pg.Client({ connectionString: adminTarget.toString() });
await adminOnNew.connect();
await adminOnNew.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
await adminOnNew.query(`ALTER SCHEMA public OWNER TO ${appUser}`);
await adminOnNew.end();

const appUrl = new URL(adminUrl);
appUrl.username = appUser;
appUrl.password = password;
appUrl.pathname = `/${dbName}`;
appUrl.search = '';
const newDatabaseUrl = appUrl.toString();

console.log('Building the tables…');
const migrate = spawnSync(process.execPath, [path.join(root, 'database', 'migrate.js')], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: newDatabaseUrl },
    stdio: 'inherit',
});
if (migrate.status !== 0) {
    console.error('Building the tables failed (see above). .env was not changed.');
    process.exit(1);
}

const envPath = path.join(root, '.env');
const backupPath = path.join(root, '.env.before-production');
const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
fs.writeFileSync(backupPath, current);
const line = `DATABASE_URL=${newDatabaseUrl}`;
const updated = /^DATABASE_URL=.*$/m.test(current) ? current.replace(/^DATABASE_URL=.*$/m, line) : `${current.replace(/\s*$/, '\n')}${line}\n`;
fs.writeFileSync(envPath, updated);

console.log(`
Done. The new database "${dbName}" is ready and empty.
  .env now points to it (your old settings are in .env.before-production).
  Login: ${appUser}   Password: saved in .env only.

Next:
  1. Restart the site (npm run dev).
  2. Open http://localhost:3000/subui/login.html straight away and create the owner account.
  3. In the command centre, set the Lipa Namba under Payments before taking payments.
`);
