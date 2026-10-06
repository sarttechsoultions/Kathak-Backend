-- A direct admin lock is separate from account activation and payment grace rules.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "manualAccessLockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manualAccessLockReason" TEXT,
  ADD COLUMN IF NOT EXISTS "manualAccessLockedByAdminId" TEXT;
