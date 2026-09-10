import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const gateways = await prisma.payment.findMany({
    select: { gateway: true },
    distinct: ["gateway"],
  });
  console.log("Distinct gateways:");
  console.log(gateways);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
