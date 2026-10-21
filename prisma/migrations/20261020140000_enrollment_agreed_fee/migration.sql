ALTER TABLE "Enrollment"
ADD COLUMN "agreedMonthlyFee" DOUBLE PRECISION,
ADD COLUMN "feeCurrency" TEXT,
ADD COLUMN "billingAnchorDate" TIMESTAMP(3),
ADD COLUMN "migratedAt" TIMESTAMP(3),
ADD COLUMN "feeHistory" JSONB;
