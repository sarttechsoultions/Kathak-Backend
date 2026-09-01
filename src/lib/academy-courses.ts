import { CourseCategory } from "@prisma/client";
import { prisma } from "./prisma";
import { SLUG_MARKETING_DEFAULTS } from "./publicCourseMapper";

export type AcademyCourseSeed = {
  slug: string;
  aliases: string[];
  title: string;
  category: CourseCategory;
  description: string;
  groupFeeINR: number;
  groupFeeUSD: number;
  groupClassesCount: string;
  oneToOneFeeINR: number;
  oneToOneFeeUSD: number;
  oneToOneClassesCount: string;
  thumbnail: string;
  badgeBgColor: string;
  borderColor: string;
};

const DEFAULT_THUMBNAIL = "/courses-page/hero-layer.png";
const BADGE_BG = "#1F4A3A";
const BORDER = "border-[#1F4A3A]";

const beginnerLearn = [
  "Basic Tatkar (Footwork)",
  "Hand movements & body posture",
  "Basic Hastaks",
  "Rhythm (Taal) understanding",
  "Simple Tihai & beginner combinations",
  "Basic Abhinaya (Expressions)",
];

const intermediateLearn = [
  "Advanced Tatkar variations",
  "Amad, Tode & Tukde",
  "Paran & Tihai",
  "Chakkars (Spins)",
  "Abhinaya and expression work",
  "Short compositions & choreography",
];

const advancedLearn = [
  "Complex Layakari",
  "Advanced Paran, Chakradhar & Farmaishi compositions",
  "Advanced Chakkars & footwork",
  "In-depth Abhinaya",
  "Performance techniques",
  "Traditional repertoire & stage presentation",
];

const coreIncludes = [
  "Regular Online Classes",
  "Recorded Sessions",
  "Topic-wise PDF notes",
  "Assignment & Feedback",
  "Monthly Progress Evaluation",
  "Certificate of Completion",
];

const assessmentNote =
  "Students with prior Kathak training will be placed in the appropriate level after assessment. Beginner fees apply only to beginner-level students.";

const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

const buildDescription = (parts: {
  about: string;
  includes: string[];
  learn: string[];
  duration: string;
  eligibility: string;
  assessment?: string;
  feeNotes?: string;
}) =>
  [
    parts.about,
    "",
    "What this course includes:",
    bullets(parts.includes),
    "",
    "What you will learn:",
    bullets(parts.learn),
    "",
    `Duration: ${parts.duration}`,
    `Eligibility: ${parts.eligibility}`,
    parts.assessment ? `\nAssessment: ${parts.assessment}` : "",
    parts.feeNotes ? `\n${parts.feeNotes}` : "",
  ]
    .join("\n")
    .trim();

