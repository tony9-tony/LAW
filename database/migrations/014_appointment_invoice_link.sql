-- Migration 014: Link invoices to appointments for the consultation workflow.
-- Additive. Safe to re-apply (ADD COLUMN IF NOT EXISTS).
-- A consultation booking creates an Appointment first, then an Invoice that
-- references that appointment. This keeps the consultation lifecycle separate
-- from the matter lifecycle: an appointment may have an invoice without a
-- matter, and no Matter is created unless the existing business workflow
-- explicitly requires it later.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_appointment_idx ON invoices (appointment_id);