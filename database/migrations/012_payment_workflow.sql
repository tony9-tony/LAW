-- Migration 012: Payment-gated legal-service workflow.
-- Additive. Safe to re-apply (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- The existing invoices, requests, and documents tables are extended, not replaced.

-- ---------------------------------------------------------------------------
-- 1. invoices: request linkage + payment state
--    Existing invoices without request_id keep working (nullable FK).
--    Existing invoice.status behavior is preserved; payment state is separate.
--    matter_id is relaxed to nullable so invoices can be created from a
--    request before a matter exists, then linked later when the request is
--    accepted.
-- ---------------------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES requests(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'UNPAID';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_instructions TEXT;

-- Allow existing invoices to be re-linked to a matter after it is created.
ALTER TABLE invoices ALTER COLUMN matter_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_request_idx ON invoices (request_id);
CREATE INDEX IF NOT EXISTS invoices_payment_status_idx ON invoices (payment_status);

-- payment_status values: UNPAID, PAYMENT_REQUIRED, PAYMENT_PENDING_VERIFICATION, PAID, PAYMENT_REJECTED
ALTER TABLE invoices ADD CONSTRAINT invoices_payment_status_check
    CHECK (payment_status IN ('UNPAID', 'PAYMENT_REQUIRED', 'PAYMENT_PENDING_VERIFICATION', 'PAID', 'PAYMENT_REJECTED'));

-- ---------------------------------------------------------------------------
-- 2. payments
--    A payment belongs to exactly one invoice and one client.
--    Receipt bytes are stored via storage_key; no sensitive payload in the row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'TZS',
    method TEXT NOT NULL,
    reference_number TEXT,
    payment_message TEXT,
    receipt_storage_key TEXT,
    receipt_original_name TEXT,
    receipt_content_type TEXT,
    receipt_size_bytes BIGINT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS payments_client_idx ON payments (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);

ALTER TABLE payments ADD CONSTRAINT payments_method_check
    CHECK (method IN ('mobile_money', 'bank', 'qr'));
ALTER TABLE payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED'));
ALTER TABLE payments ADD CONSTRAINT payments_amount_check
    CHECK (amount > 0);

-- ---------------------------------------------------------------------------
-- 3. payment_destinations
--    OWNER-configurable. One active destination per payment method.
--    Lipa Number is network-agnostic (works across supported networks).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_destinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    method TEXT NOT NULL,
    label TEXT NOT NULL,
    lipa_number TEXT,
    bank_name TEXT,
    bank_account_name TEXT,
    bank_account_number TEXT,
    qr_storage_key TEXT,
    qr_original_name TEXT,
    qr_content_type TEXT,
    instructions TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_destinations_method_idx ON payment_destinations (method, is_active);

ALTER TABLE payment_destinations ADD CONSTRAINT payment_destinations_method_check
    CHECK (method IN ('mobile_money', 'bank', 'qr'));

-- Only one active destination per method.
CREATE UNIQUE INDEX IF NOT EXISTS payment_destinations_one_active_per_method
    ON payment_destinations (method) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 4. service_catalog
--    OWNER-controlled legal services with FIXED or CUSTOM pricing.
--    invoice_items remains the historical price snapshot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    pricing_mode TEXT NOT NULL DEFAULT 'FIXED',
    fixed_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS service_catalog_active_idx ON service_catalog (is_active);

ALTER TABLE service_catalog ADD CONSTRAINT service_catalog_pricing_mode_check
    CHECK (pricing_mode IN ('FIXED', 'CUSTOM'));
ALTER TABLE service_catalog ADD CONSTRAINT service_catalog_fixed_price_check
    CHECK (fixed_price >= 0);

-- ---------------------------------------------------------------------------
-- 5. Seed data
--    Bank account destination (45895019) and default service catalog entries.
--    Idempotent: ON CONFLICT DO NOTHING so re-applying is safe.
-- ---------------------------------------------------------------------------
INSERT INTO payment_destinations (method, label, bank_name, bank_account_name, bank_account_number, instructions, is_active)
VALUES (
    'bank',
    'Bank Deposit',
    'CRDB Bank',
    'ET CETRA ADVOCATES COMPANY LIMITED',
    '45895019',
    'Please deposit the invoice amount into the account above. Use the invoice number as the reference, then upload your payment receipt via the portal for verification.',
    TRUE
)
ON CONFLICT DO NOTHING;

INSERT INTO service_catalog (code, name, description, pricing_mode, fixed_price, is_active) VALUES
    ('CONSULTATION', 'Initial Consultation', 'Initial 30-minute consultation to assess your legal matter.', 'FIXED', 50000.00, TRUE),
    ('RESEARCH', 'Legal Research', 'In-depth legal research on a specific question or issue.', 'CUSTOM', 0, TRUE)
ON CONFLICT (code) DO NOTHING;