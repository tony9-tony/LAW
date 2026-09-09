-- Migration 004: Add OWNER role to user_role enum.
-- Must run in its own transaction so the new enum value is committed
-- and visible to subsequent migrations.
-- Safe to re-run: IF NOT EXISTS prevents duplicate enum value error.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'OWNER';