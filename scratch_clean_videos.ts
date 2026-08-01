import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const courses = await prisma.course.findMany();
  for (const c of courses) {
    if (c.oneToOneClassesCount && c.oneToOneClassesCount.includes("mediadelivery.net")) {
      await prisma.course.update({
        where: { id: c.id },
        data: { oneToOneClassesCount: "" }
      });
      console.log(`Cleared broken video URL for course: ${c.title} (${c.id})`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
