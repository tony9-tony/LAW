import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { notify } from '../services/notification.service.js';
import {
    submitPayment,
    listPaymentsForClient,
    listPaymentsForInvoice,
    listActiveDestinations,
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
    method: z.enum(['bank', 'qr']),
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
