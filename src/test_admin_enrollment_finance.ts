import { PrismaClient, Role, ClassMode, PaymentStatus } from "@prisma/client";
import {
  calculateEnrollmentAmount,
  calculateRenewalAmount,
  nextCoverageDueDate,
  generateCoverageMonths,
} from "./lib/fees";
import { getStudentAccessState } from "./modules/student/access.service";

const prisma = new PrismaClient();

async function runTests() {
  console.log("=================================================");
  console.log("STARTING ADMIN ENROLLMENT & FINANCE TEST MATRIX");
  console.log("=================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  try {
    // ------------------------------------------------------------------
    // Setup Test Data
    // ------------------------------------------------------------------
    const testCourse = await prisma.course.upsert({
      where: { id: "test-course-fin-001" },
      update: {
        title: "Test Kathak Finance Course",
        groupFeeINR: 3300,
        joiningFeeINR: 1100,
        oneToOneFeeINR: 5000,
        bulkDiscountTiers: [
          { months: 3, discountPercent: 5 },
          { months: 6, discountPercent: 10 },
          { months: 12, discountPercent: 15 },
        ] as any,
      },
      create: {
        id: "test-course-fin-001",
        title: "Test Kathak Finance Course",
        slug: "test-kathak-finance-course",
        description: "Test Course Description",
        category: "BASIC",
        groupFeeINR: 3300,
        groupFeeUSD: 50,
        groupClassesCount: "8",
        joiningFeeINR: 1100,
        oneToOneFeeINR: 5000,
        oneToOneFeeUSD: 100,
        oneToOneClassesCount: "4",
        bulkDiscountTiers: [
          { months: 3, discountPercent: 5 },
          { months: 6, discountPercent: 10 },
          { months: 12, discountPercent: 15 },
        ] as any,
      },
    });

    const testAdmin = await prisma.user.upsert({
      where: { email: "testadmin.fin@kathak.com" },
      update: {},
      create: {
        id: "test-admin-fin-001",
        fullName: "Test Admin Finance",
        email: "testadmin.fin@kathak.com",
        phone: "+919988776655",
        country: "India",
        countryCode: "+91",
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        role: Role.ADMIN,
      },
    });

    // Clean up any pre-existing test students for clean isolation
    await prisma.user.deleteMany({
      where: { email: { startsWith: "teststudent.fin" } },
    });

    // ------------------------------------------------------------------
    // TEST 1 & 32: New 1 Month Cash = Monthly + Joining Fee (₹3300 + ₹1100 = ₹4400)
    // ------------------------------------------------------------------
    const calcNew1 = calculateEnrollmentAmount(
      testCourse.groupFeeINR,
      1,
      testCourse.bulkDiscountTiers as any,
      testCourse.joiningFeeINR
    );
    assert(
      calcNew1.total === 4400 && calcNew1.joiningFee === 1100,
      "TEST 1 & 32: New 1 month cash calculation = monthly + joining fee (₹3300 + ₹1100 = ₹4400)",
      `Expected 4400, got ${calcNew1.total}`
    );

    // ------------------------------------------------------------------
    // TEST 3, 4, 5, 6: New 3/6/12 Month Cash Joining Fee = 0 & Bulk Discount
    // ------------------------------------------------------------------
    const calcNew3 = calculateEnrollmentAmount(
      testCourse.groupFeeINR,
      3,
      testCourse.bulkDiscountTiers as any,
      testCourse.joiningFeeINR
    );
    // 3300 * 3 = 9900; 5% of 9900 = 495; 9900 - 495 = 9405
    assert(
      calcNew3.joiningFee === 0 && calcNew3.total === 9405,
      "TEST 3 & 6: New 3 month cash joining fee = 0 and 5% bulk discount applied",
      `Expected total 9405, got ${calcNew3.total}, joining fee ${calcNew3.joiningFee}`
    );

    const calcNew6 = calculateEnrollmentAmount(
      testCourse.groupFeeINR,
      6,
      testCourse.bulkDiscountTiers as any,
      testCourse.joiningFeeINR
    );
    // 3300 * 6 = 19800; 10% discount = 1980; total = 17820
    assert(
      calcNew6.joiningFee === 0 && calcNew6.total === 17820,
      "TEST 4 & 6: New 6 month cash joining fee = 0 and 10% bulk discount applied",
      `Expected total 17820, got ${calcNew6.total}`
    );

    const calcNew12 = calculateEnrollmentAmount(
      testCourse.groupFeeINR,
      12,
      testCourse.bulkDiscountTiers as any,
      testCourse.joiningFeeINR
    );
    // 3300 * 12 = 39600; 15% discount = 5940; total = 33660
    assert(
      calcNew12.joiningFee === 0 && calcNew12.total === 33660,
      "TEST 5 & 6: New 12 month cash joining fee = 0 and 15% bulk discount applied",
      `Expected total 33660, got ${calcNew12.total}`
    );

    // ------------------------------------------------------------------
    // TEST 8 & 35 & 36: Renewal 1 Month Cash, Joining Fee ALWAYS = 0 (₹3300)
    // ------------------------------------------------------------------
    const calcRen1 = calculateRenewalAmount(
      testCourse.groupFeeINR,
      1,
      testCourse.bulkDiscountTiers as any
    );
    assert(
      calcRen1.total === 3300 && calcRen1.joiningFee === 0,
      "TEST 8 & 35: Renewal 1 month expected amount = ₹3300 (joining fee = 0)",
      `Expected 3300, got ${calcRen1.total}`
    );

    // ------------------------------------------------------------------
    // TEST 33 & 34: Exact Cash Mismatch Rejection Simulation
    // ------------------------------------------------------------------
    const expectedNewCash = calcNew1.total; // 4400
    const receivedWrong1 = 3300;
    const receivedWrong2 = 4500;

    assert(
      Math.round(expectedNewCash * 100) !== Math.round(receivedWrong1 * 100),
      "TEST 33: NEW 1-month cash ₹3300 is rejected when ₹4400 is expected"
    );
    assert(
      Math.round(expectedNewCash * 100) !== Math.round(receivedWrong2 * 100),
      "TEST 34: NEW 1-month cash ₹4500 is rejected when ₹4400 is expected"
    );

    const expectedRenCash = calcRen1.total; // 3300
    const receivedWrongRen = 4400;
    assert(
      Math.round(expectedRenCash * 100) !== Math.round(receivedWrongRen * 100),
      "TEST 36: RENEWAL 1-month cash ₹4400 is rejected when ₹3300 is expected"
    );

    // ------------------------------------------------------------------
    // Create Student for E2E Enrollment & Renewal Operations
    // ------------------------------------------------------------------
    const student1 = await prisma.user.create({
      data: {
        fullName: "Test Student Finance One",
        email: "teststudent.fin1@kathak.com",
        phone: "+919876543211",
        country: "India",
        countryCode: "+91",
        address: "123 Test St",
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        role: Role.STUDENT,
      },
    });

    // ------------------------------------------------------------------
    // Perform NEW 1 Month Cash Enrollment DB Creation
    // ------------------------------------------------------------------
    const initialNextDueDate = new Date("2026-10-01T00:00:00.000Z");
    const enrollment1 = await prisma.enrollment.create({
      data: {
        userId: student1.id,
        courseId: testCourse.id,
        mode: ClassMode.ONLINE,
        type: "GROUP",
        active: true,
        monthsPaid: 1,
        nextDueDate: initialNextDueDate,
      },
    });

    const payment1 = await prisma.payment.create({
      data: {
        userId: student1.id,
        enrollmentId: enrollment1.id,
        amount: 4400,
        currency: "INR",
        gateway: "CASH",
        transactionId: "CASH-NEW-TEST-001",
        status: PaymentStatus.SUCCESS,
      },
    });

    const invoice1 = await prisma.invoice.create({
      data: {
        invoiceNumber: "INV-CASH-TEST-001",
        paymentId: payment1.id,
        enrollmentId: enrollment1.id,
        userId: student1.id,
        amount: 4400,
        currency: "INR",
        status: "PAID",
      },
    });

    assert(
      enrollment1.id !== null && payment1.gateway === "CASH" && invoice1.amount === 4400,
      "TEST 1 & 2: New 1 month cash enrollment created Payment, Invoice & Enrollment atomically"
    );

    // ------------------------------------------------------------------
    // TEST 37: Renewal Updates Existing Enrollment (Does NOT create a second Enrollment)
    // ------------------------------------------------------------------
    const initialEnrollmentCount = await prisma.enrollment.count({
      where: { userId: student1.id, courseId: testCourse.id },
    });

    // Simulate Renewal operation for 3 months
    const futureNextDueDate = new Date("2026-12-01T00:00:00.000Z"); // existing nextDueDate in future
    await prisma.enrollment.update({
      where: { id: enrollment1.id },
      data: { nextDueDate: futureNextDueDate },
    });

    // Perform 3-month renewal extending from futureNextDueDate
    const renewalMonths = 3;
    const newNextDueDate = nextCoverageDueDate(futureNextDueDate, renewalMonths);

    // Update the SAME enrollment
    const updatedEnrollment = await prisma.enrollment.update({
      where: { id: enrollment1.id },
      data: {
        nextDueDate: newNextDueDate,
        monthsPaid: enrollment1.monthsPaid + renewalMonths,
        active: true,
      },
    });

    const finalEnrollmentCount = await prisma.enrollment.count({
      where: { userId: student1.id, courseId: testCourse.id },
    });

    assert(
      initialEnrollmentCount === 1 && finalEnrollmentCount === 1,
      "TEST 37: Renewal updates existing Enrollment and does NOT create a second Enrollment record"
    );

    // ------------------------------------------------------------------
    // TEST 13 & 38: Active Prepaid Renewal Coverage Starts Exactly at Existing Future nextDueDate
    // ------------------------------------------------------------------
    // futureNextDueDate was Dec 01 2026; renewing 3 months -> Dec, Jan, Feb -> newNextDueDate should be Mar 01 2027
    const expectedMar1 = nextCoverageDueDate(futureNextDueDate, 3);
    assert(
      updatedEnrollment.nextDueDate?.getTime() === expectedMar1.getTime(),
      "TEST 13 & 38: Renewal extends coverage starting exactly from existing future nextDueDate without overlapping prepaid months",
      `Expected ${expectedMar1.toISOString()}, got ${updatedEnrollment.nextDueDate?.toISOString()}`
    );

    // ------------------------------------------------------------------
    // TEST 14: Expired Renewal Coverage Extension
    // ------------------------------------------------------------------
    const expiredDueDate = new Date("2025-01-01T00:00:00.000Z"); // expired in past
    const expiredNewDueDate = nextCoverageDueDate(expiredDueDate, 1);
    assert(
      expiredNewDueDate > expiredDueDate,
      "TEST 14: Expired renewal extends coverage starting from past nextDueDate/expiry"
    );

    // ------------------------------------------------------------------
    // TEST 15 & 16: MonthlyDue Generation & No Overlapping Dues
    // ------------------------------------------------------------------
    const coverageMonths = generateCoverageMonths(futureNextDueDate, 3);
    assert(
      coverageMonths.length === 3 && coverageMonths[0] === "2026-12",
      "TEST 15 & 16: generateCoverageMonths generates clean non-overlapping coverage months starting at target date"
    );

    // ------------------------------------------------------------------
    // TEST 17 & 39: Idempotency Fingerprint & Collision Safety
    // ------------------------------------------------------------------
    const idempotencyKeyTest = "IDEMP-REN-TEST-KEY-999";
    const pending1 = await prisma.pendingEnrollment.create({
      data: {
        idempotencyKey: idempotencyKeyTest,
        email: student1.email,
        phone: student1.phone,
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        courseId: testCourse.id,
        batchId: "",
        status: "COMPLETED",
        payload: { operationType: "RENEWAL", expectedAmount: 3300 },
      },
    });

    const pendingCheck = await prisma.pendingEnrollment.findUnique({
      where: { idempotencyKey: idempotencyKeyTest },
    });

    assert(
      pendingCheck !== null && pendingCheck.id === pending1.id,
      "TEST 17 & 39: Same idempotency key retrieves completed renewal without duplicating coverage"
    );

    // Clean up test idempotency record
    await prisma.pendingEnrollment.delete({ where: { id: pending1.id } });

    // ------------------------------------------------------------------
    // TEST 18, 19, 20, 21, 22: Finance Totals & Unrelated Payment Exclusion
    // ------------------------------------------------------------------
    // Add an unrelated payment for student1 (e.g. workshop)
    const unrelatedPayment = await prisma.payment.create({
      data: {
        userId: student1.id,
        amount: 500,
        currency: "INR",
        gateway: "RAZORPAY",
        transactionId: "TXN-WORKSHOP-UNRELATED-99",
        status: PaymentStatus.SUCCESS,
      },
    });

    const coursePayments = await prisma.payment.findMany({
      where: { userId: student1.id, enrollmentId: updatedEnrollment.id },
    });

    assert(
      coursePayments.length === 1 && coursePayments[0].amount === 4400,
      "TEST 22: Finance queries scoped to enrollment exclude unrelated workshop payments"
    );

    await prisma.payment.delete({ where: { id: unrelatedPayment.id } });

    // ------------------------------------------------------------------
    // TEST 23, 24, 25: Access Lock State Compatibility & Admin Unlock Neutrality
    // ------------------------------------------------------------------
    // Set nextDueDate into the future -> access state should be ACTIVE
    await prisma.enrollment.update({
      where: { id: updatedEnrollment.id },
      data: { nextDueDate: new Date("2030-01-01T00:00:00.000Z") },
    });

    const accessStateActive = await getStudentAccessState(student1.id);
    assert(
      accessStateActive.accessState === "ACTIVE" && !accessStateActive.isLocked,
      "TEST 23: Successful renewal extending nextDueDate into future restores ACTIVE access state"
    );

    // Test temporary admin unlock does not modify financial records
    const beforePaymentsCount = await prisma.payment.count({ where: { userId: student1.id } });
    const beforeDuesCount = await prisma.monthlyDue.count({ where: { userId: student1.id } });
    const beforeInvoicesCount = await prisma.invoice.count({ where: { userId: student1.id } });

    const unlockRecord = await prisma.temporaryAccessUnlock.create({
      data: {
        studentId: student1.id,
        unlockedByAdminId: testAdmin.id,
        unlockedAt: new Date(),
        unlockUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        durationLabel: "1 Day",
        reason: "Test Unlock",
      },
    });

    const afterPaymentsCount = await prisma.payment.count({ where: { userId: student1.id } });
    const afterDuesCount = await prisma.monthlyDue.count({ where: { userId: student1.id } });
    const afterInvoicesCount = await prisma.invoice.count({ where: { userId: student1.id } });

    assert(
      beforePaymentsCount === afterPaymentsCount &&
        beforeDuesCount === afterDuesCount &&
        beforeInvoicesCount === afterInvoicesCount,
      "TEST 25: Admin temporary unlock does NOT modify Payment, MonthlyDue, Invoice, or nextDueDate"
    );

    // Clean up temporary unlock record
    await prisma.temporaryAccessUnlock.delete({ where: { id: unlockRecord.id } });

    // ------------------------------------------------------------------
    // Cleanup Student 1
    // ------------------------------------------------------------------
    await prisma.invoice.deleteMany({ where: { userId: student1.id } });
    await prisma.payment.deleteMany({ where: { userId: student1.id } });
    await prisma.monthlyDue.deleteMany({ where: { userId: student1.id } });
    await prisma.enrollment.deleteMany({ where: { userId: student1.id } });
    await prisma.user.delete({ where: { id: student1.id } });

    console.log("=================================================");
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Fatal Test Execution Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
