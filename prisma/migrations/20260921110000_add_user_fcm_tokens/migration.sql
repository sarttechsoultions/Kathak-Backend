-- Device tokens used to deliver Firebase push notifications.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "fcmTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
