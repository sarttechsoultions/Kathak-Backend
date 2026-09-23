import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const student = await prisma.user.findFirst({
    where: { id: '06eb932a-3077-4a6d-8ff0-bf19c4b4f728' },
    include: {
      batchMemberships: { include: { batch: true } },
      enrollments: { include: { course: true } },
      attendances: { orderBy: { date: 'desc' }, take: 20 },
      payments: { orderBy: { createdAt: 'desc' } },
      assignmentSubmissions: { include: { assignment: true }, orderBy: { submittedAt: 'desc' } }
    }
  });
  console.log(JSON.stringify(student, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
