import { prisma } from "./lib/prisma";

async function main() {
  const existingCourses = await prisma.course.findMany();
  console.log(`Existing Courses count: ${existingCourses.length}`);

  if (existingCourses.length === 0) {
    await prisma.course.createMany({
      data: [
        {
          title: "Kathak Advanced",
          slug: "kathak-advanced",
          description: "Master Tatkar, Chakkars, and complex Abhinaya.",
          category: "PREMIUM",
          groupFeeINR: 5000,
          groupFeeUSD: 99,
          groupClassesCount: "12 Sessions",
          oneToOneFeeINR: 12000,
          oneToOneFeeUSD: 249,
          oneToOneClassesCount: "12 Sessions",
          published: true,
        },
        {
          title: "Kathak Foundations",
          slug: "kathak-foundations",
          description: "Basic footwork, stances, and mudras for beginners.",
          category: "BASIC",
          groupFeeINR: 4000,
          groupFeeUSD: 79,
          groupClassesCount: "12 Sessions",
          oneToOneFeeINR: 10000,
          oneToOneFeeUSD: 199,
          oneToOneClassesCount: "12 Sessions",
          published: true,
        },
        {
          title: "Mudra Basics",
          slug: "mudra-basics",
          description: "Asamyuta and Samyuta Hastas training.",
          category: "INTERMEDIATE",
          groupFeeINR: 3500,
          groupFeeUSD: 69,
          groupClassesCount: "8 Sessions",
          oneToOneFeeINR: 8000,
          oneToOneFeeUSD: 149,
          oneToOneClassesCount: "8 Sessions",
          published: true,
        },
      ],
    });
    console.log("Seeded 3 default courses into DB");
  }

  const existingBatches = await prisma.batch.findMany();
  console.log(`Existing Batches count: ${existingBatches.length}`);

  if (existingBatches.length === 0) {
    const firstCourse = await prisma.course.findFirst();
    await prisma.batch.createMany({
      data: [
        {
          name: "Alpha-2024",
          code: "ALPHA-2024",
          courseId: firstCourse?.id || null,
          courseName: "Kathak Advanced",
          teacherName: "Guru Meenakshi",
          schedule: "Mon, Wed, Fri (6:00 PM)",
          level: "ADVANCED",
          status: "ACTIVE",
        },
        {
          name: "Beta-2024",
          code: "BETA-2024",
          courseId: firstCourse?.id || null,
          courseName: "Kathak Foundations",
          teacherName: "Guru Meenakshi",
          schedule: "Tue, Thu (5:00 PM)",
          level: "BEGINNER",
          status: "ACTIVE",
        },
        {
          name: "Evening Batch (6:30 PM)",
          code: "EVENING-630",
          courseId: firstCourse?.id || null,
          courseName: "Kathak Advanced",
          teacherName: "Guru Meenakshi",
          schedule: "Sat, Sun (6:30 PM)",
          level: "INTERMEDIATE",
          status: "ACTIVE",
        },
      ],
    });
    console.log("Seeded 3 default batches into DB");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
