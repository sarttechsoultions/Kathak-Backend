CREATE TABLE "PerformanceSectionSettings" (
  "id" TEXT NOT NULL DEFAULT 'performance-section',
  "eyebrow" TEXT NOT NULL DEFAULT 'Featured Performance',
  "title" TEXT NOT NULL DEFAULT 'Experience the Rhythm of Kathak',
  "description" TEXT NOT NULL DEFAULT 'Experience the artistry, grace and timeless tradition of Kathak for your celebration, cultural program or special event.',
  "eventLabels" TEXT NOT NULL DEFAULT 'Available for Events, Weddings, Cultural Programs, Workshops',
  "primaryButtonLabel" TEXT NOT NULL DEFAULT 'Book This Performance',
  "secondaryButtonLabel" TEXT NOT NULL DEFAULT 'Watch Full Video',
  "backgroundImageUrl" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PerformanceSectionSettings_pkey" PRIMARY KEY ("id")
);
