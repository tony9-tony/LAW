import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';

export const appointmentRouter = Router();
appointmentRouter.use(authenticate);

/* All appointments for the authenticated client across all matters. */
appointmentRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT a.id, a.starts_at, a.ends_at, a.status, a.notes, a.created_at, a.updated_at,
                    a.matter_id, m.reference AS matter_reference, m.title AS matter_title
             FROM appointments a
             LEFT JOIN matters m ON m.id = a.matter_id
             WHERE a.client_id = $1
             ORDER BY a.starts_at ASC`,
            [request.user.sub]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});
