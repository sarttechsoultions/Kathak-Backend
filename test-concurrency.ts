import { PrismaClient, Role } from '@prisma/client';
import { getLiveClassToken } from './src/modules/liveclass/liveclass.controller';
import { Request, Response } from 'express';
import { setIO } from './src/lib/socket';

const prisma = new PrismaClient();

async function runTest() {
  console.log('--- STARTING CONCURRENCY TEST ---');

  // Mock socket.io
  const mockIO: any = {
    to: () => ({ emit: () => {} }),
    emit: () => {}
  };
  setIO(mockIO);

  const student = await prisma.user.findFirst({ where: { role: Role.STUDENT } });
  const liveClass = await prisma.liveClass.findFirst();
  
  if (!student || !liveClass) {
    console.log('No student or live class found.');
    return;
  }

  const originalStatus = liveClass.status;
  const originalStart = liveClass.scheduledStart;

  // Set the scheduledStart to slightly in the past and scheduledEnd in the future
  await prisma.liveClass.update({
    where: { id: liveClass.id },
    data: { status: 'SCHEDULED', scheduledStart: new Date(Date.now() - 60000), scheduledEnd: new Date(Date.now() + 3600000) }
  });

  // Delete any existing attendance for this combo
  await prisma.attendance.deleteMany({
    where: {
      studentId: student.id,
      batchId: liveClass.batchId,
      session: liveClass.title,
    }
  });

  // Temporarily enroll student
  const existingEnrollment = await prisma.batchStudent.findFirst({
    where: { studentId: student.id, batchId: liveClass.batchId }
  });
  if (!existingEnrollment) {
    await prisma.batchStudent.create({
      data: { studentId: student.id, batchId: liveClass.batchId }
    });
  }

  console.log('Test data ready. Testing 20 concurrent requests...');

  const mockRes = () => {
    const res: any = {};
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (data: any) => { res.body = data; return res; };
    return res;
  };

  const requests = Array.from({ length: 20 }).map((_, i) => {
    const res = mockRes();
    const req = {
      user: { id: student.id, role: Role.STUDENT, fullName: student.fullName },
      params: { id: liveClass.id }
    } as any;
    return getLiveClassToken(req, res as Response).then(() => res);
  });

  const results = await Promise.all(requests);
  console.log('Sample response:', results[0].statusCode, results[0].body);

  const attendances = await prisma.attendance.findMany({
    where: {
      studentId: student.id,
      batchId: liveClass.batchId,
      session: liveClass.title,
    }
  });

  console.log(`Final Attendance Records for this event: ${attendances.length}`);
  if (attendances.length === 1) {
    console.log('SUCCESS: Exactly one attendance record created.');
  } else {
    console.log('FAILED: Race condition still exists.');
    console.log(attendances);
  }

  // Cleanup: Reset live class status
  await prisma.liveClass.update({
    where: { id: liveClass.id },
    data: { status: originalStatus, scheduledStart: originalStart }
  });

  if (!existingEnrollment) {
    await prisma.batchStudent.deleteMany({
      where: { studentId: student.id, batchId: liveClass.batchId }
    });
  }

  console.log('Test completed.');
}

runTest().catch(console.error).finally(() => prisma.$disconnect());
