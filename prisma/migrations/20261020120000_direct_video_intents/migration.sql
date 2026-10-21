-- Additive only. File sizes use double precision because 2 GiB exceeds int32.
CREATE TABLE "VideoUploadIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "purpose" TEXT NOT NULL,
  "relatedId" TEXT,
  "publicId" TEXT NOT NULL,
  "assetId" TEXT,
  "size" DOUBLE PRECISION NOT NULL,
  "mimeType" TEXT NOT NULL,
  "format" TEXT,
  "duration" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'UPLOADING',
  "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "playbackUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "links" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "VideoUploadIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VideoUploadIntent_size_check" CHECK ("size" > 0 AND "size" <= 2147483648),
  CONSTRAINT "VideoUploadIntent_status_check" CHECK ("status" IN ('UPLOADING','UPLOADED','PROCESSING','READY','FAILED','CANCELLED')),
  CONSTRAINT "VideoUploadIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VideoUploadIntent_publicId_key" ON "VideoUploadIntent"("publicId");
CREATE UNIQUE INDEX "VideoUploadIntent_assetId_key" ON "VideoUploadIntent"("assetId");
CREATE UNIQUE INDEX "VideoUploadIntent_playbackUrl_key" ON "VideoUploadIntent"("playbackUrl");
CREATE INDEX "VideoUploadIntent_userId_createdAt_idx" ON "VideoUploadIntent"("userId", "createdAt");
CREATE INDEX "VideoUploadIntent_status_expiresAt_idx" ON "VideoUploadIntent"("status", "expiresAt");
