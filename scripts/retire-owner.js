// Retire an owner account so the first-time "Create Owner Account" screen appears again.
// It does NOT delete data: the account is deactivated and its e-mail is freed, so the old
// messages, documents and audit history that point at it stay intact.
// Usage:  npm run owner:retire -- owner@example.com
import { query } from '../backend/src/db.js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Usage: npm run owner:retire -- <email>'); process.exit(1); }

const found = await query("SELECT id, email, role FROM users WHERE lower(email) = $1 AND role = 'OWNER'", [email]);
if (!found.rows.length) {
    const owners = await query("SELECT email, is_active FROM users WHERE role = 'OWNER' ORDER BY email");
    console.error('No OWNER with that email. Owner accounts here:');
    owners.rows.forEach((u) => console.error(`  ${u.email}${u.is_active ? '' : '  (already inactive)'}`));
    process.exit(1);
}
const u = found.rows[0];
const freed = `retired-${Date.now()}-${u.email}`;
await query('UPDATE users SET is_active = FALSE, email = $1 WHERE id = $2', [freed, u.id]);
const left = await query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'OWNER' AND is_active = TRUE");
console.log(`Retired ${u.email}. Active owners left: ${left.rows[0].n}.`);
if (left.rows[0].n === 0) console.log('Open /subui/login.html now: the "Initial Owner Setup" form will appear.');
process.exit(0);
