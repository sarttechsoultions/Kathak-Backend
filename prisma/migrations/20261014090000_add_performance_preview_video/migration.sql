ALTER TABLE "PerformanceSectionSettings"
  ADD COLUMN IF NOT EXISTS "previewVideoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "youtubeUrl" TEXT;
