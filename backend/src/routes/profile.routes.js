import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';

export const profileRouter = Router();
profileRouter.use(authenticate);

/* Returns the authenticated user's own account.
   Never accepts an id from the frontend — always derives from the JWT. */
profileRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT id, email, full_name, role, is_active, created_at, updated_at
             FROM users WHERE id = $1 LIMIT 1`,
            [request.user.sub]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});
