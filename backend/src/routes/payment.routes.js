import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { notify } from '../services/notification.service.js';
import {
    submitPayment,
    listPaymentsForClient,
    listPaymentsForInvoice,
    listActiveDestinations,
    getPaymentById,
    receiptPath,
    PAYMENT_RECORD_STATUS
} from '../services/payment.service.js';
import {
    notifyPaymentProofSubmitted,
    notifyPaymentVerified,
    notifyPaymentRejected
} from '../services/sse.js';

export const paymentRouter = Router();
paymentRouter.use(authenticate);

const SUBMIT_PAYMENT_SCHEMA = z.object({
    invoice_id: z.string().uuid(),
    method: z.enum(['mobile_money', 'bank', 'qr']),
    destination_id: z.string().uuid().optional(),
    reference_number: z.string().trim().max(200).optional(),
    message: z.string().trim().max(1000).optional(),
    receipt: z.string().min(1)
});

paymentRouter.post('/', async (request, response, next) => {
    try {
        const input = SUBMIT_PAYMENT_SCHEMA.parse(request.body);
        const payment = await submitPayment({
            invoiceId: input.invoice_id,
            clientId: request.user.sub,
            method: input.method,
            destinationId: input.destination_id,
            referenceNumber: input.reference_number,
            message: input.message,
            receiptData: input.receipt
        });
        await logAudit({
            actorId: request.user.sub,
            action: 'PAYMENT_SUBMITTED',
            entityType: 'payment',
            entityId: payment.id,
            metadata: { invoice_id: input.invoice_id, method: input.method, amount: Number(payment.amount) }
        });
        await notify(request.user.sub, {
            kind: 'PAYMENT_SUBMITTED',
            title: 'Payment submitted for review',
            body: 'Your payment proof has been submitted and is awaiting verification.',
            entityType: 'payment',
            entityId: payment.id
        });
        await notifyPaymentProofSubmitted(
            payment.id, input.invoice_id, request.user.sub,
            Number(payment.amount), payment.currency
        );
        response.status(201).json({ data: payment });
    } catch (error) {
        next(error);
    }
});

paymentRouter.get('/destinations', async (_request, response, next) => {
    try {
        const destinations = await listActiveDestinations();
        response.json({ data: destinations });
    } catch (error) {
        next(error);
    }
});

const CLIENT_PAYMENT_SCHEMA = z.object({
    status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(200).default(50)
});

paymentRouter.get('/', async (request, response, next) => {
    try {
        const q = CLIENT_PAYMENT_SCHEMA.parse(request.query);
        const result = await query(
            `SELECT p.id, p.invoice_id, p.amount, p.currency, p.method, p.reference_number,
                    p.payment_message, p.status, p.verified_at, p.rejection_reason, p.created_at, p.updated_at,
                    i.total AS invoice_total, i.payment_status AS invoice_payment_status,
                    m.reference AS matter_reference, m.title AS matter_title
             FROM payments p
             JOIN invoices i ON i.id = p.invoice_id
             LEFT JOIN matters m ON m.id = i.matter_id
             WHERE p.client_id = $1
             ${q.status ? 'AND p.status = $2' : ''}
             ORDER BY p.created_at DESC
             LIMIT $${q.status ? 3 : 2} OFFSET $${q.status ? 4 : 3}`,
            q.status
                ? [request.user.sub, q.status, q.limit, (q.page - 1) * q.limit]
                : [request.user.sub, q.limit, (q.page - 1) * q.limit]
        );
        response.json({ data: result.rows });
    } catch (error) {
        next(error);
    }
});

paymentRouter.get('/invoice/:invoiceId', async (request, response, next) => {
    try {
        const payments = await listPaymentsForInvoice(request.params.invoiceId, request.user.sub);
        response.json({ data: payments });
    } catch (error) {
        next(error);
    }
});

/* GET /api/v1/payments/:id — authenticated client retrieves their own payment. */
paymentRouter.get('/:id', async (request, response, next) => {
    try {
        const payment = await getPaymentById(request.params.id);
        if (!payment || payment.client_id !== request.user.sub) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
        }
        response.json({ data: payment });
    } catch (error) {
        next(error);
    }
});

/* GET /api/v1/payments/:id/receipt — stream a payment receipt file (client owner only). */
paymentRouter.get('/:id/receipt', async (request, response, next) => {
    try {
        const payment = await getPaymentById(request.params.id);
        if (!payment || payment.client_id !== request.user.sub) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
        }
        if (!payment.receipt_storage_key || !payment.receipt_content_type) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Receipt not found' } });
        }
        const filePath = receiptPath(payment.receipt_storage_key);
        if (!fs.existsSync(filePath)) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Receipt file not found' } });
        }
        response.writeHead(200, {
            'Content-Type': payment.receipt_content_type,
            'Content-Disposition': `inline; filename="${payment.receipt_original_name || 'receipt'}"`,
            'Content-Length': payment.receipt_size_bytes || undefined,
            'Cache-Control': 'private, max-age=3600'
        });
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read receipt' } }));
        stream.pipe(response);
    } catch (error) {
        next(error);
    }
});
