import { PrismaClient, PendingEnrollmentStatus, Role, ClassMode } from "@prisma/client";
import { completePendingEnrollment } from "./modules/student/enrollment.service";

const prisma = new PrismaClient();

async function runPendingLifecycleTests() {
  console.log("=================================================");
  console.log("TESTING PENDING ENROLLMENT STATUS LIFECYCLE & DB ENUM");
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
    // 1. Setup Test Course & User
    const testCourse = await prisma.course.upsert({
      where: { id: "test-course-lifecycle-001" },
      update: {},
      create: {
        id: "test-course-lifecycle-001",
        title: "Test Lifecycle Course",
        slug: "test-lifecycle-course",
        description: "Test Course",
        category: "BASIC",
        groupFeeINR: 3300,
        groupFeeUSD: 50,
        groupClassesCount: "8",
        joiningFeeINR: 1100,
        oneToOneFeeINR: 5000,
        oneToOneFeeUSD: 100,
        oneToOneClassesCount: "4",
      },
    });

    const testAdmin = await prisma.user.upsert({
      where: { email: "admin.lifecycle@kathak.com" },
      update: {},
      create: {
        id: "admin-lifecycle-001",
        fullName: "Admin Lifecycle",
        email: "admin.lifecycle@kathak.com",
        phone: "+919988771122",
        country: "India",
        countryCode: "+91",
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        role: Role.ADMIN,
      },
    });

    // Cleanup previous test pending enrollments
    await prisma.pendingEnrollment.deleteMany({
      where: { email: "student.lifecycle@kathak.com" },
    });

    await prisma.user.deleteMany({
      where: { email: "student.lifecycle@kathak.com" },
    });

    // ------------------------------------------------------------------
    // TEST 1: PENDING -> PROCESSING -> COMPLETED (Cash Enrollment)
    // ------------------------------------------------------------------
    const idempotencyKey1 = `IDEMP-LIFE-CASH-${Date.now()}`;
    const pending1 = await prisma.pendingEnrollment.create({
      data: {
        idempotencyKey: idempotencyKey1,
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        batchId: "",
        recordedByAdminId: testAdmin.id,
        email: "student.lifecycle@kathak.com",
        phone: "+919988771133",
        courseId: testCourse.id,
        status: PendingEnrollmentStatus.PENDING,
        payload: {
          fullName: "Student Lifecycle Test",
          email: "student.lifecycle@kathak.com",
          phone: "+919988771133",
          country: "India",
          countryCode: "+91",
          address: "123 Test St",
          courseId: testCourse.id,
          batchId: "",
          enrollmentType: "GROUP",
          paymentMethod: "CASH",
          operationType: "NEW",
          months: 1,
          expectedAmount: 4400,
          expectedCurrency: "INR",
          joiningFeeApplied: 1100,
          gateway: "CASH",
          recordedByAdminId: testAdmin.id,
          amountReceived: 4400,
        },
      },
    });

    assert(
      pending1.status === PendingEnrollmentStatus.PENDING,
      "TEST 1a: PendingEnrollment initially created with status PENDING"
    );

    // Call completePendingEnrollment which performs updateMany to status = PROCESSING
    const completed1 = await completePendingEnrollment({
      pendingId: pending1.id,
      razorpayOrderId: null,
      razorpayPaymentId: `CASH-TXN-LIFE-${Date.now()}`,
    });

    const refreshed1 = await prisma.pendingEnrollment.findUnique({
      where: { id: pending1.id },
    });

    assert(
      refreshed1?.status === PendingEnrollmentStatus.COMPLETED,
      "TEST 1b: PendingEnrollment safely transitioned PENDING -> PROCESSING -> COMPLETED without 22P02 error"
    );

    assert(
      completed1.user !== null && completed1.enrollment !== null,
      "TEST 1c: Cash Enrollment finalized Payment, Invoice & Enrollment successfully"
    );

    // ------------------------------------------------------------------
    // TEST 2: PENDING -> PROCESSING -> FAILED transition
    // ------------------------------------------------------------------
    const idempotencyKey2 = `IDEMP-LIFE-FAIL-${Date.now()}`;
    const pending2 = await prisma.pendingEnrollment.create({
      data: {
        idempotencyKey: idempotencyKey2,
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        batchId: "",
        recordedByAdminId: testAdmin.id,
        email: "student.lifecycle2@kathak.com",
        phone: "+919988771144",
        courseId: testCourse.id,
        status: PendingEnrollmentStatus.PENDING,
        payload: {
          fullName: "Student Lifecycle Test 2",
          email: "student.lifecycle2@kathak.com",
          phone: "+919988771144",
        },
      },
    });

    // Directly test transition to PROCESSING
    await prisma.pendingEnrollment.updateMany({
      where: { id: pending2.id, status: PendingEnrollmentStatus.PENDING },
      data: { status: PendingEnrollmentStatus.PROCESSING, errorMessage: null },
    });

    const inProcessing = await prisma.pendingEnrollment.findUnique({
      where: { id: pending2.id },
    });

    assert(
      inProcessing?.status === PendingEnrollmentStatus.PROCESSING,
      "TEST 2a: Direct updateMany transition to PROCESSING succeeded in PostgreSQL"
    );

    // Transition to FAILED
    await prisma.pendingEnrollment.update({
      where: { id: pending2.id },
      data: { status: PendingEnrollmentStatus.FAILED, errorMessage: "Simulated failure" },
    });

    const inFailed = await prisma.pendingEnrollment.findUnique({
      where: { id: pending2.id },
    });

    assert(
      inFailed?.status === PendingEnrollmentStatus.FAILED,
      "TEST 2b: Transition to FAILED succeeded in PostgreSQL"
    );

    // Cleanup
    await prisma.pendingEnrollment.delete({ where: { id: pending1.id } });
    await prisma.pendingEnrollment.delete({ where: { id: pending2.id } });
    await prisma.invoice.deleteMany({ where: { userId: completed1.user.id } });
    await prisma.payment.deleteMany({ where: { userId: completed1.user.id } });
    await prisma.monthlyDue.deleteMany({ where: { userId: completed1.user.id } });
    await prisma.enrollment.deleteMany({ where: { userId: completed1.user.id } });
    await prisma.user.delete({ where: { id: completed1.user.id } });

    console.log("=================================================");
    console.log(`LIFECYCLE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error("Fatal Test Execution Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runPendingLifecycleTests();
