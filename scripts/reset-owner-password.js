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

const found = await query('SELECT id, role FROM users WHERE lower(email) = $1', [email]);
if (!found.rows.length) { console.error('No user with that email.'); process.exit(1); }
const pw = await askHidden('New password (min 12 characters): ');
const again = await askHidden('Repeat password: ');
if (pw.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
if (pw !== again) { console.error('Passwords do not match.'); process.exit(1); }
await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(pw, 12), found.rows[0].id]);
console.log(`Password updated for ${email} (${found.rows[0].role}). You can sign in now.`);
process.exit(0);
