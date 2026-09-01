import type { Course } from "@prisma/client";

const MARKETING_LABELS: Record<string, string> = {
  beginners: "Beginners",
  intermediate: "Intermediate",
  advanced: "Advanced",
  ladies: "Ladies Wellness",
  kids: "Kids Batch",
  hobby: "Hobby Kathak",
};

const LEVEL_LABELS: Record<string, string> = {
  BASIC: "Beginner",
  INTERMEDIATE: "Intermediate",
  PREMIUM: "Advanced",
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

function parseBulletSection(text: string, heading: string): string[] {
  const pattern = new RegExp(`${heading}:\\n([\\s\\S]*?)(?=\\n\\n|$)`, "i");
  const match = text.match(pattern);
  if (!match?.[1]) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function parseLineValue(text: string, label: string): string {
  const match = text.match(new RegExp(`${label}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || "";
}

function firstParagraph(text: string): string {
  return text.split(/\n\s*\n/)[0]?.trim() || text.trim();
}

function formatCurrency(amount: number, currency: "INR" | "USD", suffix: string): string {
  if (!amount || amount <= 0) return "";
  if (currency === "INR") return `₹${amount.toLocaleString("en-IN")}${suffix}`;
  return `$${amount.toLocaleString("en-US")}${suffix}`;
}

function resolveBadgeClasses(course: Course) {
  const bg = course.badgeBgColor || "#1F4A3A";
  const border = course.borderColor?.startsWith("border-")
    ? course.borderColor
    : `border-[${bg}]`;

  return {
    badgeBg: bg.startsWith("bg-") ? bg : `bg-[${bg}]`,
    badgeText: "text-white",
    borderColor: border,
  };
}

export type PublicMarketingCourse = {
  id: string;
  slug: string;
  aliases: string[];
  category: string;
  categoryLabel: string;
  title: string;
  level: string;
  intro: string;
  about: string;
  includes: string[];
  learn: string[];
  benefits: string[];
  durationTitle: string;
  durationNote: string;
  eligibilityTitle: string;
  eligibilityNote: string;
  indiaGroup: { label: string; price: string; note: string };
  indiaPersonal: { label: string; price: string; note: string } | null;
  internationalGroup: { label: string; price: string; note: string } | null;
  internationalPersonal: { label: string; price: string; note: string } | null;
  assessmentNote?: string;
  showExam: boolean;
  thumbnail: string;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  videoUrl?: string | null;
  published: boolean;
  showOnHome: boolean;
  homepageSortOrder: number;
};

export function mapCourseToPublicMarketingCourse(course: Course): PublicMarketingCourse {
  const description = course.description || "";
  const category =
    course.marketingCategory?.trim() ||
    inferMarketingCategory(course.slug, course.title);
  const categoryLabel = MARKETING_LABELS[category] || category;
  const badge = resolveBadgeClasses(course);

  const includes = parseBulletSection(description, "What this course includes");
  const learn = parseBulletSection(description, "What you will learn");
  const durationRaw = parseLineValue(description, "Duration");
  const eligibilityRaw = parseLineValue(description, "Eligibility");
  const assessmentNote = parseLineValue(description, "Assessment") || undefined;

  const about = firstParagraph(description);
  const intro =
    course.intro?.trim() ||
    (about.length > 180 ? `${about.slice(0, 177).trim()}...` : about) ||
    `Learn ${course.title} with Kathak by Harshita.`;

  const durationNote = durationRaw || course.groupClassesCount || "Flexible schedule";
  const eligibilityNote = eligibilityRaw || "Open to interested learners";

  const indiaGroupPrice =
    formatCurrency(course.groupFeeINR, "INR", " / month") ||
    "Contact for pricing";
  const internationalGroupPrice = formatCurrency(course.groupFeeUSD, "USD", " / month");

  const indiaPersonalPrice = formatCurrency(course.oneToOneFeeINR, "INR", " per class");
  const internationalPersonalPrice = formatCurrency(course.oneToOneFeeUSD, "USD", " per class");

  return {
    id: course.id,
    slug: course.slug,
    aliases: course.aliases || [],
    category,
    categoryLabel,
    title: course.title,
    level: LEVEL_LABELS[course.category] || course.category,
    intro,
    about,
    includes,
    learn,
    benefits: learn,
    durationTitle: durationRaw ? "Course Duration" : "Ongoing monthly batch",
    durationNote,
    eligibilityTitle: eligibilityRaw ? "Eligibility" : "Who can join",
    eligibilityNote,
    indiaGroup: {
      label: "Group Classes (Online)",
      price: indiaGroupPrice,
      note: course.groupClassesCount || "Monthly batch classes",
    },
    indiaPersonal: course.oneToOneFeeINR
      ? {
          label: "Personal (One-on-One) Classes",
          price: indiaPersonalPrice,
          note: course.oneToOneClassesCount || "Flexible personal sessions",
        }
      : null,
    internationalGroup: course.groupFeeUSD
      ? {
          label: "Online Group Classes",
          price: internationalGroupPrice,
          note: course.groupClassesCount || "Monthly batch classes",
        }
      : null,
    internationalPersonal: course.oneToOneFeeUSD
      ? {
          label: "Personal (One-on-One) Classes",
          price: internationalPersonalPrice,
          note: course.oneToOneClassesCount || "Flexible personal sessions",
        }
      : null,
    assessmentNote,
    showExam: course.showExam ?? true,
    thumbnail: course.thumbnail || "/courses-page/hero-layer.png",
    ...badge,
    videoUrl: course.videoUrl,
    published: course.published,
    showOnHome: course.showOnHome,
    homepageSortOrder: course.homepageSortOrder,
  };
}

export const SLUG_MARKETING_DEFAULTS: Record<
  string,
  { marketingCategory: string; aliases: string[]; intro?: string; showExam?: boolean }
> = {
  beginners: {
    marketingCategory: "beginners",
    aliases: ["beginner-foundation", "beginner-prarambhik", "kathak-beginners-course"],
  },
  intermediate: {
    marketingCategory: "intermediate",
    aliases: ["intermediate-kathak", "kathak-intermediate-course"],
  },
  advanced: {
    marketingCategory: "advanced",
    aliases: ["advanced-kathak", "kathak-advanced-course"],
  },
  "ladies-wellness": {
    marketingCategory: "ladies",
    aliases: ["ladies", "wellness-kathak"],
    showExam: false,
  },
  kids: {
    marketingCategory: "kids",
    aliases: ["kids-batch", "kathak-kids"],
    showExam: false,
  },
  "hobby-kathak": {
    marketingCategory: "hobby",
    aliases: ["hobby", "hobby-batch"],
    showExam: false,
  },
};
