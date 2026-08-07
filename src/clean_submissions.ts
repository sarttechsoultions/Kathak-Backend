import { prisma } from "./lib/prisma";

async function main() {
  await (prisma as any).videoSubmission.deleteMany({});
  console.log("SUCCESSFULLY_CLEANED_ALL_SUBMISSIONS");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
