-- Separate read-only finance access from actions that change money or fee status.
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'MANAGE_PAYMENTS';
