import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import bcrypt from 'bcryptjs';

export const testHelperRouter = Router();

const userSchema = z.object({
    email: z.string().email(),
    password: z.string().min(12),
    fullName: z.string().min(2),
    role: z.enum(['CLIENT', 'OWNER', 'STAFF', 'LAWYER']).default('CLIENT'),
});

testHelperRouter.post('/users', async (request, response, next) => {
    try {
        const input = userSchema.parse(request.body);
        const passwordHash = await bcrypt.hash(input.password, 12);
        const result = await query(
            `INSERT INTO users (email, password_hash, full_name, role)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (email) DO UPDATE SET
                 password_hash = EXCLUDED.password_hash,
                 full_name = EXCLUDED.full_name,
                 role = EXCLUDED.role,
                 is_active = TRUE
             RETURNING id, email, full_name, role, created_at`,
            [input.email.toLowerCase(), passwordHash, input.fullName, input.role]
        );
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

testHelperRouter.delete('/test-data', async (request, response, next) => {
    try {
        await query(`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE matter_id IN (SELECT id FROM matters WHERE client_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%')))`);
        await query(`DELETE FROM messages WHERE sender_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%')`);
        await query(`DELETE FROM conversations WHERE matter_id IN (SELECT id FROM matters WHERE client_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%'))`);
        await query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%')`);
        await query(`DELETE FROM documents WHERE matter_id IN (SELECT id FROM matters WHERE client_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%'))`);
        await query(`DELETE FROM documents WHERE uploaded_by IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%')`);
        await query(`DELETE FROM appointments WHERE client_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%')`);
        await query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%'))`);
        await query(`DELETE FROM invoices WHERE client_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%')`);
        await query(`DELETE FROM matters WHERE client_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%')`);
        await query(`DELETE FROM requests WHERE client_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%')`);
        await query(`DELETE FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'e2e-debug-%'`);
        response.json({ data: { deleted: true } });
    } catch (error) { next(error); }
});
