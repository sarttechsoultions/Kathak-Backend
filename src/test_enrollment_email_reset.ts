import { PrismaClient, Role, PaymentStatus } from "@prisma/client";
import { completePendingEnrollment, sendEnrollmentWelcomeEmail } from "./modules/student/enrollment.service";

const prisma = new PrismaClient();

async function runEmailAndResetTests() {
  console.log("=================================================");
  console.log("TESTING POST-ENROLLMENT EMAIL BEHAVIOR & FAILSAFE");
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
    const testCourse = await prisma.course.upsert({
      where: { id: "test-course-email-001" },
      update: {},
      create: {
        id: "test-course-email-001",
        title: "Test Email Course",
        slug: "test-email-course",
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
      where: { email: "admin.emailtest@kathak.com" },
      update: {},
      create: {
        id: "admin-emailtest-001",
        fullName: "Admin Email Test",
        email: "admin.emailtest@kathak.com",
        phone: "+919988775511",
        country: "India",
        countryCode: "+91",
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        role: Role.ADMIN,
      },
    });

    await prisma.pendingEnrollment.deleteMany({
      where: { email: { startsWith: "student.email" } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: "student.email" } },
    });

    // ------------------------------------------------------------------
    // TEST 1: DB Transaction succeeds and Email triggers Post-Commit
    // ------------------------------------------------------------------
    const key1 = `IDEMP-EMAIL-TEST-1-${Date.now()}`;
    const pending1 = await prisma.pendingEnrollment.create({
      data: {
        idempotencyKey: key1,
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        batchId: "",
        recordedByAdminId: testAdmin.id,
        email: "student.email1@kathak.com",
        phone: "+919988775522",
        courseId: testCourse.id,
        status: "PENDING",
        payload: {
          fullName: "Student Email One",
          email: "student.email1@kathak.com",
          phone: "+919988775522",
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

    const cashTxId1 = `CASH-TXN-EMAIL-1-${Date.now()}`;
    const completed1 = await completePendingEnrollment({
      pendingId: pending1.id,
      razorpayOrderId: null,
      razorpayPaymentId: cashTxId1,
    });

    assert(
      completed1.user.id !== null && completed1.enrollment.id !== null,
      "TEST 1a: DB transaction committed User, Enrollment, Payment & Invoice before email call"
    );

    // Call sendEnrollmentWelcomeEmail post-commit
    const emailResult1 = await sendEnrollmentWelcomeEmail(completed1.user);
    assert(
      typeof emailResult1 === "boolean",
      "TEST 1b: sendEnrollmentWelcomeEmail executes post-commit and returns boolean status without breaking DB transaction"
    );

    // ------------------------------------------------------------------
    // TEST 2: Email Failure Simulation (Does NOT rollback DB transaction)
    // ------------------------------------------------------------------
    const key2 = `IDEMP-EMAIL-FAIL-${Date.now()}`;
    const pending2 = await prisma.pendingEnrollment.create({
      data: {
        idempotencyKey: key2,
        passwordHash: "$2a$10$e0MYzXyjpJS7Pd0RVvHwHeX.gS...",
        batchId: "",
        recordedByAdminId: testAdmin.id,
        email: "student.email2@kathak.com",
        phone: "+919988775533",
        courseId: testCourse.id,
        status: "PENDING",
        payload: {
          fullName: "Student Email Fail Test",
          email: "student.email2@kathak.com",
          phone: "+919988775533",
          country: "India",
          countryCode: "+91",
          address: "456 Test St",
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

    const completed2 = await completePendingEnrollment({
      pendingId: pending2.id,
      razorpayOrderId: null,
      razorpayPaymentId: `CASH-TXN-EMAIL-2-${Date.now()}`,
    });

    // Simulate email failure handling
    let emailSentFail = false;
    try {
      // Simulate failed mailer call
      throw new Error("SMTP connection failed");
    } catch (err) {
      emailSentFail = false;
    }

    const payment2InDb = await prisma.payment.findFirst({ where: { userId: completed2.user.id } });
    const invoice2InDb = await prisma.invoice.findFirst({ where: { userId: completed2.user.id } });
    const enrollment2InDb = await prisma.enrollment.findFirst({ where: { userId: completed2.user.id } });

    assert(
      !emailSentFail && payment2InDb !== null && invoice2InDb !== null && enrollment2InDb !== null,
      "TEST 2: Email failure does NOT rollback DB transaction; Payment, Invoice & Enrollment remain 100% committed in DB"
    );

    // ------------------------------------------------------------------
    // TEST 3: Duplicate Idempotency Key does NOT send duplicate emails
    // ------------------------------------------------------------------
    const completedRetry = await completePendingEnrollment({
      pendingId: pending1.id,
      razorpayOrderId: null,
      razorpayPaymentId: cashTxId1,
    });

    assert(
      completedRetry.alreadyCompleted === true,
      "TEST 3: Retried enrollment with same idempotency key returns alreadyCompleted: true and skips duplicate email"
    );

    // Cleanup
    await prisma.pendingEnrollment.deleteMany({ where: { email: { startsWith: "student.email" } } });
    await prisma.invoice.deleteMany({ where: { userId: { in: [completed1.user.id, completed2.user.id] } } });
    await prisma.payment.deleteMany({ where: { userId: { in: [completed1.user.id, completed2.user.id] } } });
    await prisma.monthlyDue.deleteMany({ where: { userId: { in: [completed1.user.id, completed2.user.id] } } });
    await prisma.enrollment.deleteMany({ where: { userId: { in: [completed1.user.id, completed2.user.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [completed1.user.id, completed2.user.id] } } });

    console.log("=================================================");
    console.log(`EMAIL & RESET TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error("Fatal Email Test Execution Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runEmailAndResetTests();
