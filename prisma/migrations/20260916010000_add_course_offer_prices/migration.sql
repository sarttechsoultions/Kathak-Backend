-- Current fee columns remain the final payable offer price.
-- Original fee columns are optional and are used only to display a genuine discount.
ALTER TABLE "Course"
ADD COLUMN "groupOriginalFeeINR" DOUBLE PRECISION,
ADD COLUMN "groupOriginalFeeUSD" DOUBLE PRECISION,
ADD COLUMN "oneToOneOriginalFeeINR" DOUBLE PRECISION,
ADD COLUMN "oneToOneOriginalFeeUSD" DOUBLE PRECISION;
