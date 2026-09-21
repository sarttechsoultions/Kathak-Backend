-- Teacher salary receipts are separate from student/course payments.
CREATE TABLE "TeacherSalaryPayment" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "recordedByAdminId" TEXT NOT NULL,
    "salaryMonth" TEXT NOT NULL,
    "basicAmount" DOUBLE PRECISION NOT NULL,
    "allowanceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "paymentMethod" TEXT NOT NULL,
    "transactionReference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherSalaryPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherSalaryPayment_receiptNumber_key" ON "TeacherSalaryPayment"("receiptNumber");
CREATE UNIQUE INDEX "TeacherSalaryPayment_teacherId_salaryMonth_key" ON "TeacherSalaryPayment"("teacherId", "salaryMonth");
CREATE INDEX "TeacherSalaryPayment_teacherId_paidAt_idx" ON "TeacherSalaryPayment"("teacherId", "paidAt");
CREATE INDEX "TeacherSalaryPayment_paidAt_idx" ON "TeacherSalaryPayment"("paidAt");

ALTER TABLE "TeacherSalaryPayment" ADD CONSTRAINT "TeacherSalaryPayment_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherSalaryPayment" ADD CONSTRAINT "TeacherSalaryPayment_recordedByAdminId_fkey"
  FOREIGN KEY ("recordedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
