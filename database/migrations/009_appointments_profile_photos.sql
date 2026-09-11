-- Migration 009: Appointments consultation fields + profile photos.
-- Additive. Safe to re-apply.

-- Appointments tied to a matter are the norm, but general consultations
-- (no matter yet) must also work, so matter_id stays nullable.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS matter_id UUID REFERENCES matters(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consultation_type TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS meeting_mode TEXT;
-- Duration in minutes (e.g. 30, 60).
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 60;
-- Human-readable location / video link / instructions for the client.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location_details TEXT;

CREATE INDEX IF NOT EXISTS appointments_matter_idx ON appointments (matter_id);
CREATE INDEX IF NOT EXISTS appointments_overlaps_idx ON appointments (client_id, starts_at, ends_at);

-- Profile photos for users (admin + clients). Stored as a reference; bytes
-- served through an authenticated endpoint, never at a public URL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_storage_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_content_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_updated_at TIMESTAMPTZ;

-- Enforce valid consultation/meeting values at the DB layer as a safeguard.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_consultation_type_check;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_meeting_mode_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_consultation_type_check
    CHECK (consultation_type IS NULL OR consultation_type IN ('INITIAL_CONSULTATION','MATTER_CONSULTATION','FOLLOW_UP','GENERAL_CONSULTATION'));
ALTER TABLE appointments ADD CONSTRAINT appointments_meeting_mode_check
    CHECK (meeting_mode IS NULL OR meeting_mode IN ('IN_PERSON','PHONE','VIDEO'));
