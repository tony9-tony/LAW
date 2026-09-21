-- Migration 013: Add payment destination snapshot to invoices.
-- Stores a snapshot of the active payment destination at the time the invoice is issued.
-- This ensures historical invoices show the correct payment details even if global settings change.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_lipa_number TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_bank_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_bank_account_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_bank_account_number TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_qr_storage_key TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_qr_content_type TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_destination_method TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_destination_label TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_destination_id UUID REFERENCES payment_destinations(id) ON DELETE SET NULL;

-- Index for looking up invoices by payment destination
CREATE INDEX IF NOT EXISTS invoices_payment_destination_idx ON invoices (payment_destination_id);