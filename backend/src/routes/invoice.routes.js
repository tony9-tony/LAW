import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureOwned } from '../lib/authorization.js';

export const invoiceRouter = Router();
invoiceRouter.use(authenticate);

invoiceRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT i.id, i.matter_id, i.client_id, i.status, i.currency, i.subtotal, i.tax, i.total,
                     i.issued_at, i.due_at, i.paid_at, i.created_at, i.updated_at,
                     m.reference AS matter_reference, m.title AS matter_title,
                     u.full_name AS client_name
              FROM invoices i
              JOIN matters m ON m.id = i.matter_id
              JOIN users u ON u.id = i.client_id
              WHERE i.client_id = $1
              ORDER BY i.created_at DESC`,
            [request.user.sub]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

invoiceRouter.get('/:id', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT i.id, i.matter_id, i.client_id, i.status, i.currency, i.subtotal, i.tax, i.total,
                     i.issued_at, i.due_at, i.paid_at, i.created_at, i.updated_at,
                     m.reference AS matter_reference, m.title AS matter_title,
                     u.full_name AS client_name
              FROM invoices i
              JOIN matters m ON m.id = i.matter_id
              JOIN users u ON u.id = i.client_id
              WHERE i.id = $1 AND i.client_id = $2`,
            [request.params.id, request.user.sub]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

invoiceRouter.get('/:id/items', async (request, response, next) => {
    try {
        const invoiceCheck = await query(
            `SELECT client_id FROM invoices WHERE id = $1`,
            [request.params.id]
        );
        if (invoiceCheck.rowCount === 0 || invoiceCheck.rows[0].client_id !== request.user.sub) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
        }
        const result = await query(
            `SELECT id, invoice_id, description, quantity, unit_price, amount, created_at
              FROM invoice_items
              WHERE invoice_id = $1
              ORDER BY created_at ASC`,
            [request.params.id]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});
