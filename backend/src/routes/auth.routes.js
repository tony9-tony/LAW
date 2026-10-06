import { Router } from 'express';
import { z } from 'zod';
import { loginUser, registerUser } from '../services/auth.service.js';
import { query } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { clearSessionCookie, cookieNameFor, setSessionCookie } from '../lib/session.js';

const credentials = z.object({ email: z.string().email(), password: z.string().min(12) });
// Public sign-up always makes a CLIENT. A "role" sent by the browser is
// ignored: staff, lawyers and owners are created by the owner (staff routes)
// or, for the very first owner only, by /setup-owner.
const registration = credentials.extend({
    fullName: z.string().trim().min(2).max(160),
});
const setupOwner = registration.extend({ role: z.literal('OWNER') });
export const authRouter = Router();

authRouter.post('/register', async (request, response, next) => {
    try {
        const input = registration.parse(request.body);
        const user = await registerUser({
            email: input.email,
            password: input.password,
            fullName: input.fullName,
            role: 'CLIENT',
        });
        await logAudit({ actorId: user.id, action: 'REGISTER', entityType: 'user', entityId: user.id, metadata: { role: user.role } });
        response.status(201).json({ data: user });
    } catch (error) { next(error); }
});

authRouter.post('/login', async (request, response, next) => {
    try {
        const input = credentials.parse(request.body);
        const result = await loginUser(input);
        await logAudit({ actorId: result.user.id, action: 'LOGIN', entityType: 'user', entityId: result.user.id });
        setSessionCookie(response, result.token, cookieNameFor(request));
        response.json({ data: result });
    } catch (error) { next(error); }
});

// Signs the browser out: the session cookie is removed.
authRouter.post('/logout', (request, response) => {
    clearSessionCookie(response, cookieNameFor(request));
    response.json({ data: { signedOut: true } });
});

authRouter.get('/setup-status', async (_request, response, next) => {
    try {
        const result = await query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
        const ownerCount = result.rows[0].cnt;
        response.json({ data: { setupRequired: ownerCount === 0 } });
    } catch (error) { next(error); }
});

authRouter.post('/setup-owner', async (request, response, next) => {
    try {
        const input = setupOwner.parse(request.body);
        const result = await query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
        if (result.rows[0].cnt > 0) {
            return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner setup has already been completed' } });
        }
        const user = await registerUser(input);
        response.status(201).json({ data: user });
    } catch (error) { next(error); }
});