export const academyCourses: AcademyCourseSeed[] = [
  {
    slug: "beginners",
    aliases: ["beginner-foundation", "beginner-prarambhik", "kathak-beginners-course"],
    title: "Kathak Classes — Beginners",
    category: CourseCategory.BASIC,
    description: buildDescription({
      about:
        "The Beginners course is designed for students who are new to Kathak. It lays a strong foundation in basic movements, rhythm, and expressions, helping you build confidence and grace in dance.",
      includes: coreIncludes,
      learn: beginnerLearn,
      duration: "Ongoing monthly batch, 10 classes per month",
      eligibility: "Anyone above 5 years. No prior dance experience required.",
      assessment: assessmentNote,
    }),
    groupFeeINR: 2200,
    groupFeeUSD: 50,
    groupClassesCount: "10 classes per month",
    oneToOneFeeINR: 600,
    oneToOneFeeUSD: 15,
    oneToOneClassesCount: "Minimum 4 classes per month (compulsory)",
    thumbnail: DEFAULT_THUMBNAIL,
    badgeBgColor: BADGE_BG,
    borderColor: BORDER,
  },
  {
    slug: "intermediate",
    aliases: ["intermediate-madhyama", "intermediate-progression", "kathak-intermediate-course"],
    title: "Kathak Classes — Intermediate",
    category: CourseCategory.INTERMEDIATE,
    description: buildDescription({
      about:
        "The Intermediate course is for students with prior Kathak training who wish to strengthen technique, rhythm, and performance skills through longer compositions and richer abhinaya.",
      includes: coreIncludes,
      learn: intermediateLearn,
      duration: "Ongoing monthly batch, 8 classes per month",
      eligibility: "Prior Kathak training. Placement after assessment.",
      assessment: assessmentNote,
    }),
    groupFeeINR: 2500,
    groupFeeUSD: 60,
    groupClassesCount: "8 classes per month",
    oneToOneFeeINR: 900,
    oneToOneFeeUSD: 22,
    oneToOneClassesCount: "Minimum 5 classes per month (compulsory)",
    thumbnail: DEFAULT_THUMBNAIL,
    badgeBgColor: BADGE_BG,
    borderColor: BORDER,
  },
  {
    slug: "advanced",
    aliases: ["advanced-visharad", "advanced-performance", "kathak-advanced-course"],
    title: "Kathak Classes — Advanced",
    category: CourseCategory.PREMIUM,
    description: buildDescription({
      about:
        "The Advanced course is for experienced dancers focusing on mastery, stage performance, and in-depth Kathak training — including complex layakari, traditional repertoire, and presentation.",
      includes: coreIncludes,
      learn: advancedLearn,
      duration: "Ongoing monthly batch, 8 classes per month",
      eligibility: "Experienced Kathak dancers. Faculty assessment required.",
      assessment: assessmentNote,
    }),
    groupFeeINR: 3200,
    groupFeeUSD: 75,
    groupClassesCount: "8 classes per month",
    oneToOneFeeINR: 1200,
    oneToOneFeeUSD: 30,
    oneToOneClassesCount: "Minimum 5 classes per month (compulsory)",
    thumbnail: DEFAULT_THUMBNAIL,
    badgeBgColor: BADGE_BG,
    borderColor: BORDER,
  },
  {
    slug: "ladies-wellness",
    aliases: ["ladies", "ladies-wellness-kathak-batch"],
    title: "Ladies Wellness Batch (Online)",
    category: CourseCategory.BASIC,
    description: buildDescription({
      about:
        "The Ladies Wellness Batch is for women who wish to learn Kathak for physical fitness, mental well-being, stress relief, confidence, and self-expression. No prior dance experience is required.",
      includes: [
        "Live online group classes",
        "Optional one-on-one sessions",
        "Gentle, age-inclusive pacing",
        "Focus on fitness and posture",
        "Breath, grace and expression",
        "Supportive women-only space",
      ],
      learn: [
        "Improves physical fitness & flexibility",
        "Enhances posture, balance & coordination",
        "Reduces stress and promotes mental well-being",
        "Boosts confidence through graceful movement",
        "Suitable for all age groups",
      ],
      duration: "Ongoing monthly batch, 8 classes per month",
      eligibility: "Women, all ages. No prior dance experience required.",
      feeNotes: "India fees only. No international batch at this time.",
    }),
    groupFeeINR: 2200,
    groupFeeUSD: 0,
    groupClassesCount: "8 classes per month",
    oneToOneFeeINR: 700,
    oneToOneFeeUSD: 0,
    oneToOneClassesCount: "Minimum 4 classes per month (compulsory)",
    thumbnail: DEFAULT_THUMBNAIL,
    badgeBgColor: BADGE_BG,
    borderColor: BORDER,
  },
  {
    slug: "kids",
    aliases: ["kathak-kids-batch-age-5"],
    title: "Kids Batch (Age 5+)",
    category: CourseCategory.BASIC,
    description: buildDescription({
      about:
        "The Kids Batch is a fun and structured Kathak program designed for children (age 5+) to build a strong foundation while enjoying the learning process.",
      includes: [
        "Live online group classes",
        "Age-appropriate syllabus",
        "Practice videos for home",
        "Playful rhythm games",
        "Monthly progress notes for parents",
        "Recital opportunities",
      ],
      learn: [
        "Builds rhythm and coordination",
        "Improves focus and concentration",
        "Develops confidence and stage presence",
        "Enhances flexibility and posture",
        "Encourages discipline through the art of Kathak",
      ],
      duration: "Ongoing monthly batch, 10 classes per month",
      eligibility: "Age 5+. No prior dance experience required.",
      feeNotes: "India fees only. No international batch at this time.",
    }),
    groupFeeINR: 2200,
    groupFeeUSD: 0,
    groupClassesCount: "10 classes per month",
    oneToOneFeeINR: 700,
    oneToOneFeeUSD: 0,
    oneToOneClassesCount: "Minimum 4 classes per month (compulsory)",
    thumbnail: DEFAULT_THUMBNAIL,
    badgeBgColor: BADGE_BG,
    borderColor: BORDER,
  },
  {
    slug: "hobby-kathak",
    aliases: ["hobby", "hobby-kathak-batch"],
    title: "Hobby Kathak Batch",
    category: CourseCategory.BASIC,
    description: buildDescription({
      about:
        "The Hobby Kathak Batch is perfect for anyone who wants to learn Kathak as a hobby, for enjoyment, fitness, and self-expression — without exams or professional training. No prior dance experience is required.",
      includes: [
        "Basic Kathak techniques",
        "Graceful movements & posture",
        "Expressions (Abhinaya)",
        "Rhythm and footwork",
        "Simple choreographies",
        "Dance for fitness, relaxation & confidence",
      ],
      learn: [
        "Basic Kathak techniques",
        "Graceful movements & posture",
        "Expressions (Abhinaya)",
        "Rhythm and footwork",
        "Simple choreographies",
        "Dance for fitness, relaxation & confidence",
      ],
      duration: "Ongoing monthly batch, 8 classes per month",
      eligibility: "All ages. No prior dance experience required.",
      feeNotes: "Group classes only. Personal (one-on-one) classes are not offered for this batch.",
    }),
    groupFeeINR: 2500,
    groupFeeUSD: 0,
    groupClassesCount: "8 classes per month",
    oneToOneFeeINR: 0,
    oneToOneFeeUSD: 0,
    oneToOneClassesCount: "Not offered",
    thumbnail: DEFAULT_THUMBNAIL,
    badgeBgColor: BADGE_BG,
    borderColor: BORDER,
  },
];

