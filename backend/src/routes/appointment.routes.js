import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { scheduleAppointment } from '../services/workflow.service.js';
import { createInvoiceForAppointment } from '../services/billing.service.js';

export const appointmentRouter = Router();
appointmentRouter.use(authenticate);

/* All appointments for the authenticated client across all matters. */
appointmentRouter.get('/', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT a.id, a.starts_at, a.ends_at, a.status, a.notes, a.created_at, a.updated_at,
                    a.matter_id, a.consultation_type, a.meeting_mode, a.duration_minutes, a.location_details,
                    m.reference AS matter_reference, m.title AS matter_title,
                    inv.id AS invoice_id, inv.total AS invoice_total, CASE WHEN inv.status = 'PAID' OR inv.paid_at IS NOT NULL THEN 'PAID' ELSE inv.payment_status END AS invoice_payment_status,
                    inv.currency AS invoice_currency, inv.payment_destination_method AS invoice_payment_method
             FROM appointments a
             LEFT JOIN matters m ON m.id = a.matter_id
             LEFT JOIN invoices inv ON inv.appointment_id = a.id
             WHERE a.client_id = $1
             ORDER BY a.starts_at ASC`,
            [request.user.sub]
        );
        response.json({ data: result.rows });
    } catch (error) { next(error); }
});

/* GET /api/v1/appointments/:id — single appointment detail for the authenticated client. */
appointmentRouter.get('/:id', async (request, response, next) => {
    try {
        const result = await query(
            `SELECT a.id, a.starts_at, a.ends_at, a.status, a.notes, a.created_at, a.updated_at,
                    a.matter_id, a.consultation_type, a.meeting_mode, a.duration_minutes, a.location_details,
                    m.reference AS matter_reference, m.title AS matter_title,
                    inv.id AS invoice_id, inv.total AS invoice_total, CASE WHEN inv.status = 'PAID' OR inv.paid_at IS NOT NULL THEN 'PAID' ELSE inv.payment_status END AS invoice_payment_status,
                    inv.currency AS invoice_currency, inv.payment_destination_method AS invoice_payment_method,
                    inv.payment_lipa_number, inv.payment_bank_name, inv.payment_bank_account_name,
                    inv.payment_bank_account_number, inv.payment_qr_storage_key, inv.payment_qr_content_type,
                    inv.payment_destination_label, inv.payment_destination_id, inv.payment_instructions
             FROM appointments a
             LEFT JOIN matters m ON m.id = a.matter_id
             LEFT JOIN invoices inv ON inv.appointment_id = a.id
             WHERE a.id = $1 AND a.client_id = $2 LIMIT 1`,
            [request.params.id, request.user.sub]
        );
        if (result.rowCount === 0) {
            return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Appointment not found' } });
        }
        response.json({ data: result.rows[0] });
    } catch (error) { next(error); }
});

/* POST /api/v1/appointments — client books a consultation.
   Creates the Appointment (status SCHEDULED) and automatically creates the
   linked Invoice (idempotent). No Matter is created. */
const bookConsultationSchema = z.object({
    consultationType: z.string().trim().max(60).optional(),
    meetingMode: z.string().trim().max(20).optional(),
    durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    locationDetails: z.string().trim().max(500).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    notes: z.string().trim().max(2000).optional()
});

appointmentRouter.post('/', async (request, response, next) => {
    try {
        const input = bookConsultationSchema.parse(request.body);
        const start = new Date(input.startsAt);
        const end = new Date(input.endsAt);
        if (end <= start) {
            const error = new Error('endsAt must be after startsAt');
            error.statusCode = 400;
            error.code = 'INVALID_TIMING';
            throw error;
        }
        const result = await scheduleAppointment({
            clientId: request.user.sub,
            matterId: null,
            requestId: null,
            consultationType: input.consultationType || null,
            meetingMode: input.meetingMode || null,
            durationMinutes: input.durationMinutes || 60,
            locationDetails: input.locationDetails || null,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            notes: input.notes || null,
            actorId: request.user.sub
        });

        const invoice = await createInvoiceForAppointment({
            appointmentId: result.id,
            clientId: request.user.sub,
            paymentStatus: 'PAYMENT_REQUIRED'
        });

        await logAudit({
            actorId: request.user.sub,
            action: 'CONSULTATION_BOOKED',
            entityType: 'appointment',
            entityId: result.id,
            metadata: { invoice_id: invoice.id, consultation_type: input.consultationType || null }
        });

        response.status(201).json({ data: { appointment: result, invoice } });
    } catch (error) { next(error); }
});
