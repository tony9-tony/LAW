-- Migration 003: tighten data integrity.
-- Additive. Safe to apply on existing databases.

-- A matter can have at most one conversation.
ALTER TABLE conversations ADD CONSTRAINT conversations_matter_unique UNIQUE (matter_id);
