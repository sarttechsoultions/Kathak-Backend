import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const invalidSubmissions = await prisma.$queryRaw`SELECT id FROM "AssignmentSubmission" WHERE "assignmentId" NOT IN (SELECT id FROM "Assignment")`;
  console.log("Invalid submissions:", invalidSubmissions);
  const invalidEnrollments = await prisma.$queryRaw`SELECT id FROM "Enrollment" WHERE "courseId" NOT IN (SELECT id FROM "Course")`;
  console.log("Invalid enrollments:", invalidEnrollments);
}
main().finally(() => prisma.$disconnect());
