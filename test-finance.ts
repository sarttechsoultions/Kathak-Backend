import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find a user who has a total paid amount of 38400
  const users = await prisma.user.findMany({
    include: {
      payments: true,
      enrollments: {
        include: {
          monthlyDues: true,
        }
      }
    }
  });

  for (const user of users) {
    const paidAmount = user.payments
      .filter(p => p.status === "SUCCESS")
      .reduce((acc, p) => acc + p.amount, 0);

    if (paidAmount === 38400) {
      console.log("Found User:", user.email, user.id);
      console.log("Payments:", user.payments.map(p => ({
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt
      })));
      
      const enrollment = user.enrollments[0];
      if (enrollment) {
        console.log("Enrollment:", {
          id: enrollment.id,
          paymentMode: enrollment.paymentMode,
          monthsPaid: enrollment.monthsPaid,
          createdAt: enrollment.createdAt
        });

        console.log("Monthly Dues:", enrollment.monthlyDues.map(md => ({
          dueMonth: md.dueMonth,
          amount: md.amount,
          status: md.status,
          createdAt: md.createdAt
        })));
      }
      console.log("--------------------------------------------------");
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
