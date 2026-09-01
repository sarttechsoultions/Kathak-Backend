-- Live class chat persistence (run once on your database)
CREATE TABLE IF NOT EXISTS "LiveClassChatMessage" (
  "id" TEXT NOT NULL,
  "liveClassId" TEXT NOT NULL,
  "senderId" TEXT,
  "senderName" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveClassChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LiveClassChatMessage_liveClassId_sentAt_idx"
  ON "LiveClassChatMessage"("liveClassId", "sentAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassChatMessage_liveClassId_fkey'
  ) THEN
    ALTER TABLE "LiveClassChatMessage"
      ADD CONSTRAINT "LiveClassChatMessage_liveClassId_fkey"
      FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
