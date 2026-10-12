import { Request, Response } from "express";
import type { HeroMediaType, HeroPage } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ensureHeroBanners } from "../../lib/hero-banners";

const HERO_PAGES: HeroPage[] = [
  "HOME",
  "ABOUT",
  "ABOUT_HARSHITA",
  "COURSES",
  "GALLERY",
  "EVENTS",
  "WORKSHOPS",
  "JUDGES",
  "CHOREOGRAPHERS",
  "STUDENTS_CORNER",
  "VISION",
  "CONTACT",
];
const HERO_MEDIA_TYPES: HeroMediaType[] = ["IMAGE", "VIDEO"];
const HERO_PAGE_SET = new Set<string>(HERO_PAGES);
const HERO_MEDIA_TYPE_SET = new Set<string>(HERO_MEDIA_TYPES);

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown): string | null {
  const raw = asString(value);
  return raw ? raw : null;
}

function parsePageKey(value: unknown): HeroPage | null {
  const raw = asString(value).toUpperCase();
  if (!raw || !HERO_PAGE_SET.has(raw)) return null;
  return raw as HeroPage;
}

function parseMediaType(value: unknown): HeroMediaType | null {
  const raw = asString(value).toUpperCase();
  if (!raw || !HERO_MEDIA_TYPE_SET.has(raw)) return null;
  return raw as HeroMediaType;
}

function serializeBanner(item: {
  id: string;
  pageKey: HeroPage;
  title: string;
  highlight: string | null;
  subtitle: string;
  tagline: string | null;
  mediaType: HeroMediaType;
  mediaUrl: string;
  imageAlt: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  ctaSecondaryLabel: string | null;
  ctaSecondaryLink: string | null;
  ctaAction: string | null;
  ctaColor: string | null;
  ctaLayout: string | null;
  ctaPosition: string | null;
  ctaBorderRadius: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    pageKey: item.pageKey,
    title: item.title,
    highlight: item.highlight,
    subtitle: item.subtitle,
    tagline: item.tagline,
    mediaType: item.mediaType,
    mediaUrl: item.mediaUrl,
    imageAlt: item.imageAlt || item.title,
    ctaLabel: item.ctaLabel,
    ctaLink: item.ctaLink,
    ctaSecondaryLabel: item.ctaSecondaryLabel,
    ctaSecondaryLink: item.ctaSecondaryLink,
    ctaAction: item.ctaAction,
    ctaColor: item.ctaColor,
    ctaLayout: item.ctaLayout,
    ctaPosition: item.ctaPosition,
    ctaBorderRadius: item.ctaBorderRadius,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export const getPublicBanners = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureHeroBanners();
    const pageKey = parsePageKey(req.query.page);

    const items = await prisma.heroBanner.findMany({
      where: pageKey ? { pageKey } : undefined,
      orderBy: { pageKey: "asc" },
    });

    res.status(200).json({ status: "success", data: items.map(serializeBanner) });
  } catch (error) {
    console.error("Error fetching public banners:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch banners." });
  }
};

export const getPublicBannerByPage = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureHeroBanners();
    const pageKey = parsePageKey(req.params.pageKey);
    if (!pageKey) {
      res.status(400).json({ status: "error", message: "Invalid hero page." });
      return;
    }

    const item = await prisma.heroBanner.findUnique({ where: { pageKey } });
    if (!item) {
      res.status(404).json({ status: "error", message: "Hero banner not found." });
      return;
    }

    res.status(200).json({ status: "success", data: serializeBanner(item) });
  } catch (error) {
    console.error("Error fetching public banner:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch banner." });
  }
};

export const getAdminBanners = async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureHeroBanners();
    const items = await prisma.heroBanner.findMany({
      include: {
        updatedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { pageKey: "asc" },
    });

    res.status(200).json({
      status: "success",
      data: items.map((item) => ({
        ...serializeBanner(item),
        updatedBy: item.updatedBy,
      })),
    });
  } catch (error) {
    console.error("Error fetching admin banners:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch banners." });
  }
};

