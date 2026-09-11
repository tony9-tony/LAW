-- Migration 010: Conversations can be scoped to a matter, a request, or a client.
-- Previously every conversation required a matter; this lets the owner message a
-- client about a request (or generally) before a matter is created.

-- Allow conversations without a matter.
ALTER TABLE conversations ALTER COLUMN matter_id DROP NOT NULL;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES requests(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE conversations ADD CONSTRAINT conversations_scope_check
    CHECK (matter_id IS NOT NULL OR client_id IS NOT NULL OR request_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS conversations_client_idx ON conversations (client_id);
CREATE INDEX IF NOT EXISTS conversations_request_idx ON conversations (request_id);
