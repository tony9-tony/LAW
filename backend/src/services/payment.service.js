/* Payment service — manual payment verification workflow.
   Clients submit a payment proof (receipt image). The OWNER verifies or rejects
   it manually. Amounts are server-authoritative: the client-supplied amount is
   ignored; the invoice total is the source of truth. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { PAYMENT_STATUS } from './billing.service.js';

export const PAYMENT_RECORD_STATUS = {
    PENDING: 'PENDING',
    VERIFIED: 'VERIFIED',
    REJECTED: 'REJECTED'
};

const RECEIPT_TYPES = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['application/pdf', '.pdf']
]);
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

function uploadRoot() {
    const dir = path.resolve(config.uploadDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function receiptPath(storageKey) {
    const dir = path.join(uploadRoot(), path.dirname(storageKey));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(uploadRoot(), storageKey);
}

function parseBase64DataUrl(dataUrl) {
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) return null;
    return { mime: match[1].toLowerCase(), base64: match[2] };
}

export async function listActiveDestinations(method = null) {
    let sql = `SELECT id, method, label, lipa_number, bank_name, bank_account_name,
                      bank_account_number, qr_storage_key, qr_content_type, instructions, is_active, created_at
               FROM payment_destinations WHERE is_active = TRUE`;
    const params = [];
    if (method) {
        sql += ` AND method = $1`;
        params.push(method);
    }
    sql += ` ORDER BY created_at DESC`;
    const result = await query(sql, params);
    return result.rows;
}

export async function getPaymentDestinations() {
    const result = await query(
        `SELECT id, method, label, lipa_number, bank_name, bank_account_name,
                bank_account_number, qr_storage_key, qr_content_type, instructions, is_active, created_at, updated_at
         FROM payment_destinations ORDER BY method, is_active DESC, created_at DESC`
    );
    return result.rows;
}

export async function getPaymentDestination(id) {
    const result = await query(
        `SELECT id, method, label, lipa_number, bank_name, bank_account_name,
                bank_account_number, qr_storage_key, qr_content_type, instructions, is_active, created_at, updated_at
         FROM payment_destinations WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

export async function createPaymentDestination({ method, label, lipa_number, bank_name, bank_account_name, bank_account_number, instructions, is_active = true }) {
    const result = await withTransaction(async (client) => {
        if (is_active) {
            await client.query(
                `UPDATE payment_destinations SET is_active = FALSE, updated_at = NOW()
                 WHERE method = $1 AND is_active = TRUE`,
                [method]
            );
        }
        const inserted = await client.query(
            `INSERT INTO payment_destinations (method, label, lipa_number, bank_name, bank_account_name, bank_account_number, instructions, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, method, label, lipa_number, bank_name, bank_account_name,
                       bank_account_number, qr_storage_key, qr_content_type, instructions, is_active, created_at, updated_at`,
            [method, label, lipa_number || null, bank_name || null, bank_account_name || null, bank_account_number || null, instructions || null, is_active]
        );
        return inserted.rows[0];
    });
    return result;
}

export async function updatePaymentDestination(id, { label, lipa_number, bank_name, bank_account_name, bank_account_number, instructions, is_active }) {
    const updates = [];
    const params = [];
    let i = 1;
    if (label !== undefined) { updates.push(`label = $${i}`); params.push(label); i++; }
    if (lipa_number !== undefined) { updates.push(`lipa_number = $${i}`); params.push(lipa_number); i++; }
    if (bank_name !== undefined) { updates.push(`bank_name = $${i}`); params.push(bank_name); i++; }
    if (bank_account_name !== undefined) { updates.push(`bank_account_name = $${i}`); params.push(bank_account_name); i++; }
    if (bank_account_number !== undefined) { updates.push(`bank_account_number = $${i}`); params.push(bank_account_number); i++; }
    if (instructions !== undefined) { updates.push(`instructions = $${i}`); params.push(instructions); i++; }
    if (is_active !== undefined) {
        updates.push(`is_active = $${i}`); params.push(is_active); i++;
    }
    if (updates.length === 0) {
        const error = new Error('No fields to update');
        error.statusCode = 400;
        error.code = 'BAD_REQUEST';
        throw error;
    }
    await query(
        `UPDATE payment_destinations SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i}`,
        [...params, id]
    );
    if (is_active === true) {
        await query(
            `UPDATE payment_destinations SET is_active = FALSE, updated_at = NOW()
             WHERE method = (SELECT method FROM payment_destinations WHERE id = $1)
             AND id <> $1 AND is_active = TRUE`,
            [id]
        );
    }
    return getPaymentDestination(id);
}

const QR_TYPES = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif']
]);
const MAX_QR_BYTES = 5 * 1024 * 1024;

export async function uploadPaymentDestinationQR(id, qrDataUrl) {
    if (!qrDataUrl) {
        const error = new Error('QR image is required');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    const parsed = parseBase64DataUrl(qrDataUrl);
    if (!parsed) {
        const error = new Error('Invalid QR image data');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    if (!QR_TYPES.has(parsed.mime)) {
        const error = new Error('Unsupported QR image type');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    let buffer;
    try {
        buffer = Buffer.from(parsed.base64, 'base64');
    } catch {
        const error = new Error('Invalid base64 data');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    if (buffer.length > MAX_QR_BYTES) {
        const error = new Error('QR image exceeds 2 MB');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    const destResult = await query(
        `SELECT id FROM payment_destinations WHERE id = $1 LIMIT 1`,
        [id]
    );
    if (destResult.rowCount === 0) return null;

    const ext = QR_TYPES.get(parsed.mime);
    const storageKey = `payment-qr/${crypto.randomUUID().slice(0, 2)}/${crypto.randomUUID()}${ext}`;
    const filePath = receiptPath(storageKey);
    fs.writeFileSync(filePath, buffer);

    await query(
        `UPDATE payment_destinations
         SET qr_storage_key = $1, qr_content_type = $2, qr_original_name = $3, updated_at = NOW()
         WHERE id = $4`,
        [storageKey, parsed.mime, `qr${ext}`, id]
    );
    return getPaymentDestination(id);
}

export async function removePaymentDestinationQR(id) {
    const result = await query(
        `UPDATE payment_destinations
         SET qr_storage_key = NULL, qr_content_type = NULL, qr_original_name = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [id]
    );
    if (result.rowCount === 0) return null;
    return getPaymentDestination(id);
}

export async function submitPayment({ invoiceId, clientId, method, referenceNumber, message, receiptData }) {
    if (!receiptData) {
        const error = new Error('Receipt image is required');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    const parsed = parseBase64DataUrl(receiptData);
    if (!parsed) {
        const error = new Error('Invalid receipt image data');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    if (!RECEIPT_TYPES.has(parsed.mime)) {
        const error = new Error('Unsupported receipt type');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    let buffer;
    try {
        buffer = Buffer.from(parsed.base64, 'base64');
    } catch {
        const error = new Error('Invalid base64 data');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    if (buffer.length > MAX_RECEIPT_BYTES) {
        const error = new Error('Receipt exceeds 5 MB');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    const invoiceResult = await query(
        `SELECT id, client_id, total, payment_status FROM invoices WHERE id = $1 LIMIT 1`,
        [invoiceId]
    );
    if (invoiceResult.rowCount === 0) {
        const error = new Error('Invoice not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const invoice = invoiceResult.rows[0];
    if (invoice.client_id !== clientId) {
        const error = new Error('Invoice not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    if (invoice.payment_status !== PAYMENT_STATUS.PAYMENT_REQUIRED && invoice.payment_status !== PAYMENT_STATUS.PAYMENT_REJECTED) {
        const error = new Error('Invoice is not in a payable state');
        error.statusCode = 409;
        error.code = 'INVALID_PAYMENT_STATE';
        throw error;
    }

    const amount = Number(invoice.total);
    const ext = RECEIPT_TYPES.get(parsed.mime);
    const storageKey = `payments/${crypto.randomUUID().slice(0, 2)}/${crypto.randomUUID()}${ext}`;
    const filePath = receiptPath(storageKey);
    fs.writeFileSync(filePath, buffer);

    const result = await withTransaction(async (client) => {
        const inserted = await client.query(
            `INSERT INTO payments (invoice_id, client_id, amount, currency, method, reference_number,
                                  payment_message, receipt_storage_key, receipt_original_name,
                                  receipt_content_type, receipt_size_bytes, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id, invoice_id, client_id, amount, currency, method, reference_number,
                       payment_message, receipt_storage_key, receipt_original_name, receipt_content_type,
                       receipt_size_bytes, status, verified_by, verified_at, created_at, updated_at`,
             [invoiceId, clientId, amount, invoice.currency || 'TZS', method,
             referenceNumber || null, message || null, storageKey,
             `receipt${ext}`, parsed.mime, buffer.length, PAYMENT_RECORD_STATUS.PENDING]
        );
        const payment = inserted.rows[0];
        await client.query(
            `UPDATE invoices SET payment_status = $1, updated_at = NOW() WHERE id = $2`,
            [PAYMENT_STATUS.PAYMENT_PENDING_VERIFICATION, invoiceId]
        );
        return payment;
    });
    return result;
}

export async function listPaymentsForClient(clientId) {
    const result = await query(
        `SELECT p.id, p.invoice_id, p.amount, p.currency, p.method, p.reference_number,
                p.payment_message, p.status, p.verified_at, p.rejection_reason, p.created_at, p.updated_at,
                i.total AS invoice_total, i.payment_status AS invoice_payment_status,
                m.reference AS matter_reference, m.title AS matter_title
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN matters m ON m.id = i.matter_id
         WHERE p.client_id = $1
         ORDER BY p.created_at DESC`,
        [clientId]
    );
    return result.rows;
}

export async function listPaymentsForInvoice(invoiceId, clientId) {
    const invoiceResult = await query(
        `SELECT id, client_id FROM invoices WHERE id = $1 LIMIT 1`,
        [invoiceId]
    );
    if (invoiceResult.rowCount === 0 || invoiceResult.rows[0].client_id !== clientId) {
        const error = new Error('Invoice not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const result = await query(
        `SELECT id, invoice_id, amount, currency, method, reference_number, payment_message,
                receipt_storage_key, receipt_original_name, receipt_content_type, receipt_size_bytes,
                status, verified_by, verified_at, rejection_reason, created_at, updated_at
         FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC`,
        [invoiceId]
    );
    return result.rows;
}

export async function verifyPayment({ paymentId, actorId, method, referenceNumber, notes }) {
    const paymentResult = await query(
        `SELECT p.id, p.invoice_id, p.client_id, p.amount, p.status, p.currency,
                i.total, i.payment_status, i.request_id
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE p.id = $1 LIMIT 1`,
        [paymentId]
    );
    if (paymentResult.rowCount === 0) {
        const error = new Error('Payment not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const payment = paymentResult.rows[0];
    if (payment.status === PAYMENT_RECORD_STATUS.VERIFIED) {
        const error = new Error('Payment is already verified');
        error.statusCode = 409;
        error.code = 'ALREADY_VERIFIED';
        throw error;
    }

    const result = await withTransaction(async (client) => {
        const updated = await client.query(
            `UPDATE payments SET status = $1, verified_by = $2, verified_at = NOW(), updated_at = NOW()
             WHERE id = $3
             RETURNING id, status, verified_by, verified_at, updated_at`,
            [PAYMENT_RECORD_STATUS.VERIFIED, actorId, paymentId]
        );
        await client.query(
            `UPDATE invoices SET payment_status = $1, paid_at = NOW(), status = 'PAID', updated_at = NOW()
             WHERE id = $2`,
            [PAYMENT_STATUS.PAID, payment.invoice_id]
        );
        return updated.rows[0];
    });
    return { payment: result, invoiceId: payment.invoice_id, clientId: payment.client_id, invoiceRequestId: payment.request_id };
}

export async function rejectPayment({ paymentId, actorId, reason }) {
    const paymentResult = await query(
        `SELECT p.id, p.invoice_id, p.client_id, p.status,
                i.total, i.payment_status AS invoice_payment_status, i.request_id
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE p.id = $1 LIMIT 1`,
        [paymentId]
    );
    if (paymentResult.rowCount === 0) {
        const error = new Error('Payment not found');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const payment = paymentResult.rows[0];
    if (payment.status === PAYMENT_RECORD_STATUS.VERIFIED) {
        const error = new Error('Cannot reject a verified payment');
        error.statusCode = 409;
        error.code = 'ALREADY_VERIFIED';
        throw error;
    }

    await withTransaction(async (client) => {
        await client.query(
            `UPDATE payments SET status = $1, rejection_reason = $2, updated_at = NOW()
             WHERE id = $3`,
            [PAYMENT_RECORD_STATUS.REJECTED, reason || null, paymentId]
        );
        if (payment.invoice_payment_status === PAYMENT_STATUS.PAYMENT_PENDING_VERIFICATION) {
            await client.query(
                `UPDATE invoices SET payment_status = $1, updated_at = NOW() WHERE id = $2`,
                [PAYMENT_STATUS.PAYMENT_REJECTED, payment.invoice_id]
            );
        }
    });
}

export async function listPaymentsForOwner({ method, status, page = 1, limit = 50 }) {
    const params = [];
    const conditions = [];
    let i = 1;
    if (method) { conditions.push(`p.method = $${i}`); params.push(method); i++; }
    if (status) { conditions.push(`p.status = $${i}`); params.push(status); i++; }
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;
    const result = await query(
        `SELECT p.id, p.invoice_id, p.amount, p.currency, p.method, p.reference_number,
                p.payment_message, p.status, p.verified_by, p.verified_at, p.rejection_reason,
                p.created_at, p.updated_at,
                i.total AS invoice_total, i.payment_status AS invoice_payment_status,
                m.reference AS matter_reference, m.title AS matter_title,
                c.email AS client_email, c.full_name AS client_name
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN users c ON c.id = p.client_id
         LEFT JOIN matters m ON m.id = i.matter_id
         ${whereClause}
         ORDER BY p.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        [...params, limit, offset]
    );
    const countResult = await query(
        `SELECT COUNT(*)::int AS total FROM payments p ${whereClause}`,
        params
    );
    return {
        data: result.rows,
        meta: { total: countResult.rows[0].total, page, limit }
    };
}

export async function getPaymentById(id) {
    const result = await query(
        `SELECT p.id, p.invoice_id, p.client_id, p.amount, p.currency, p.method, p.reference_number,
                p.payment_message, p.status, p.verified_by, p.verified_at, p.rejection_reason,
                p.receipt_storage_key, p.receipt_original_name, p.receipt_content_type, p.receipt_size_bytes,
                p.created_at, p.updated_at,
                i.total AS invoice_total, i.payment_status AS invoice_payment_status,
                m.reference AS matter_reference, m.title AS matter_title,
                c.email AS client_email, c.full_name AS client_name
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN users c ON c.id = p.client_id
         LEFT JOIN matters m ON m.id = i.matter_id
         WHERE p.id = $1 LIMIT 1`,
        [id]
    );
    return result.rows[0] || null;
}

export async function getServiceCatalog({ activeOnly = false } = {}) {
    let sql = `SELECT id, code, name, description, pricing_mode, fixed_price, is_active, created_at, updated_at
               FROM service_catalog`;
    if (activeOnly) {
        sql += ` WHERE is_active = TRUE`;
    }
    sql += ` ORDER BY created_at DESC`;
    const result = await query(sql, []);
    return result.rows;
}
