import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("=== EXECUTING CLEANUP ===\n");

  // Find all enrollments with FULL_COURSE payment mode
  const enrollments = await prisma.enrollment.findMany({
    where: {
      paymentMode: 'FULL_COURSE',
    },
    include: {
      monthlyDues: true
    }
  });

  const idsToDelete: string[] = [];

  for (const enrollment of enrollments) {
    const pendingDues = enrollment.monthlyDues.filter(md => md.status === 'PENDING');
    for (const due of pendingDues) {
      idsToDelete.push(due.id);
    }
  }

  console.log(`Found ${idsToDelete.length} PENDING MonthlyDue records to delete.`);

  if (idsToDelete.length > 0) {
    const deleteResult = await prisma.monthlyDue.deleteMany({
      where: {
        id: { in: idsToDelete }
      }
    });
    console.log(`Successfully deleted ${deleteResult.count} records.\n`);
  } else {
    console.log("No records needed deletion.\n");
  }

  console.log("=== VERIFICATION ===\n");

  // Verify that remaining PENDING records for FULL_COURSE is 0
  const remainingPending = await prisma.monthlyDue.count({
    where: {
      status: 'PENDING',
      enrollment: {
        paymentMode: 'FULL_COURSE'
      }
    }
  });
  console.log(`Remaining PENDING records for FULL_COURSE students: ${remainingPending}`);

  // Verify specifically for shivam103@yopmail.com
  const specificUser = await prisma.user.findFirst({
    where: { email: 'shivam103@yopmail.com' },
    include: {
      enrollments: {
        where: { paymentMode: 'FULL_COURSE' },
        include: {
          monthlyDues: true
        }
      }
    }
  });

  if (specificUser && specificUser.enrollments.length > 0) {
    const dues = specificUser.enrollments[0].monthlyDues;
    const successDues = dues.filter(d => d.status === 'SUCCESS');
    const pendingDues = dues.filter(d => d.status === 'PENDING');

    console.log(`\nVerification for shivam103@yopmail.com:`);
    console.log(`SUCCESS records remaining: ${successDues.length}`);
    console.log(`PENDING records remaining: ${pendingDues.length}`);
  } else {
    console.log("\nUser shivam103@yopmail.com not found or has no FULL_COURSE enrollment.");
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
