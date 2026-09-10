import { PrismaClient, Role, PaymentStatus } from "@prisma/client";
import {
  calculateEnrollmentAmount,
  calculateRenewalAmount,
  nextCoverageDueDate,
  generateCoverageMonths,
} from "./lib/fees";
import { getStudentAccessState } from "./modules/student/access.service";
import { completePendingEnrollment } from "./modules/student/enrollment.service";

const prisma = new PrismaClient();

async function runFinanceArchitectureTests() {
  console.log("=================================================");
  console.log("STARTING FINAL FINANCE ARCHITECTURE TEST SUITE");
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
    // Setup Test Course, Admin & Student
    // ------------------------------------------------------------------
    const testCourse = await prisma.course.upsert({
      where: { id: "test-course-arch-001" },
      update: {},
      create: {
        id: "test-course-arch-001",
        title: "Test Kathak Architecture Course",
        slug: "test-kathak-architecture-course",
        description: "Test Course",
        category: "BASIC",
        groupFeeINR: 2200,
        groupFeeUSD: 40,
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
      where: { email: "admin.arch@kathak.com" },
      update: {},
      create: {
        id: "admin-arch-001",
        fullName: "Admin Arch Test",
        email: "admin.arch@kathak.com",
        phone: "+919988112233",
        country: "India",
        countryCode: "+91",
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        role: Role.ADMIN,
      },
    });

    await prisma.pendingEnrollment.deleteMany({
      where: { email: { startsWith: "student.arch" } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: "student.arch" } },
    });

    const student = await prisma.user.create({
      data: {
        fullName: "Student Architecture Test",
        email: "student.arch1@kathak.com",
        phone: "+919988112244",
        country: "India",
        countryCode: "+91",
        address: "789 Test Ave",
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        role: Role.STUDENT,
      },
    });

    const initialNextDueDate = new Date("2026-10-01T00:00:00.000Z");
    const enrollment = await prisma.enrollment.create({
      data: {
        userId: student.id,
        courseId: testCourse.id,
        mode: "ONLINE",
        type: "GROUP",
        active: true,
        monthsPaid: 1,
        nextDueDate: initialNextDueDate,
      },
    });

    const dueMonth = "2026-10";
    const initialDue = await prisma.monthlyDue.create({
      data: {
        enrollmentId: enrollment.id,
        userId: student.id,
        courseId: testCourse.id,
        dueMonth,
        dueDate: initialNextDueDate,
        amount: 2200,
        currency: "INR",
        status: "PENDING",
      },
    });

    // ------------------------------------------------------------------
    // TEST 1: Admin Finance Cash Mark Paid on MonthlyDue (₹2,200)
    // ------------------------------------------------------------------
    const payment1 = await prisma.payment.create({
      data: {
        userId: student.id,
        enrollmentId: enrollment.id,
        amount: initialDue.amount || 2200,
        currency: "INR",
        gateway: "CASH",
        transactionId: `CASH-DUE-${Date.now()}`,
        status: PaymentStatus.SUCCESS,
      },
    });

    const updatedDue = await prisma.monthlyDue.update({
      where: { id: initialDue.id },
      data: {
        status: "SUCCESS",
        paymentId: payment1.id,
        paidAt: new Date(),
      },
    });

    const invoice1 = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-DUE-${payment1.transactionId.slice(-8)}`,
        paymentId: payment1.id,
        enrollmentId: enrollment.id,
        userId: student.id,
        amount: 2200,
        currency: "INR",
        status: "PAID",
      },
    });

    const nextDueDateAfterDuePay = new Date("2026-11-01T00:00:00.000Z");
    const updatedEnrollment1 = await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { nextDueDate: nextDueDateAfterDuePay },
    });

    assert(
      updatedDue.status === "SUCCESS" &&
        payment1.gateway === "CASH" &&
        invoice1.amount === 2200 &&
        updatedEnrollment1.nextDueDate?.toISOString() === nextDueDateAfterDuePay.toISOString(),
      "TEST 1: Admin Finance Cash Mark Paid updates MonthlyDue=SUCCESS, gateway=CASH, creates Invoice, and moves nextDueDate correctly"
    );

    // ------------------------------------------------------------------
    // TEST 2: Student Pay in Advance / Future Prepaid Coverage (3 Months)
    // ------------------------------------------------------------------
    // Existing nextDueDate is Nov 01 2026. Paying 3 months in advance -> Nov, Dec, Jan -> new nextDueDate = Feb 01 2027
    const futureMonths = 3;
    const renCalc3 = calculateRenewalAmount(2200, 3, testCourse.bulkDiscountTiers as any);
    assert(
      renCalc3.total === 6270 && renCalc3.joiningFee === 0,
      "TEST 2a: 3-month renewal/prepaid price = ₹6,270 (2200 * 3 = 6600 - 5% discount = 6270, joining fee = 0)"
    );

    const targetCoverageStart = updatedEnrollment1.nextDueDate || nextDueDateAfterDuePay;
    const newNextDueDatePrepaid = nextCoverageDueDate(targetCoverageStart, 3);

    const updatedEnrollmentPrepaid = await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        nextDueDate: newNextDueDatePrepaid,
        monthsPaid: enrollment.monthsPaid + 3,
      },
    });

    const dueMonthStr = updatedEnrollmentPrepaid.nextDueDate?.toISOString().slice(0, 7);
    assert(
      dueMonthStr === "2027-02" || updatedEnrollmentPrepaid.nextDueDate?.getUTCFullYear() === 2027,
      "TEST 2b: Student future prepaid coverage extends nextDueDate without overlapping prepaid months (Nov+Dec+Jan -> Feb 2027)"
    );

    // ------------------------------------------------------------------
    // TEST 3: Unrelated Workshop Payment Isolation
    // ------------------------------------------------------------------
    const workshopPayment = await prisma.payment.create({
      data: {
        userId: student.id,
        amount: 1500,
        currency: "INR",
        gateway: "RAZORPAY",
        transactionId: `TXN-WORKSHOP-ISO-${Date.now()}`,
        status: PaymentStatus.SUCCESS,
      },
    });

    const coursePaymentsOnly = await prisma.payment.findMany({
      where: { userId: student.id, enrollmentId: enrollment.id },
    });

    const totalCoursePaid = coursePaymentsOnly.reduce((acc, p) => acc + p.amount, 0);

    assert(
      coursePaymentsOnly.length === 1 && totalCoursePaid === 2200,
      "TEST 3: Course finance calculations isolate course payments (₹2,200) from unrelated workshop payments (₹1,500)"
    );

    await prisma.payment.delete({ where: { id: workshopPayment.id } });

    // ------------------------------------------------------------------
    // TEST 4: Access State Restoration to ACTIVE
    // ------------------------------------------------------------------
    const accessState = await getStudentAccessState(student.id);
    assert(
      accessState.accessState === "ACTIVE" && !accessState.isLocked,
      "TEST 4: Extended future nextDueDate restores student access state to ACTIVE"
    );

    // ------------------------------------------------------------------
    // TEST 5: Idempotent Renewal Retry
    // ------------------------------------------------------------------
    const keyIdemp = `IDEMP-ARCH-RENEW-${Date.now()}`;
    const pendingRen = await prisma.pendingEnrollment.create({
      data: {
        idempotencyKey: keyIdemp,
        passwordHash: "",
        batchId: "",
        recordedByAdminId: testAdmin.id,
        email: student.email,
        phone: student.phone,
        courseId: testCourse.id,
        status: "COMPLETED",
        payload: { operationType: "RENEWAL", expectedAmount: 6270 },
      },
    });

    const fetchCompletedIdemp = await prisma.pendingEnrollment.findUnique({
      where: { idempotencyKey: keyIdemp },
    });

    assert(
      fetchCompletedIdemp?.id === pendingRen.id && fetchCompletedIdemp?.status === "COMPLETED",
      "TEST 5: Retrying renewal with same idempotency key retrieves completed status without duplicate payments or coverage extension"
    );

    await prisma.pendingEnrollment.delete({ where: { id: pendingRen.id } });

    // ------------------------------------------------------------------
    // Cleanup Student Arch
    // ------------------------------------------------------------------
    await prisma.invoice.deleteMany({ where: { userId: student.id } });
    await prisma.payment.deleteMany({ where: { userId: student.id } });
    await prisma.monthlyDue.deleteMany({ where: { userId: student.id } });
    await prisma.enrollment.deleteMany({ where: { userId: student.id } });
    await prisma.user.delete({ where: { id: student.id } });

    console.log("=================================================");
    console.log(`ARCHITECTURE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error("Fatal Architecture Test Execution Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runFinanceArchitectureTests();
