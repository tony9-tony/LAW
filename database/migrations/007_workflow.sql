-- Migration 007: Workflow tables for request–matter lifecycle.
-- Adds: request_info_requests, client_responses, internal_notes
-- Also backfills matter statuses to use proper status values.

-- Information requests: when the firm needs more details from the client.
CREATE TABLE IF NOT EXISTS request_info_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    items TEXT NOT NULL,
    message TEXT,
    deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS request_info_requests_request_idx ON request_info_requests (request_id, created_at DESC);

-- Client responses to information requests.
CREATE TABLE IF NOT EXISTS client_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    info_request_id UUID REFERENCES request_info_requests(id) ON DELETE SET NULL,
    client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS client_responses_request_idx ON client_responses (request_id, created_at DESC);

-- Internal notes visible only to staff/owners (never to clients).
CREATE TABLE IF NOT EXISTS internal_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('request', 'matter')),
    entity_id UUID NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS internal_notes_entity_idx ON internal_notes (entity_type, entity_id, created_at DESC);

-- Matters: add urgency column for the request->matter flow.
ALTER TABLE matters ADD COLUMN IF NOT EXISTS urgency TEXT;

-- Appointments: make matter_id NOT NULL since appointments are tied to matters.
-- (Existing data with NULL matter_id is preserved; new rows must link to a matter.)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES requests(id) ON DELETE SET NULL;
