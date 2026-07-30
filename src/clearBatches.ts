import { prisma } from "./lib/prisma";

async function clearAllBatches() {
  console.log("Cleaning database...");
  await prisma.batch.deleteMany();
  console.log("SUCCESS: All previous batch records deleted from PostgreSQL database!");
  process.exit(0);
}

clearAllBatches();
