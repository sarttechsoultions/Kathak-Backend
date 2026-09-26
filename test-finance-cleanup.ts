import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all enrollments with FULL_COURSE payment mode
  const enrollments = await prisma.enrollment.findMany({
    where: {
      paymentMode: 'FULL_COURSE',
    },
    include: {
      user: true,
      monthlyDues: true
    }
  });

  const affectedStudents = [];

  for (const enrollment of enrollments) {
    const pendingDues = enrollment.monthlyDues.filter(md => md.status === 'PENDING');
    
    if (pendingDues.length > 0) {
      affectedStudents.push({
        email: enrollment.user.email,
        enrollmentId: enrollment.id,
        monthsPaid: enrollment.monthsPaid,
        totalDuesCount: enrollment.monthlyDues.length,
        pendingDues: pendingDues.map(md => ({
          id: md.id,
          dueMonth: md.dueMonth,
          amount: md.amount,
          status: md.status
        }))
      });
    }
  }

  console.log("Total FULL_COURSE Enrollments:", enrollments.length);
  console.log("Affected Students (with PENDING dues):", affectedStudents.length);
  console.log("Details:", JSON.stringify(affectedStudents, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