const matchesCourse = (
  existing: { slug: string; title: string },
  course: AcademyCourseSeed
) => {
  const slug = existing.slug.toLowerCase();
  const title = existing.title.toLowerCase();
  const keys = [course.slug, ...course.aliases].map((value) => value.toLowerCase());

  if (keys.includes(slug)) return true;
  if (keys.some((key) => slug.startsWith(`${key}-`))) return true;
  if (keys.some((key) => title.includes(key.replace(/-/g, " ")))) return true;
  return false;
};

function inferMarketingCategory(slug: string, title: string): string {
  const key = `${slug} ${title}`.toLowerCase();
  if (key.includes("kid")) return "kids";
  if (key.includes("ladies") || key.includes("wellness")) return "ladies";
  if (key.includes("hobby")) return "hobby";
  if (key.includes("intermediate")) return "intermediate";
  if (key.includes("advanced") || key.includes("premium")) return "advanced";
  return "beginners";
}

function firstIntroFromDescription(description: string): string {
  const about = description.split(/\n\s*\n/)[0]?.trim() || description.trim();
  if (about.length <= 180) return about;
  return `${about.slice(0, 177).trim()}...`;
}

export const upsertAcademyCourses = async () => {
  const existing = await prisma.course.findMany({
    select: { id: true, slug: true, title: true, thumbnail: true },
  });
  const matchedIds = new Set<string>();
  const results: { slug: string; action: "created" | "updated"; id: string }[] = [];

  for (const course of academyCourses) {
    let found =
      existing.find((row) => !matchedIds.has(row.id) && matchesCourse(row, course)) ||
      null;

    // The original generic "kathak" record already used beginner fees and has enrollments.
    if (!found && course.slug === "beginners") {
      found =
        existing.find(
          (row) =>
            !matchedIds.has(row.id) &&
            row.title.trim().toLowerCase() === "kathak"
        ) || null;
    }

    const marketingDefaults = SLUG_MARKETING_DEFAULTS[course.slug] || {
      marketingCategory: inferMarketingCategory(course.slug, course.title),
      aliases: course.aliases,
    };

    const data = {
      title: course.title,
      slug: course.slug,
      description: course.description,
      category: course.category,
      groupFeeINR: course.groupFeeINR,
      groupFeeUSD: course.groupFeeUSD,
      groupClassesCount: course.groupClassesCount,
      oneToOneFeeINR: course.oneToOneFeeINR,
      oneToOneFeeUSD: course.oneToOneFeeUSD,
      oneToOneClassesCount: course.oneToOneClassesCount,
      badgeBgColor: course.badgeBgColor,
      borderColor: course.borderColor,
      intro: marketingDefaults.intro || firstIntroFromDescription(course.description),
      marketingCategory: marketingDefaults.marketingCategory,
      aliases: marketingDefaults.aliases || [],
      showOnHome: true,
      homepageSortOrder: academyCourses.findIndex((item) => item.slug === course.slug),
      showExam: marketingDefaults.showExam ?? true,
      published: true,
      thumbnail:
        found?.thumbnail && found.thumbnail.startsWith("http")
          ? found.thumbnail
          : course.thumbnail,
    };

    if (found) {
      matchedIds.add(found.id);
      const updated = await prisma.course.update({
        where: { id: found.id },
        data,
      });
      results.push({ slug: course.slug, action: "updated", id: updated.id });
    } else {
      const created = await prisma.course.create({ data });
      matchedIds.add(created.id);
      results.push({ slug: course.slug, action: "created", id: created.id });
    }
  }

  return results;
};
