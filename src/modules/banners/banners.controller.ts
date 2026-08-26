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
        updatedById: req.user?.id || existing.updatedById,
      },
    });

    res.status(200).json({ status: "success", data: serializeBanner(updated) });
  } catch (error) {
    console.error("Error updating banner:", error);
    res.status(500).json({ status: "error", message: "Failed to update banner." });
  }
};
