CREATE TABLE "MobileAppBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL,
    "imageAlt" TEXT,
    "ctaLabel" TEXT,
    "ctaLink" TEXT,
    "linkedType" TEXT NOT NULL DEFAULT 'NONE',
    "linkedId" TEXT,
    "priceOverride" DOUBLE PRECISION,
    "originalPriceOverride" DOUBLE PRECISION,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileAppBanner_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MobileAppBanner_isActive_displayOrder_idx" ON "MobileAppBanner"("isActive", "displayOrder");
ALTER TABLE "MobileAppBanner" ADD CONSTRAINT "MobileAppBanner_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