export const updateAdminBanner = async (req: Request, res: Response): Promise<void> => {
  try {
    const pageKey = parsePageKey(req.params.pageKey);
    if (!pageKey) {
      res.status(400).json({ status: "error", message: "Invalid hero page." });
      return;
    }

    await ensureHeroBanners();
    const existing = await prisma.heroBanner.findUnique({ where: { pageKey } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Hero banner not found." });
      return;
    }

    const title = req.body?.title !== undefined ? asString(req.body.title) : existing.title;
    if (!title) {
      res.status(400).json({ status: "error", message: "Title cannot be empty." });
      return;
    }

    const mediaUrl = req.body?.mediaUrl !== undefined ? asString(req.body.mediaUrl) : existing.mediaUrl;
    if (!mediaUrl) {
      res.status(400).json({ status: "error", message: "Banner media is required." });
      return;
    }

    let mediaType = existing.mediaType;
    if (req.body?.mediaType !== undefined) {
      const parsed = parseMediaType(req.body.mediaType);
      if (!parsed) {
        res.status(400).json({ status: "error", message: "Invalid media type." });
        return;
      }
      mediaType = parsed;
    }

    const updated = await prisma.heroBanner.update({
      where: { pageKey },
      data: {
        title,
        highlight: req.body?.highlight !== undefined ? asOptionalString(req.body.highlight) : existing.highlight,
        subtitle: req.body?.subtitle !== undefined ? asString(req.body.subtitle) : existing.subtitle,
        tagline: req.body?.tagline !== undefined ? asOptionalString(req.body.tagline) : existing.tagline,
        mediaType,
        mediaUrl,
        imageAlt: req.body?.imageAlt !== undefined ? asOptionalString(req.body.imageAlt) : existing.imageAlt,
        ctaLabel: req.body?.ctaLabel !== undefined ? asOptionalString(req.body.ctaLabel) : existing.ctaLabel,
        ctaLink: req.body?.ctaLink !== undefined ? asOptionalString(req.body.ctaLink) : existing.ctaLink,
        ctaSecondaryLabel:
          req.body?.ctaSecondaryLabel !== undefined
            ? asOptionalString(req.body.ctaSecondaryLabel)
            : existing.ctaSecondaryLabel,
        ctaSecondaryLink:
          req.body?.ctaSecondaryLink !== undefined
            ? asOptionalString(req.body.ctaSecondaryLink)
            : existing.ctaSecondaryLink,
        ctaAction: req.body?.ctaAction !== undefined ? asOptionalString(req.body.ctaAction) : existing.ctaAction,
        ctaColor: req.body?.ctaColor !== undefined ? asOptionalString(req.body.ctaColor) : existing.ctaColor,
        ctaLayout: req.body?.ctaLayout !== undefined ? asOptionalString(req.body.ctaLayout) : existing.ctaLayout,
        ctaPosition: req.body?.ctaPosition !== undefined ? asOptionalString(req.body.ctaPosition) : existing.ctaPosition,
        ctaBorderRadius: req.body?.ctaBorderRadius !== undefined ? asOptionalString(req.body.ctaBorderRadius) : existing.ctaBorderRadius,
        updatedById: req.user?.id || existing.updatedById,
      },
    });

    res.status(200).json({ status: "success", data: serializeBanner(updated) });
  } catch (error) {
    console.error("Error updating banner:", error);
    res.status(500).json({ status: "error", message: "Failed to update banner." });
  }
};

function mobileBannerPayload(body: Record<string, unknown>) {
  const title = asString(body.title);
  const imageUrl = asString(body.imageUrl);
  if (!title || title.length > 120) throw new Error("Title is required and must be 120 characters or less.");
  if (!imageUrl) throw new Error("A banner image is required.");

  const displayOrder = Number(body.displayOrder ?? 0);
  if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 999) {
    throw new Error("Display order must be a number between 0 and 999.");
  }

  const startsAt = body.startsAt ? new Date(asString(body.startsAt)) : null;
  const endsAt = body.endsAt ? new Date(asString(body.endsAt)) : null;
  if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) {
    throw new Error("Use a valid start or end date.");
  }
  if (startsAt && endsAt && startsAt >= endsAt) throw new Error("End date must be after start date.");

  const linkedType = asString(body.linkedType || "NONE").toUpperCase();
  if (!(["NONE", "COURSE", "EVENT"] as string[]).includes(linkedType)) {
    throw new Error("Linked item must be a course, event, or none.");
  }
  const linkedId = asOptionalString(body.linkedId);
  if (linkedType !== "NONE" && !linkedId) throw new Error("Select a course or event for this banner.");
  const parseMoney = (value: unknown, field: string): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) throw new Error(`${field} must be zero or more.`);
    return numberValue;
  };
  const priceOverride = parseMoney(body.priceOverride, "Sale price");
  const originalPriceOverride = parseMoney(body.originalPriceOverride, "Original price");
  if (priceOverride !== null && originalPriceOverride !== null && originalPriceOverride < priceOverride) {
    throw new Error("Original price cannot be lower than sale price.");
  }

  return {
    title,
    subtitle: asString(body.subtitle).slice(0, 280),
    imageUrl,
    imageAlt: asOptionalString(body.imageAlt) || title,
    ctaLabel: asOptionalString(body.ctaLabel),
    ctaLink: asOptionalString(body.ctaLink),
    linkedType,
    linkedId: linkedType === "NONE" ? null : linkedId,
    priceOverride,
    originalPriceOverride,
    displayOrder,
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    startsAt,
    endsAt,
  };
}

