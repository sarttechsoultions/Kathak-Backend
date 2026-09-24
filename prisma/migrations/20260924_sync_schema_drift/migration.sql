ALTER TABLE "Assignment"
ADD COLUMN "allowLateSubmissions" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ContentResource"
ADD COLUMN "courseId" TEXT;

ALTER TABLE "Course"
ALTER COLUMN "bulkDiscountTiers" SET DEFAULT '[]'::jsonb;

CREATE INDEX "ContentResource_courseId_idx"
ON "ContentResource"("courseId");

ALTER TABLE "ContentResource"
ADD CONSTRAINT "ContentResource_courseId_fkey"
FOREIGN KEY ("courseId")
REFERENCES "Course"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
