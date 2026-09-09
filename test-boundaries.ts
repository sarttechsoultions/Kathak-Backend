import { PrismaClient, Role } from '@prisma/client';
import { getLiveClassToken } from './src/modules/liveclass/liveclass.controller';
import { Request, Response } from 'express';
import { setIO } from './src/lib/socket';

const prisma = new PrismaClient();

// Monkey-patch Date so we can exactly control 'now' in the controller
const OriginalDate = Date;
let mockedTime: number | null = null;
global.Date = class extends OriginalDate {
  constructor(...args: any[]) {
    if (args.length === 0 && mockedTime !== null) {
      super(mockedTime);
    } else {
      super(...(args as []));
    }
  }
  static now() {
    return mockedTime !== null ? mockedTime : OriginalDate.now();
  }
} as DateConstructor;

async function runTests() {
  console.log('--- TIMING BOUNDARY TESTS ---');
  mockedTime = null; // Use real time for setup

  const mockIO: any = { to: () => ({ emit: () => {} }), emit: () => {} };
  setIO(mockIO);

  const student = await prisma.user.findFirst({ where: { role: Role.STUDENT } });
  const teacher = await prisma.user.findFirst({ where: { role: Role.TEACHER } });
  const liveClass = await prisma.liveClass.findFirst();

  if (!student || !teacher || !liveClass) {
    console.log('Test data missing.');
    return;
  }

  await prisma.batch.update({
    where: { id: liveClass.batchId },
    data: { teacherId: teacher.id }
  });

  let studentEnrollment = await prisma.batchStudent.findFirst({ where: { studentId: student.id, batchId: liveClass.batchId } });
  if (!studentEnrollment) {
    studentEnrollment = await prisma.batchStudent.create({ data: { studentId: student.id, batchId: liveClass.batchId } });
  }

  const mockRes = () => {
    const res: any = {};
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (data: any) => { res.body = data; return res; };
    return res;
  };

  async function testBoundary(userRole: Role, offsetSeconds: number, expectedStatusCode: number) {
    mockedTime = null;
    const realNow = new Date();
    
    // Set scheduledStart to realNow
    const scheduledStart = realNow;
    const scheduledEnd = new Date(scheduledStart.getTime() + 3600000);

    await prisma.liveClass.update({
      where: { id: liveClass.id },
      data: { status: 'SCHEDULED', scheduledStart, scheduledEnd }
    });

    // Mock time to exactly offsetSeconds from scheduledStart
    // Example: offset = -601 means we are 601s BEFORE scheduledStart
    mockedTime = scheduledStart.getTime() + (offsetSeconds * 1000);

    const reqUser = userRole === Role.STUDENT ? student : teacher;
    const req = {
      user: { id: reqUser!.id, role: userRole, fullName: reqUser!.fullName },
      params: { id: liveClass.id }
    } as any;
    
    const res = mockRes();
    await getLiveClassToken(req, res as Response);

    const pass = res.statusCode === expectedStatusCode || (expectedStatusCode === 200 && !res.statusCode);
    const label = offsetSeconds < 0 ? `${Math.abs(offsetSeconds)}s before` : `${offsetSeconds}s after`;
    console.log(`[${userRole}] ${label} -> Expected: ${expectedStatusCode}, Got: ${res.statusCode || 200} -> ${pass ? 'PASS' : 'FAIL'} | Body: ${JSON.stringify(res.body)}`);
    
    // Unmock to check db
    mockedTime = null;
    const updatedClass = await prisma.liveClass.findUnique({ where: { id: liveClass.id } });
    const expectedStatus = offsetSeconds >= 0 ? 'LIVE' : 'SCHEDULED';
    if (updatedClass?.status !== expectedStatus) {
      console.log(`  [FAIL] Status transition error. Expected ${expectedStatus}, Got ${updatedClass?.status}`);
    }
  }

  console.log('\nTesting Student Boundaries:');
  await testBoundary(Role.STUDENT, -601, 403);
  await testBoundary(Role.STUDENT, -600, 200);
  await testBoundary(Role.STUDENT, -300, 200);
  await testBoundary(Role.STUDENT, 0, 200);

  console.log('\nTesting Teacher Boundaries:');
  await testBoundary(Role.TEACHER, -601, 403);
  await testBoundary(Role.TEACHER, -600, 200);
  await testBoundary(Role.TEACHER, -300, 200);
  await testBoundary(Role.TEACHER, 0, 200);

  console.log('\n--- CONCURRENCY TEST ---');
  mockedTime = null;
  await prisma.liveClass.update({
    where: { id: liveClass.id },
    data: { status: 'SCHEDULED', scheduledStart: new Date(Date.now() - 300000), scheduledEnd: new Date(Date.now() + 3600000) }
  });
  await prisma.attendance.deleteMany({
    where: { studentId: student.id, batchId: liveClass.batchId, session: liveClass.title }
  });

  const requests = Array.from({ length: 20 }).map((_, i) => {
    const res = mockRes();
    const req = {
      user: { id: student.id, role: Role.STUDENT, fullName: student.fullName },
      params: { id: liveClass.id }
    } as any;
    return getLiveClassToken(req, res as Response);
  });

  await Promise.all(requests);

  const attendances = await prisma.attendance.findMany({
    where: { studentId: student.id, batchId: liveClass.batchId, session: liveClass.title }
  });

  console.log(`Final Attendance Records for this event: ${attendances.length}`);
  if (attendances.length === 1) {
    console.log('SUCCESS: Exactly one attendance record created.');
  } else {
    console.log('FAILED: Race condition still exists.');
  }
}

runTests().catch(console.error).finally(() => prisma.$disconnect());
