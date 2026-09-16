/* Billing service.
   Invoice creation, line-item snapshotting, and total calculation.
   CRITICAL: once an invoice row exists, its amounts are immutable.
   Changing service_catalog.fixed_price later must NOT affect existing
   invoices — invoice_items stores the historical snapshot. */
import { query, withTransaction } from '../db.js';

export const INVOICE_STATUS = {
    DRAFT: 'DRAFT',
    ISSUED: 'ISSUED',
    PARTIAL: 'PARTIAL',
    PAID: 'PAID',
    OVERDUE: 'OVERDUE',
    CANCELLED: 'CANCELLED'
};

export const PAYMENT_STATUS = {
    UNPAID: 'UNPAID',
    PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
    PAYMENT_PENDING_VERIFICATION: 'PAYMENT_PENDING_VERIFICATION',
    PAID: 'PAID',
    PAYMENT_REJECTED: 'PAYMENT_REJECTED'
};

/* Recalculate subtotal/tax/total from invoice_items. */
export async function recalcInvoiceTotals(invoiceId) {
    const result = await query(
        `SELECT COALESCE(SUM(amount), 0) AS subtotal
               FROM invoice_items
               WHERE invoice_id = $1`,
        [invoiceId]
    );
    const subtotal = Number(result.rows[0].subtotal || 0);
    const tax = 0;
    const total = subtotal;
    await query(
        `UPDATE invoices
            SET subtotal = $2, tax = $3, total = $4, updated_at = NOW()
          WHERE id = $1`,
        [invoiceId, subtotal, tax, total]
    );
    return { subtotal, tax, total };
}

/* Create an invoice for a request (CLIENT-side lifecycle).
   Line items are supplied by the caller; amounts are snapshotted here. */
export async function createInvoiceForRequest({ requestId, matterId, clientId, currency = 'TZS', items = [], instructions = null, paymentStatus = PAYMENT_STATUS.PAYMENT_REQUIRED }) {
    const subtotal = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    const result = await withTransaction(async (client) => {
        const inserted = await client.query(
            `INSERT INTO invoices (matter_id, client_id, request_id, status, currency, subtotal, tax, total, payment_status, payment_instructions)
             VALUES ($1, $2, $3, 'DRAFT', $4, $5, 0, $5, $6, $7)
             RETURNING id, matter_id, client_id, request_id, status, currency, subtotal, tax, total, payment_status, payment_instructions, created_at`,
            [matterId || null, clientId, requestId, currency, subtotal, paymentStatus, instructions || null]
        );
        const invoice = inserted.rows[0];
        for (const it of items) {
            await client.query(
                `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
                 VALUES ($1, $2, $3, $4, $5)`,
                [invoice.id, it.description, Number(it.quantity) || 1, Number(it.unit_price) || 0, Number(it.amount) || 0]
            );
        }
        return invoice;
    });
    return result;
}

/* OWNER-facing invoice creation (matter-anchored, no request required). */
export async function createInvoice({ matterId, clientId, requestId = null, currency = 'TZS', items = [], status = 'DRAFT', instructions = null, paymentStatus = PAYMENT_STATUS.UNPAID }) {
    const subtotal = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    const result = await withTransaction(async (client) => {
        const inserted = await client.query(
            `INSERT INTO invoices (matter_id, client_id, request_id, status, currency, subtotal, tax, total, payment_status, payment_instructions)
             VALUES ($1, $2, $3, $4, $5, $6, 0, $6, $7, $8)
             RETURNING id, matter_id, client_id, request_id, status, currency, subtotal, tax, total, payment_status, payment_instructions, created_at`,
            [matterId, clientId, requestId, status, currency, subtotal, paymentStatus, instructions || null]
        );
        const invoice = inserted.rows[0];
        for (const it of items) {
            await client.query(
                `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
                 VALUES ($1, $2, $3, $4, $5)`,
                [invoice.id, it.description, Number(it.quantity) || 1, Number(it.unit_price) || 0, Number(it.amount) || 0]
            );
        }
        return invoice;
    });
    return result;
}

/* Add a single line item to an existing invoice and recalc totals. */
export async function addInvoiceItem(invoiceId, { description, quantity = 1, unit_price = 0, amount }) {
    const qty = Number(quantity) || 1;
    const up = Number(unit_price) || 0;
    const amt = Number(amount) !== undefined ? Number(amount) : qty * up;
    const result = await query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, invoice_id, description, quantity, unit_price, amount, created_at`,
        [invoiceId, description, qty, up, amt]
    );
    await recalcInvoiceTotals(invoiceId);
    return result.rows[0];
}

/* Snapshot a service_catalog row into an invoice_item.
   FIXED  -> amount = service.fixed_price
   CUSTOM -> amount = caller-supplied (OWNER-provided) */
export function snapshotServiceItem(service, customAmount = null) {
    const mode = service.pricing_mode;
    let amount;
    if (mode === 'FIXED') {
        amount = Number(service.fixed_price) || 0;
    } else {
        if (customAmount === undefined || customAmount === null) {
            const error = new Error('CUSTOM service requires an explicit amount');
            error.statusCode = 400;
            error.code = 'VALIDATION_ERROR';
            throw error;
        }
        amount = Number(customAmount);
        if (amount < 0) {
            const error = new Error('Amount cannot be negative');
            error.statusCode = 400;
            error.code = 'VALIDATION_ERROR';
            throw error;
        }
    }
    return {
        description: service.name,
        quantity: 1,
        unit_price: amount,
        amount
    };
}