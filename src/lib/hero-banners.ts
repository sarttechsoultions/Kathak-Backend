import type { HeroMediaType, HeroPage } from "@prisma/client";
import { prisma } from "./prisma";

export type HeroBannerSeed = {
  pageKey: HeroPage;
  title: string;
  highlight?: string | null;
  subtitle: string;
  tagline?: string | null;
  mediaType: HeroMediaType;
  mediaUrl: string;
  imageAlt?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  ctaSecondaryLabel?: string | null;
  ctaSecondaryLink?: string | null;
};

const DEFAULT_IMAGE = "/courses-page/hero-layer.png";
const DEFAULT_ALT = "Kathak dancer in traditional red and gold attire";

export const HERO_BANNER_DEFAULTS: HeroBannerSeed[] = [
  {
    pageKey: "HOME",
    title: "Step Into The",
    highlight: "Rhythm of Kathak",
    subtitle: "Discover the grace, discipline and storytelling that make Kathak a timeless classical art.",
    tagline: "Jaipur Gharana Tradition",
    mediaType: "VIDEO",
    mediaUrl: "/herobg.mp4",
    imageAlt: "Kathak performance",
    ctaLabel: "One-to-One",
    ctaLink: "#one-to-one",
    ctaSecondaryLabel: "Inquire Now",
    ctaSecondaryLink: "#inquire",
  },
  {
    pageKey: "ABOUT",
    title: "About",
    subtitle:
      "Whether you're a beginner discovering Kathak for the first time or an experienced dancer refining your art, our classes honor the authentic Jaipur Gharana tradition while nurturing your individual journey. One step at a time, one beat at a time.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "ABOUT_HARSHITA",
    title: "About-Harshita",
    subtitle:
      "Whether you're a beginner discovering Kathak for the first time or an experienced dancer refining your art, our classes honor the authentic Jaipur Gharana tradition while nurturing your individual journey. One step at a time, one beat at a time.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "COURSES",
    title: "Courses",
    subtitle:
      "Begin your journey into Kathak — a dance of rhythm, grace, and soul. Under expert guidance, find your expression through intricate footwork, storytelling, and classical heritage.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "GALLERY",
    title: "Our Gallery",
    subtitle: "Capturing the rhythm, grace, and tradition of Kathak and Indian classical arts.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "EVENTS",
    title: "A Season of Grace",
    subtitle:
      "Experience the divine grace and rhythmic brilliance of Indian classical dance.\nJoin us for a season of spellbinding performances.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "WORKSHOPS",
    title: "Discover the Art of Kathak",
    subtitle:
      "Discover the essence of Kathak through expert guidance, refined technique, expressive storytelling, and timeless Indian tradition.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "JUDGES",
    title: "Judges",
    subtitle:
      "Guided by masters. Inspired by excellence.\nMeet the visionary experts who shape, evaluate and elevate the art of Kathak",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: "Kathak dancer in traditional attire",
  },
  {
    pageKey: "CHOREOGRAPHERS",
    title: "Choreographer Extraordinaire",
    subtitle: "Masters who shape every movement, refine every expression, and bring Kathak to life.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "STUDENTS_CORNER",
    title: "Students' Corner",
    subtitle:
      "Listen to our students share their learning experiences, progress, and the beautiful connection they have built with Kathak.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "VISION",
    title: "Vision & Goals",
    subtitle:
      "Guided by our vision. Driven by our goals.\nDedicated to the growth of Kathak and every learner we inspire.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
  {
    pageKey: "CONTACT",
    title: "Contact",
    subtitle:
      "Whether you're a beginner or a seasoned yogi, our sessions guide you to a healthier body and a centered mind. One breath at a time.",
    mediaType: "IMAGE",
    mediaUrl: DEFAULT_IMAGE,
    imageAlt: DEFAULT_ALT,
  },
];

export async function ensureHeroBanners() {
  const existing = await prisma.heroBanner.findMany({ select: { pageKey: true } });
  const present = new Set(existing.map((item) => item.pageKey));
  const missing = HERO_BANNER_DEFAULTS.filter((item) => !present.has(item.pageKey));

  if (missing.length === 0) return;

  await prisma.heroBanner.createMany({
    data: missing.map((item) => ({
      pageKey: item.pageKey,
      title: item.title,
      highlight: item.highlight ?? null,
      subtitle: item.subtitle,
      tagline: item.tagline ?? null,
      mediaType: item.mediaType,
      mediaUrl: item.mediaUrl,
      imageAlt: item.imageAlt ?? null,
      ctaLabel: item.ctaLabel ?? null,
      ctaLink: item.ctaLink ?? null,
      ctaSecondaryLabel: item.ctaSecondaryLabel ?? null,
      ctaSecondaryLink: item.ctaSecondaryLink ?? null,
    })),
    skipDuplicates: true,
  });
}
