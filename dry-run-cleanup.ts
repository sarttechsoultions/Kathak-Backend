import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("=== DRY RUN: Cleanup Extra PENDING MonthlyDues for FULL_COURSE ===\n");

  const enrollments = await prisma.enrollment.findMany({
    where: {
      paymentMode: 'FULL_COURSE',
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
        }
      },
      monthlyDues: {
        orderBy: {
          dueDate: 'asc'
        }
      }
    }
  });

  let totalPendingToDelete = 0;

  for (const enrollment of enrollments) {
    const successDues = enrollment.monthlyDues.filter(md => md.status === 'SUCCESS');
    const pendingDues = enrollment.monthlyDues.filter(md => md.status === 'PENDING');

    if (pendingDues.length > 0) {
      console.log(`Student: ${enrollment.user.email} (ID: ${enrollment.user.id})`);
      console.log(`Enrollment ID: ${enrollment.id}`);
      console.log(`Plan: FULL_COURSE | Months Paid: ${enrollment.monthsPaid}`);
      console.log(`SUCCESS records: ${successDues.length}`);
      console.log(`PENDING records to delete: ${pendingDues.length}`);
      
      const dueMonths = pendingDues.map(md => `${md.dueMonth} (₹${md.amount})`);
      console.log(`Months marked for deletion: [ ${dueMonths.join(", ")} ]`);
      
      console.log("--------------------------------------------------");
      totalPendingToDelete += pendingDues.length;
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total FULL_COURSE Enrollments checked: ${enrollments.length}`);
  console.log(`Total phantom PENDING records that would be DELETED: ${totalPendingToDelete}`);
  console.log(`\nNote: No database changes have been made.`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
