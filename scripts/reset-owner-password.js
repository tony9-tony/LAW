// Reset an OWNER/staff password from the server itself (no email flow needed).
// Usage:  npm run owner:reset -- owner@example.com
// The new password is typed in the terminal (hidden) and never stored in a file.
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { query } from '../backend/src/db.js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Usage: npm run owner:reset -- <email>'); process.exit(1); }

function askHidden(prompt) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(s); else if (s === '\r\n' || s === '\n') rl.output.write(s); };
        rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
    });
}

const found = await query('SELECT id, email, role, is_active FROM users WHERE lower(email) = $1', [email]);
if (!found.rows.length) {
    const owners = await query("SELECT email, role, is_active FROM users WHERE role IN ('OWNER','STAFF','LAWYER') ORDER BY role, email");
    console.error('No user with that email. Staff/owner accounts in this database:');
    owners.rows.forEach((u) => console.error(`  ${u.email}  [${u.role}${u.is_active ? '' : ', INACTIVE'}]`));
    process.exit(1);
}
const who = found.rows[0];
console.log(`Found: ${who.email}  role=${who.role}  active=${who.is_active}`);
const pw = await askHidden('New password (min 12 characters): ');
const again = await askHidden('Repeat password: ');
if (pw.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
if (pw !== again) { console.error('Passwords do not match.'); process.exit(1); }
// Login looks the email up in lower case and only for active accounts, so normalise both here.
await query('UPDATE users SET password_hash = $1, email = lower(email), is_active = TRUE WHERE id = $2', [await bcrypt.hash(pw, 12), who.id]);
console.log(`Password updated for ${email} (${who.role}). Sign in with exactly this email.`);
process.exit(0);