async function withMobileBannerPricing(items: Array<{
  linkedType: string; linkedId: string | null; priceOverride: number | null; originalPriceOverride: number | null;
}>) {
  const courseIds = items.filter((item) => item.linkedType === "COURSE" && item.linkedId).map((item) => item.linkedId as string);
  const eventIds = items.filter((item) => item.linkedType === "EVENT" && item.linkedId).map((item) => item.linkedId as string);
  const [courses, events] = await Promise.all([
    courseIds.length ? prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, title: true, groupFeeINR: true, groupOriginalFeeINR: true, slug: true } }) : [],
    eventIds.length ? prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true, registrationFee: true } }) : [],
  ]);
  const courseById = new Map(courses.map((item) => [item.id, item]));
  const eventById = new Map(events.map((item) => [item.id, item]));

  return items.map((item) => {
    const linked = item.linkedType === "COURSE" ? courseById.get(item.linkedId || "") : eventById.get(item.linkedId || "");
    const currentPrice = item.priceOverride ?? (item.linkedType === "COURSE" ? (linked as typeof courses[number] | undefined)?.groupFeeINR : (linked as typeof events[number] | undefined)?.registrationFee) ?? null;
    const originalPrice = item.originalPriceOverride ?? (item.linkedType === "COURSE" ? (linked as typeof courses[number] | undefined)?.groupOriginalFeeINR : null) ?? null;
    const discountPercent = currentPrice !== null && originalPrice !== null && originalPrice > currentPrice
      ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
      : null;
    return { ...item, linkedTitle: linked?.title || null, pricing: currentPrice === null ? null : { currentPrice, originalPrice, currency: "INR", discountPercent } };
  });
}

export const getPublicMobileBanners = async (_req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const items = await prisma.mobileAppBanner.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    });
    res.status(200).json({ status: "success", data: await withMobileBannerPricing(items) });
  } catch (error) {
    console.error("Error fetching mobile app banners:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch mobile app banners." });
  }
};

export const getAdminMobileBanners = async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await prisma.mobileAppBanner.findMany({
      include: { updatedBy: { select: { id: true, fullName: true } } },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    });
    res.status(200).json({ status: "success", data: await withMobileBannerPricing(items) });
  } catch (error) {
    console.error("Error fetching admin mobile app banners:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch mobile app banners." });
  }
};

export const createAdminMobileBanner = async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await prisma.mobileAppBanner.create({
      data: { ...mobileBannerPayload(req.body || {}), updatedById: req.user?.id || null },
    });
    res.status(201).json({ status: "success", data: item });
  } catch (error) {
    res.status(400).json({ status: "error", message: error instanceof Error ? error.message : "Failed to create mobile app banner." });
  }
};

export const updateAdminMobileBanner = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const existing = await prisma.mobileAppBanner.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Mobile app banner not found." });
      return;
    }
    const item = await prisma.mobileAppBanner.update({
      where: { id: existing.id },
      data: { ...mobileBannerPayload({ ...existing, ...(req.body || {}) }), updatedById: req.user?.id || existing.updatedById },
    });
    res.status(200).json({ status: "success", data: item });
  } catch (error) {
    res.status(400).json({ status: "error", message: error instanceof Error ? error.message : "Failed to update mobile app banner." });
  }
};

export const deleteAdminMobileBanner = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await prisma.mobileAppBanner.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Mobile app banner deleted." });
  } catch (error) {
    console.error("Error deleting mobile app banner:", error);
    res.status(404).json({ status: "error", message: "Mobile app banner not found." });
  }
};
