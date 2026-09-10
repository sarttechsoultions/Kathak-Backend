-- CreateTable
CREATE TABLE "TemporaryAccessUnlock" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "unlockedByAdminId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockUntil" TIMESTAMP(3) NOT NULL,
    "durationLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemporaryAccessUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemporaryAccessUnlock_studentId_unlockUntil_idx" ON "TemporaryAccessUnlock"("studentId", "unlockUntil");

-- CreateIndex
CREATE INDEX "TemporaryAccessUnlock_unlockedByAdminId_idx" ON "TemporaryAccessUnlock"("unlockedByAdminId");

-- AddForeignKey
ALTER TABLE "TemporaryAccessUnlock" ADD CONSTRAINT "TemporaryAccessUnlock_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryAccessUnlock" ADD CONSTRAINT "TemporaryAccessUnlock_unlockedByAdminId_fkey" FOREIGN KEY ("unlockedByAdminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
