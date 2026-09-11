import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../db.js';

export const ownerInvoiceRouter = Router();
ownerInvoiceRouter.use(authenticate, requireRole('OWNER'));

ownerInvoiceRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT i.id, i.matter_id, i.client_id, i.status, i.currency, i.subtotal, i.tax, i.total,
                     i.issued_at, i.due_at, i.paid_at, i.created_at, i.updated_at,
                     m.reference AS matter_reference, m.title AS matter_title,
                     u.full_name AS client_name
              FROM invoices i
              JOIN matters m ON m.id = i.matter_id
              JOIN users u ON u.id = i.client_id
              ORDER BY i.created_at DESC`,
            []
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

ownerInvoiceRouter.get('/:id', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT i.id, i.matter_id, i.client_id, i.status, i.currency, i.subtotal, i.tax, i.total,
                     i.issued_at, i.due_at, i.paid_at, i.created_at, i.updated_at,
                     m.reference AS matter_reference, m.title AS matter_title,
                     u.full_name AS client_name
              FROM invoices i
              JOIN matters m ON m.id = i.matter_id
              JOIN users u ON u.id = i.client_id
              WHERE i.id = $1`,
            [request.params.id]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

ownerInvoiceRouter.get('/:id/items', async (request, response, next) => {
    try {
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

ownerInvoiceRouter.post('/', async (request, response, next) => {
    try {
        const { matter_id, client_id, status, currency, subtotal, tax, total, issued_at, due_at } = request.body || {};
        if (!matter_id || !client_id) {
            return response.status(400).json({ error: { code: 'BAD_REQUEST', message: 'matter_id and client_id are required' } });
        }
        const matterCheck = await query(`SELECT client_id FROM matters WHERE id = $1`, [matter_id]);
        if (matterCheck.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Matter not found' } });
        }
        if (matterCheck.rows[0].client_id !== client_id) {
            return response.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Matter does not belong to the specified client' } });
        }
        const result = await query(
            `INSERT INTO invoices (matter_id, client_id, status, currency, subtotal, tax, total, issued_at, due_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, matter_id, client_id, status, currency, subtotal, tax, total, issued_at, due_at, paid_at, created_at, updated_at`,
            [matter_id, client_id, status || 'DRAFT', currency || 'TZS', subtotal || 0, tax || 0, total || 0, issued_at || null, due_at || null]
        );
        response.status(201).json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

ownerInvoiceRouter.post('/:id/items', async (request, response, next) => {
    try {
        const { description, quantity, unit_price, amount } = request.body || {};
        if (!description) {
            return response.status(400).json({ error: { code: 'BAD_REQUEST', message: 'description is required' } });
        }
        const result = await query(
            `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, invoice_id, description, quantity, unit_price, amount, created_at`,
            [request.params.id, description, quantity || 1, unit_price || 0, amount || 0]
        );
        response.status(201).json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

ownerInvoiceRouter.patch('/:id', async (request, response, next) => {
    try {
        const { status, issued_at, due_at, paid_at } = request.body || {};
        const result = await query(
            `UPDATE invoices
             SET status = COALESCE($1, status),
                 issued_at = COALESCE($2, issued_at),
                 due_at = COALESCE($3, due_at),
                 paid_at = COALESCE($4, paid_at),
                 updated_at = NOW()
             WHERE id = $5
             RETURNING id, matter_id, client_id, status, currency, subtotal, tax, total, issued_at, due_at, paid_at, created_at, updated_at`,
            [status, issued_at, due_at, paid_at, request.params.id]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});
