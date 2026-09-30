-- Persist the reason supplied when an admin reviews a leave request.
ALTER TABLE "LeaveRequest"
ADD COLUMN IF NOT EXISTS "reviewReason" TEXT;
