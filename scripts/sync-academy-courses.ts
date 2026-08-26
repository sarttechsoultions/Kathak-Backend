import { prisma } from "../src/lib/prisma";
import { upsertAcademyCourses } from "../src/lib/academy-courses";

async function main() {
  const results = await upsertAcademyCourses();
  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
