import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { enrollCashStudent } from "./modules/admin/admin.controller";
import { studentLogin } from "./modules/student/student.controller";
import { sendEnrollmentWelcomeEmail } from "./modules/student/enrollment.service";
import * as mailer from "./lib/mailer";

const prisma = new PrismaClient();

async function runAdminPasswordAuthTests() {
  console.log("=================================================");
  console.log("TESTING ADMIN ENROLLMENT PASSWORD AUTH & EMAIL");
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

  function createMockRes() {
    const res: any = {
      statusCode: 200,
      jsonBody: null,
      cookies: {},
      clearedCookies: [],
      headers: {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.jsonBody = data;
        return this;
      },
      cookie(name: string, val: any) {
        this.cookies[name] = val;
        return this;
      },
      clearCookie(name: string) {
        this.clearedCookies.push(name);
        return this;
      },
      append(name: string, val: string) {
        if (!this.headers[name]) this.headers[name] = [];
        this.headers[name].push(val);
        return this;
      },
    };
    return res;
  }

  try {
    let testAdmin = await prisma.user.findFirst({
      where: { role: Role.ADMIN },
    });

    if (!testAdmin) {
      testAdmin = await prisma.user.create({
        data: {
          id: `admin-pwdtest-${Date.now()}`,
          fullName: "Admin Password Test",
          email: `admin.pwdtest.${Date.now()}@kathak.com`,
          phone: `+91998${Math.floor(100000 + Math.random() * 900000)}`,
          country: "India",
          countryCode: "+91",
          passwordHash: await bcrypt.hash("AdminPass123", 10),
          role: Role.ADMIN,
        },
      });
    }

    const testCourse = await prisma.course.upsert({
      where: { id: "test-course-pwd-001" },
      update: {},
      create: {
        id: "test-course-pwd-001",
        title: "Kathak Basics Pwd Test",
        slug: "kathak-basics-pwd-test",
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

    const testBatch = await prisma.batch.upsert({
      where: { id: "test-batch-pwd-001" },
      update: {},
      create: {
        id: "test-batch-pwd-001",
        name: "Morning Batch Pwd Test",
        code: "GRP-PWD-001",
        courseId: testCourse.id,
        courseName: testCourse.title,
      },
    });

    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const studentEmail = `student.pwdtest.${randomSuffix}@example.com`;
    const studentPhone = `+91987${randomSuffix}`;
    const testPassword = "Test@123";

    // ------------------------------------------------------------------
    // TEST 1: Admin Enrollment with password = Test@123
    // ------------------------------------------------------------------
    const idempotencyKey1 = `IDEMP-PWD-TEST-1-${Date.now()}`;
    const req1: any = {
      user: { id: testAdmin.id, role: Role.ADMIN },
      body: {
        fullName: "Test Password Student",
        email: studentEmail,
        phone: studentPhone,
        country: "India",
        countryCode: "+91",
        countryIsoCode: "IN",
        password: testPassword,
        dob: "2000-01-01",
        gender: "Female",
        address: "123 Dance Lane",
        region: "Maharashtra",
        city: "Mumbai",
        postalCode: "400001",
        courseId: testCourse.id,
        batchId: testBatch.id,
        enrollmentType: "GROUP",
        joiningDate: "2026-09-10",
        paymentMethod: "CASH",
        paymentMode: "MONTHLY",
        months: 1,
        amountReceived: 4400, // 3300 + 1100
        idempotencyKey: idempotencyKey1,
      },
    };
    const res1 = createMockRes();

    await enrollCashStudent(req1, res1);

    assert(
      res1.statusCode === 200 && res1.jsonBody?.status === "success",
      "Admin Enrollment succeeds",
      `Status: ${res1.statusCode}, Msg: ${res1.jsonBody?.message}`
    );

    // ------------------------------------------------------------------
    // TEST 2: Verify bcrypt.compare("Test@123", User.passwordHash) === true
    // ------------------------------------------------------------------
    const createdUser = await prisma.user.findUnique({
      where: { email: studentEmail },
    });

    assert(
      Boolean(createdUser && createdUser.passwordHash && createdUser.passwordHash.length > 0),
      "User created in DB with non-empty passwordHash",
      `User ID: ${createdUser?.id}, passwordHash: ${createdUser?.passwordHash}`
    );

    const isMatch = createdUser?.passwordHash
      ? await bcrypt.compare(testPassword, createdUser.passwordHash)
      : false;

    assert(
      isMatch === true,
      "bcrypt.compare('Test@123', User.passwordHash) === true",
      `Expected true, got ${isMatch}`
    );

    // ------------------------------------------------------------------
    // TEST 3: Fresh student login with Test@123 (WITHOUT changing password)
    // ------------------------------------------------------------------
    const loginReq: any = {
      body: {
        emailOrPhone: studentEmail,
        password: testPassword,
      },
    };
    const loginRes = createMockRes();

    await studentLogin(loginReq, loginRes);

    assert(
      loginRes.statusCode === 200 && loginRes.jsonBody?.status === "success",
      "Fresh student login with Test@123 succeeds",
      `Status: ${loginRes.statusCode}, Msg: ${loginRes.jsonBody?.message}`
    );

    // ------------------------------------------------------------------
    // TEST 4: Welcome Email contains exact plaintext password Test@123
    // ------------------------------------------------------------------
    let capturedEmailHtml = "";
    const originalSendEmail = mailer.sendEmail;
    (mailer as any).sendEmail = async (options: { html: string }) => {
      capturedEmailHtml = options.html;
      return true;
    };

    const emailStatus = await sendEnrollmentWelcomeEmail(createdUser!, testPassword);
    (mailer as any).sendEmail = originalSendEmail;

    assert(
      emailStatus === true && capturedEmailHtml.includes("Test@123"),
      "Welcome email contains exact plaintext password 'Test@123'",
      `Email HTML contains Test@123: ${capturedEmailHtml.includes("Test@123")}`
    );

    // ------------------------------------------------------------------
    // TEST 5: Wrong password login fails (HTTP 401)
    // ------------------------------------------------------------------
    const wrongLoginReq: any = {
      body: {
        emailOrPhone: studentEmail,
        password: "WrongPassword123",
      },
    };
    const wrongLoginRes = createMockRes();

    await studentLogin(wrongLoginReq, wrongLoginRes);

    assert(
      wrongLoginRes.statusCode === 401 && wrongLoginRes.jsonBody?.status === "error",
      "Wrong password login fails with HTTP 401",
      `Status: ${wrongLoginRes.statusCode}, Msg: ${wrongLoginRes.jsonBody?.message}`
    );

    // ------------------------------------------------------------------
    // TEST 6: SMTP failure does NOT rollback enrollment
    // ------------------------------------------------------------------
    const randomSuffix2 = Math.floor(100000 + Math.random() * 900000);
    const studentEmail2 = `student.smtpfailed.${randomSuffix2}@example.com`;
    const studentPhone2 = `+91986${randomSuffix2}`;

    // Mock sendEmail to simulate SMTP failure
    (mailer as any).sendEmail = async () => {
      throw new Error("SMTP server connection timeout");
    };

    const idempotencyKey2 = `IDEMP-PWD-TEST-2-${Date.now()}`;
    const req2: any = {
      user: { id: testAdmin.id, role: Role.ADMIN },
      body: {
        fullName: "SMTP Fail Student",
        email: studentEmail2,
        phone: studentPhone2,
        country: "India",
        countryCode: "+91",
        countryIsoCode: "IN",
        password: testPassword,
        dob: "2000-01-01",
        gender: "Female",
        address: "456 Fail St",
        region: "Maharashtra",
        city: "Mumbai",
        postalCode: "400001",
        courseId: testCourse.id,
        batchId: testBatch.id,
        enrollmentType: "GROUP",
        joiningDate: "2026-09-10",
        paymentMethod: "CASH",
        paymentMode: "MONTHLY",
        months: 1,
        amountReceived: 4400,
        idempotencyKey: idempotencyKey2,
      },
    };
    const res2 = createMockRes();

    await enrollCashStudent(req2, res2);

    // Restore original sendEmail
    (mailer as any).sendEmail = originalSendEmail;

    assert(
      res2.statusCode === 200 && res2.jsonBody?.status === "success",
      "Admin Enrollment succeeds even when SMTP fails",
      `Status: ${res2.statusCode}, Msg: ${res2.jsonBody?.message}`
    );

    const user2InDb = await prisma.user.findUnique({
      where: { email: studentEmail2 },
    });

    assert(
      Boolean(user2InDb && user2InDb.id),
      "Enrollment DB record remains committed despite SMTP failure",
      `User2 ID: ${user2InDb?.id}`
    );

    // Clean up test data
    await prisma.pendingEnrollment.deleteMany({
      where: { email: { in: [studentEmail, studentEmail2] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [studentEmail, studentEmail2] } },
    });

    console.log("\n=================================================");
    console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runAdminPasswordAuthTests();
