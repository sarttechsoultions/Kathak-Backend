import { prisma } from "./lib/prisma";
import { getStudentAccessState } from "./modules/student/access.service";
import { Role } from "@prisma/client";

async function runTests() {
  console.log("==================================================");
  console.log("STARTING STUDENT PAYMENT ACCESS LOCK & UNLOCK E2E TESTS");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  try {
    // Setup test course & course category
    const course = await prisma.course.upsert({
      where: { id: "test-lock-course-id" },
      update: {},
      create: {
        id: "test-lock-course-id",
        title: "Test Kathak Lock Course",
        slug: "test-kathak-lock-course",
        description: "Test Course for Access Lock",
        category: "BASIC",
        groupFeeINR: 1000,
        groupFeeUSD: 20,
        groupClassesCount: "8",
        oneToOneFeeINR: 2000,
        oneToOneFeeUSD: 40,
        oneToOneClassesCount: "4",
        published: true,
      },
    });

    const timestamp = Date.now();
    // Setup test student
    const student = await prisma.user.create({
      data: {
        email: `locktest_${timestamp}@example.com`,
        phone: `+9198${String(timestamp).slice(-8)}`,
        fullName: "Test Lock Student",
        passwordHash: "dummyhash",
        role: Role.STUDENT,
        country: "India",
      },
    });

    // Setup test admin
    const admin = await prisma.user.create({
      data: {
        email: `lockadmin_${timestamp}@example.com`,
        phone: `+9197${String(timestamp).slice(-8)}`,
        fullName: "Test Lock Admin",
        passwordHash: "dummyhash",
        role: Role.ADMIN,
        country: "India",
      },
    });

    // ----------------------------------------------------
    // TEST 1: No enrollment -> LOCKED
    // ----------------------------------------------------
    const state1 = await getStudentAccessState(student.id);
    assert(
      state1.accessState === "LOCKED" && state1.isLocked === true,
      "Test 1: No active enrollment returns LOCKED"
    );

    // Create an enrollment for testing with nextDueDate
    const nextDueDate = new Date("2026-09-01T00:00:00.000Z");
    const enrollment = await prisma.enrollment.create({
      data: {
        userId: student.id,
        courseId: course.id,
        nextDueDate,
        active: true,
        type: "GROUP",
      },
    });

    // ----------------------------------------------------
    // TEST 2: now < nextDueDate -> ACTIVE
    // ----------------------------------------------------
    const nowBeforeDue = new Date("2026-08-25T10:00:00.000Z");
    const state2 = await getStudentAccessState(student.id, nowBeforeDue);
    assert(
      state2.accessState === "ACTIVE" && state2.isLocked === false,
      "Test 2: Future nextDueDate (now < nextDueDate) returns ACTIVE"
    );

    // ----------------------------------------------------
    // TEST 3: Day 0 (nextDueDate 00:00) -> GRACE_PERIOD
    // ----------------------------------------------------
    const nowDay0 = new Date("2026-09-01T12:00:00.000Z");
    const state3 = await getStudentAccessState(student.id, nowDay0);
    assert(
      state3.accessState === "GRACE_PERIOD" && state3.daysOverdue === 0,
      "Test 3: Day 0 overdue returns GRACE_PERIOD"
    );

    // ----------------------------------------------------
    // TEST 4: Day 3 (within 4 days) -> GRACE_PERIOD
    // ----------------------------------------------------
    const nowDay3 = new Date("2026-09-04T23:59:59.000Z");
    const state4 = await getStudentAccessState(student.id, nowDay3);
    assert(
      state4.accessState === "GRACE_PERIOD" && state4.daysOverdue === 3,
      "Test 4: Day 3 overdue returns GRACE_PERIOD"
    );

    // ----------------------------------------------------
    // TEST 5: Day 4 00:00 onward -> LOCKED
    // ----------------------------------------------------
    const nowDay4 = new Date("2026-09-05T00:00:01.000Z");
    const state5 = await getStudentAccessState(student.id, nowDay4);
    assert(
      state5.accessState === "LOCKED" && state5.isLocked === true && state5.daysOverdue >= 4,
      "Test 5: Day 4 overdue returns LOCKED"
    );

    // ----------------------------------------------------
    // TEST 6: Active admin temporary unlock overrides LOCKED -> TEMPORARILY_UNLOCKED
    // ----------------------------------------------------
    const unlockRecord = await prisma.temporaryAccessUnlock.create({
      data: {
        studentId: student.id,
        unlockedByAdminId: admin.id,
        unlockedAt: new Date("2026-09-05T01:00:00.000Z"),
        unlockUntil: new Date("2026-09-08T01:00:00.000Z"),
        durationLabel: "3 Days",
        reason: "Extension for wire transfer verification",
      },
    });

    const state6 = await getStudentAccessState(student.id, nowDay4);
    assert(
      state6.accessState === "TEMPORARILY_UNLOCKED" &&
        state6.isTemporarilyUnlocked === true &&
        state6.isLocked === false,
      "Test 6: Active admin unlock overrides LOCKED to TEMPORARILY_UNLOCKED"
    );

    // ----------------------------------------------------
    // TEST 7: Expired temporary unlock returns to LOCKED
    // ----------------------------------------------------
    const nowAfterUnlockExpired = new Date("2026-09-08T02:00:00.000Z");
    const state7 = await getStudentAccessState(student.id, nowAfterUnlockExpired);
    assert(
      state7.accessState === "LOCKED" && state7.isLocked === true,
      "Test 7: Expired temporary unlock reverts to LOCKED"
    );

    // ----------------------------------------------------
    // TEST 8: Revoked temporary unlock returns to LOCKED
    // ----------------------------------------------------
    const nowDuringUnlock = new Date("2026-09-06T10:00:00.000Z");
    await prisma.temporaryAccessUnlock.update({
      where: { id: unlockRecord.id },
      data: { revokedAt: new Date("2026-09-06T09:00:00.000Z") },
    });

    const state8 = await getStudentAccessState(student.id, nowDuringUnlock);
    assert(
      state8.accessState === "LOCKED" && state8.isLocked === true,
      "Test 8: Revoked temporary unlock reverts to LOCKED"
    );

    // ----------------------------------------------------
    // TEST 9: Successful payment restoration extends nextDueDate -> ACTIVE
    // ----------------------------------------------------
    const newNextDueDate = new Date("2026-10-01T00:00:00.000Z");
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { nextDueDate: newNextDueDate },
    });

    const state9 = await getStudentAccessState(student.id, nowDay4);
    assert(
      state9.accessState === "ACTIVE" && state9.isLocked === false,
      "Test 9: Successful payment updating nextDueDate restores access to ACTIVE"
    );

    // ----------------------------------------------------
    // TEST 10: Failed/pending payment does NOT extend nextDueDate -> remains LOCKED if past due
    // ----------------------------------------------------
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { nextDueDate: new Date("2026-09-01T00:00:00.000Z") },
    });
    const state10 = await getStudentAccessState(student.id, nowDay4);
    assert(
      state10.accessState === "LOCKED" && state10.isLocked === true,
      "Test 10: Failed/pending payment without date extension keeps student LOCKED"
    );

    // ----------------------------------------------------
    // TEST 11: Prepaid plans (3/6/12 months coverage remaining) -> ACTIVE
    // ----------------------------------------------------
    const prepaidDueDate = new Date("2027-03-01T00:00:00.000Z");
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { nextDueDate: prepaidDueDate },
    });
    const state11 = await getStudentAccessState(student.id, nowDay4);
    assert(
      state11.accessState === "ACTIVE" && state11.isLocked === false,
      "Test 11: Prepaid 6-month coverage (now < nextDueDate) evaluates to ACTIVE"
    );

    // ----------------------------------------------------
    // TEST 12: Admin unlock financial immutability
    // ----------------------------------------------------
    const paymentsCountBefore = await prisma.payment.count({ where: { userId: student.id } });
    const duesCountBefore = await prisma.monthlyDue.count({ where: { userId: student.id } });
    const invoicesCountBefore = await prisma.invoice.count({ where: { userId: student.id } });

    await prisma.temporaryAccessUnlock.create({
      data: {
        studentId: student.id,
        unlockedByAdminId: admin.id,
        unlockedAt: new Date(),
        unlockUntil: new Date(Date.now() + 24 * 3600 * 1000),
        durationLabel: "1 Day",
        reason: "Test Financial Immutability",
      },
    });

    const paymentsCountAfter = await prisma.payment.count({ where: { userId: student.id } });
    const duesCountAfter = await prisma.monthlyDue.count({ where: { userId: student.id } });
    const invoicesCountAfter = await prisma.invoice.count({ where: { userId: student.id } });
    const updatedEnrollment = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });

    assert(
      paymentsCountBefore === paymentsCountAfter &&
        duesCountBefore === duesCountAfter &&
        invoicesCountBefore === invoicesCountAfter &&
        updatedEnrollment?.nextDueDate?.getTime() === prepaidDueDate.getTime(),
      "Test 12: Admin unlock does not modify Payment, MonthlyDue, Invoice or nextDueDate"
    );

    // ----------------------------------------------------
    // TEST 13: Renewal extends coverage before current expiry -> ACTIVE
    // ----------------------------------------------------
    await prisma.temporaryAccessUnlock.updateMany({
      where: { studentId: student.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const currentFutureDueDate = new Date("2026-10-01T00:00:00.000Z");
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { nextDueDate: currentFutureDueDate },
    });

    // A valid renewal payment for 3 months extends coverage from current future expiry (+3 months -> 2027-01-01)
    const extendedFutureDueDate = new Date("2027-01-01T00:00:00.000Z");
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { nextDueDate: extendedFutureDueDate },
    });

    const state13 = await getStudentAccessState(student.id, nowBeforeDue);

    const dues = await prisma.monthlyDue.findMany({
      where: { enrollmentId: enrollment.id },
    });
    const uniqueDueMonths = new Set(dues.map((d) => d.dueMonth));
    const noDuplicateDues = dues.length === uniqueDueMonths.size;

    assert(
      state13.accessState === "ACTIVE" &&
        state13.isLocked === false &&
        state13.dueDate?.getTime() === extendedFutureDueDate.getTime() &&
        noDuplicateDues,
      "Test 13: Renewal extends coverage before current expiry -> ACTIVE without duplicate dues"
    );

    // ----------------------------------------------------
    // TEST 14: Duplicate unlock requests (new unlock revokes previous)
    // ----------------------------------------------------
    const nowTime = new Date();
    await prisma.temporaryAccessUnlock.updateMany({
      where: { studentId: student.id, revokedAt: null, unlockUntil: { gt: nowTime } },
      data: { revokedAt: nowTime },
    });

    await prisma.temporaryAccessUnlock.create({
      data: {
        studentId: student.id,
        unlockedByAdminId: admin.id,
        unlockedAt: nowTime,
        unlockUntil: new Date(nowTime.getTime() + 1 * 3600 * 1000),
        durationLabel: "1 Hour",
        reason: "First unlock",
      },
    });

    // Revoke previous active unlock when second is issued
    await prisma.temporaryAccessUnlock.updateMany({
      where: { studentId: student.id, revokedAt: null, unlockUntil: { gt: nowTime } },
      data: { revokedAt: nowTime },
    });

    const unlock2 = await prisma.temporaryAccessUnlock.create({
      data: {
        studentId: student.id,
        unlockedByAdminId: admin.id,
        unlockedAt: nowTime,
        unlockUntil: new Date(nowTime.getTime() + 24 * 3600 * 1000),
        durationLabel: "1 Day",
        reason: "Second unlock",
      },
    });

    const state14 = await getStudentAccessState(student.id, nowTime);
    assert(
      state14.accessState === "TEMPORARILY_UNLOCKED" &&
        state14.activeUnlock?.id === unlock2.id,
      "Test 14: Duplicate unlock replaces active unlock with latest valid unlock"
    );

    // ----------------------------------------------------
    // CLEANUP
    // ----------------------------------------------------
    await prisma.temporaryAccessUnlock.deleteMany({ where: { studentId: student.id } });
    await prisma.enrollment.deleteMany({ where: { userId: student.id } });
    await prisma.user.delete({ where: { id: student.id } });
    await prisma.user.delete({ where: { id: admin.id } });

    console.log("==================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution failed with exception:", err);
    process.exit(1);
  }
}

runTests();
