/* Billing service.
   Invoice creation, line-item snapshotting, and total calculation.
   CRITICAL: once an invoice row exists, its amounts are immutable.
   Changing service_catalog.fixed_price later must NOT affect existing
   invoices — invoice_items stores the historical snapshot. */
import { query, withTransaction } from '../db.js';
import { listActiveDestinations } from './payment.service.js';

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

/* Get the active payment destination for a given method (or the first active one). */
export async function getActivePaymentDestinationSnapshot(method = null) {
    const destinations = await listActiveDestinations(method);
    if (!destinations.length) return null;
    const d = destinations[0];
    return {
        payment_destination_id: d.id,
        payment_destination_method: d.method,
        payment_destination_label: d.label,
        payment_lipa_number: d.lipa_number,
        payment_bank_name: d.bank_name,
        payment_bank_account_name: d.bank_account_name,
        payment_bank_account_number: d.bank_account_number,
        payment_qr_storage_key: d.qr_storage_key,
        payment_qr_content_type: d.qr_content_type,
        payment_instructions: d.instructions
    };
}

/* Set payment for a request — create or update invoice with amount, description, and payment destination snapshot.
   Returns the invoice. */
export async function setPaymentForRequest({ requestId, actorId, amount, description, currency = 'TZS' }) {
    const requestResult = await query(
        `SELECT r.id, r.client_id, r.status, r.subject,
                m.id AS matter_id
         FROM requests r
         LEFT JOIN matters m ON m.originating_request_id = r.id
         WHERE r.id = $1 LIMIT 1`,
        [requestId]
    );
    if (requestResult.rowCount === 0) {
        const error = new Error('Request not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const request = requestResult.rows[0];
    
    // Check if request is in a state where payment can be set
    const blocked = new Set(['DECLINED', 'CLOSED']);
    if (blocked.has(request.status)) {
        const error = new Error('Cannot set payment for a resolved request');
        error.statusCode = 409;
        error.code = 'INVALID_STATUS';
        throw error;
    }

    const clientId = request.client_id;
    const matterId = request.matter_id || null;

    // Check for existing invoice for this request
    const existingInvoice = await query(
        `SELECT id, payment_status FROM invoices WHERE request_id = $1 LIMIT 1`,
        [requestId]
    );

    // Get active payment destination snapshot
    const destSnapshot = await getActivePaymentDestinationSnapshot();

    const items = [{
        description: description || request.subject || 'Legal services',
        quantity: 1,
        unit_price: Number(amount) || 0,
        amount: Number(amount) || 0
    }];

    if (existingInvoice.rowCount > 0) {
        // Update existing invoice if it's not paid
        const inv = existingInvoice.rows[0];
        if (inv.payment_status === PAYMENT_STATUS.PAID) {
            const error = new Error('Invoice is already paid; cannot modify');
            error.statusCode = 409;
            error.code = 'ALREADY_PAID';
            throw error;
        }

        const result = await withTransaction(async (client) => {
            // Update invoice with new amount, description, and payment destination snapshot
            const updated = await client.query(
                `UPDATE invoices
                 SET status = 'DRAFT',
                     currency = $2,
                     subtotal = $3,
                     tax = 0,
                     total = $3,
                     payment_status = $4,
                     payment_instructions = $5,
                     payment_lipa_number = $6,
                     payment_bank_name = $7,
                     payment_bank_account_name = $8,
                     payment_bank_account_number = $9,
                     payment_qr_storage_key = $10,
                     payment_qr_content_type = $11,
                     payment_destination_method = $12,
                     payment_destination_label = $13,
                     payment_destination_id = $14,
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, matter_id, client_id, request_id, status, currency, subtotal, tax, total, payment_status, payment_instructions,
                           payment_lipa_number, payment_bank_name, payment_bank_account_name, payment_bank_account_number,
                           payment_qr_storage_key, payment_qr_content_type, payment_destination_method, payment_destination_label, payment_destination_id,
                           created_at, updated_at`,
                [inv.id, currency, Number(amount) || 0, PAYMENT_STATUS.PAYMENT_REQUIRED,
                 destSnapshot?.payment_instructions || null,
                 destSnapshot?.payment_lipa_number || null,
                 destSnapshot?.payment_bank_name || null,
                 destSnapshot?.payment_bank_account_name || null,
                 destSnapshot?.payment_bank_account_number || null,
                 destSnapshot?.payment_qr_storage_key || null,
                 destSnapshot?.payment_qr_content_type || null,
                 destSnapshot?.payment_destination_method || null,
                 destSnapshot?.payment_destination_label || null,
                 destSnapshot?.payment_destination_id || null]
            );
            const invoice = updated.rows[0];

            // Replace invoice items
            await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
            for (const it of items) {
                await client.query(
                    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [inv.id, it.description, Number(it.quantity) || 1, Number(it.unit_price) || 0, Number(it.amount) || 0]
                );
            }

            // Record event
            await client.query(
                `INSERT INTO request_events (request_id, actor_id, event_type, title, note)
                 VALUES ($1, $2, 'PAYMENT_SET', 'Payment amount set by admin', $3)`,
                [requestId, actorId, `Amount: ${currency} ${Number(amount).toLocaleString()}, Description: ${description}`]
            );

            return invoice;
        });
        return result;
    } else {
        // Create new invoice
        const result = await withTransaction(async (client) => {
            const inserted = await client.query(
                `INSERT INTO invoices (matter_id, client_id, request_id, status, currency, subtotal, tax, total, payment_status, payment_instructions,
                                      payment_lipa_number, payment_bank_name, payment_bank_account_name, payment_bank_account_number,
                                      payment_qr_storage_key, payment_qr_content_type, payment_destination_method, payment_destination_label, payment_destination_id)
                 VALUES ($1, $2, $3, 'DRAFT', $4, $5, 0, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                 RETURNING id, matter_id, client_id, request_id, status, currency, subtotal, tax, total, payment_status, payment_instructions,
                           payment_lipa_number, payment_bank_name, payment_bank_account_name, payment_bank_account_number,
                           payment_qr_storage_key, payment_qr_content_type, payment_destination_method, payment_destination_label, payment_destination_id,
                           created_at, updated_at`,
                [matterId, clientId, requestId, currency, Number(amount) || 0, PAYMENT_STATUS.PAYMENT_REQUIRED,
                 destSnapshot?.payment_instructions || null,
                 destSnapshot?.payment_lipa_number || null,
                 destSnapshot?.payment_bank_name || null,
                 destSnapshot?.payment_bank_account_name || null,
                 destSnapshot?.payment_bank_account_number || null,
                 destSnapshot?.payment_qr_storage_key || null,
                 destSnapshot?.payment_qr_content_type || null,
                 destSnapshot?.payment_destination_method || null,
                 destSnapshot?.payment_destination_label || null,
                 destSnapshot?.payment_destination_id || null]
            );
            const invoice = inserted.rows[0];

            for (const it of items) {
                await client.query(
                    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [invoice.id, it.description, Number(it.quantity) || 1, Number(it.unit_price) || 0, Number(it.amount) || 0]
                );
            }

            // Record event
            await client.query(
                `INSERT INTO request_events (request_id, actor_id, event_type, title, note)
                 VALUES ($1, $2, 'PAYMENT_SET', 'Payment amount set by admin', $3)`,
                [requestId, actorId, `Amount: ${currency} ${Number(amount).toLocaleString()}, Description: ${description}`]
            );

            return invoice;
        });
        return result;
    }
}