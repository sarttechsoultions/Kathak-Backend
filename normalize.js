const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.payment.updateMany({
    where: { gateway: 'razorpay' },
    data: { gateway: 'RAZORPAY' }
  });
  console.log('Normalized gateway values.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
