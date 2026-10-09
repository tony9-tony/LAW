-- Migration 016: an invoice is paid in one place.
-- Some invoices were marked PAID in `status` while `payment_status` still asked
-- for payment (or the other way round), so the client saw "Pay now" on a
-- settled invoice. Bring both fields (and paid_at) into line. Safe to re-run.
UPDATE invoices
   SET payment_status = 'PAID',
       status = 'PAID',
       paid_at = COALESCE(paid_at, updated_at, NOW())
 WHERE (status = 'PAID' OR payment_status = 'PAID')
   AND (status IS DISTINCT FROM 'PAID' OR payment_status IS DISTINCT FROM 'PAID' OR paid_at IS NULL);
