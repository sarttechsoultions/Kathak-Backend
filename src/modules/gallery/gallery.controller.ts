import { Request, Response } from "express";
import { GalleryCategory, GalleryMediaType } from "@prisma/client";
import { prisma } from "../../lib/prisma";

const GALLERY_CATEGORIES = new Set<string>(Object.values(GalleryCategory));
const GALLERY_MEDIA_TYPES = new Set<string>(Object.values(GalleryMediaType));

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function parseCategory(value: unknown): GalleryCategory | null {
  const raw = asString(value).toUpperCase();
  if (!raw || !GALLERY_CATEGORIES.has(raw)) return null;
  return raw as GalleryCategory;
}

function parseMediaType(value: unknown): GalleryMediaType | null {
  const raw = asString(value).toUpperCase();
  if (!raw || !GALLERY_MEDIA_TYPES.has(raw)) return null;
  return raw as GalleryMediaType;
}

function youtubeIdFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const idPattern = /^[a-zA-Z0-9_-]{11}$/;

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id && idPattern.test(id) ? id : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
      const fromQuery = parsed.searchParams.get("v");
      if (fromQuery && idPattern.test(fromQuery)) return fromQuery;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if ((parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") && parts[1] && idPattern.test(parts[1])) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function deriveVideoThumbnail(url: string): string | null {
  const youtubeId = youtubeIdFromUrl(url);
  if (youtubeId) return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
  if (!url.includes("/video/upload/")) return null;
  return url
    .replace("/video/upload/", "/video/upload/so_0,q_auto/")
    .replace(/\.(mp4|mov|webm|ogg|m4v)(\?.*)?$/i, ".jpg$2");
}

function serializeItem(item: {
  id: string;
  title: string;
  altText: string | null;
  category: GalleryCategory;
  mediaType: GalleryMediaType;
  url: string;
  thumbnailUrl: string | null;
  showOnHome: boolean;
  sortOrder: number;
  fileName: string | null;
  fileSize: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    title: item.title,
    altText: item.altText || item.title,
    category: item.category,
    mediaType: item.mediaType,
    url: item.url,
    thumbnailUrl: item.thumbnailUrl || (item.mediaType === "VIDEO" ? deriveVideoThumbnail(item.url) : null),
    showOnHome: item.showOnHome,
    sortOrder: item.sortOrder,
    fileName: item.fileName,
    fileSize: item.fileSize,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export const getPublicGallery = async (req: Request, res: Response): Promise<void> => {
  try {
    const category = parseCategory(req.query.category);
    const homeOnly = asBoolean(req.query.home, false);

    const items = await prisma.galleryItem.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(homeOnly ? { showOnHome: true } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    res.status(200).json({ status: "success", data: items.map(serializeItem) });
  } catch (error) {
    console.error("Error fetching public gallery:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch gallery." });
  }
};

export const getAdminGallery = async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await prisma.galleryItem.findMany({
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    res.status(200).json({
      status: "success",
      data: items.map((item) => ({
        ...serializeItem(item),
        uploadedBy: item.uploadedBy,
      })),
    });
  } catch (error) {
    console.error("Error fetching admin gallery:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch gallery." });
  }
};

export const createGalleryItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      res.status(401).json({ status: "error", message: "Authentication required." });
      return;
    }

    const title = asString(req.body?.title);
    const url = asString(req.body?.url);
    const category = parseCategory(req.body?.category);
    const mediaType = parseMediaType(req.body?.mediaType);

    if (!title || !url || !category || !mediaType) {
      res.status(400).json({
        status: "error",
        message: "Title, media URL, category, and media type are required.",
      });
      return;
    }

    const thumbnailUrl = asString(req.body?.thumbnailUrl) || deriveVideoThumbnail(url);

    const created = await prisma.galleryItem.create({
      data: {
        title,
        altText: asString(req.body?.altText) || title,
        category,
        mediaType,
        url,
        thumbnailUrl,
        showOnHome: asBoolean(req.body?.showOnHome, true),
        sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
        fileName: asString(req.body?.fileName) || null,
        fileSize: asString(req.body?.fileSize) || null,
        uploadedById: adminId,
      },
    });

    res.status(201).json({ status: "success", data: serializeItem(created) });
  } catch (error) {
    console.error("Error creating gallery item:", error);
    res.status(500).json({ status: "error", message: "Failed to create gallery item." });
  }
};

export const updateGalleryItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ status: "error", message: "Gallery item ID is required." });
      return;
    }

    const existing = await prisma.galleryItem.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Gallery item not found." });
      return;
    }

    const data: {
      title?: string;
      altText?: string | null;
      category?: GalleryCategory;
      mediaType?: GalleryMediaType;
      url?: string;
      thumbnailUrl?: string | null;
      showOnHome?: boolean;
      sortOrder?: number;
      fileName?: string | null;
      fileSize?: string | null;
    } = {};

    if (req.body?.title !== undefined) {
      const title = asString(req.body.title);
      if (!title) {
        res.status(400).json({ status: "error", message: "Title cannot be empty." });
        return;
      }
      data.title = title;
    }

    if (req.body?.altText !== undefined) data.altText = asString(req.body.altText) || null;
    if (req.body?.url !== undefined) {
      const url = asString(req.body.url);
      if (!url) {
        res.status(400).json({ status: "error", message: "Media URL cannot be empty." });
        return;
      }
      data.url = url;
    }

    if (req.body?.category !== undefined) {
      const category = parseCategory(req.body.category);
      if (!category) {
        res.status(400).json({ status: "error", message: "Invalid gallery category." });
        return;
      }
      data.category = category;
    }

    if (req.body?.mediaType !== undefined) {
      const mediaType = parseMediaType(req.body.mediaType);
      if (!mediaType) {
        res.status(400).json({ status: "error", message: "Invalid media type." });
        return;
      }
      data.mediaType = mediaType;
    }

    if (req.body?.thumbnailUrl !== undefined) data.thumbnailUrl = asString(req.body.thumbnailUrl) || null;
    if (req.body?.showOnHome !== undefined) data.showOnHome = asBoolean(req.body.showOnHome, existing.showOnHome);
    if (req.body?.sortOrder !== undefined && Number.isFinite(Number(req.body.sortOrder))) {
      data.sortOrder = Number(req.body.sortOrder);
    }
    if (req.body?.fileName !== undefined) data.fileName = asString(req.body.fileName) || null;
    if (req.body?.fileSize !== undefined) data.fileSize = asString(req.body.fileSize) || null;

    const nextUrl = data.url ?? existing.url;
    const nextType = data.mediaType ?? existing.mediaType;
    if ((data.url || data.mediaType) && !data.thumbnailUrl && nextType === "VIDEO") {
      data.thumbnailUrl = deriveVideoThumbnail(nextUrl);
    }

    const updated = await prisma.galleryItem.update({ where: { id }, data });
    res.status(200).json({ status: "success", data: serializeItem(updated) });
  } catch (error) {
    console.error("Error updating gallery item:", error);
    res.status(500).json({ status: "error", message: "Failed to update gallery item." });
  }
};

export const deleteGalleryItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ status: "error", message: "Gallery item ID is required." });
      return;
    }

    const existing = await prisma.galleryItem.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Gallery item not found." });
      return;
    }

    await prisma.galleryItem.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Gallery item deleted successfully." });
  } catch (error) {
    console.error("Error deleting gallery item:", error);
    res.status(500).json({ status: "error", message: "Failed to delete gallery item." });
  }
};
