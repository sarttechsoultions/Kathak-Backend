-- Prevent duplicate attendance for the same student in the same live class.
-- Existing non-live/manual attendance remains untouched because liveClassId is nullable.
ALTER TABLE "Attendance" ADD COLUMN "liveClassId" TEXT;

CREATE UNIQUE INDEX "Attendance_liveClassId_studentId_key"
ON "Attendance"("liveClassId", "studentId");

ALTER TABLE "Attendance"
ADD CONSTRAINT "Attendance_liveClassId_fkey"
FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
