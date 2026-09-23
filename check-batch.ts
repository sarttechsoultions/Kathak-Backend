import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const missingBatches = await prisma.$queryRaw`SELECT id FROM "BatchStudent" WHERE "batchId" NOT IN (SELECT id FROM "Batch")`;
  console.log("Missing batches:", missingBatches);
  
  const missingCourses = await prisma.$queryRaw`SELECT id FROM "Enrollment" WHERE "courseId" NOT IN (SELECT id FROM "Course")`;
  console.log("Missing courses:", missingCourses);
}
main().finally(() => prisma.$disconnect());
