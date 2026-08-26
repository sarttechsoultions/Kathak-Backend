import { Request, Response } from "express";
import { StudentCornerKind } from "@prisma/client";
import { prisma } from "../../lib/prisma";

const STUDENT_CORNER_KINDS = new Set<string>(Object.values(StudentCornerKind));

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

function parseKind(value: unknown): StudentCornerKind | null {
  const raw = asString(value).toUpperCase();
  if (!raw || !STUDENT_CORNER_KINDS.has(raw)) return null;
  return raw as StudentCornerKind;
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

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      const fromQuery = parsed.searchParams.get("v");
      if (fromQuery && idPattern.test(fromQuery)) return fromQuery;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (
        (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") &&
        parts[1] &&
        idPattern.test(parts[1])
      ) {
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
  kind: StudentCornerKind;
  studentName: string;
  level: string;
  description: string;
  duration: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
  sortOrder: number;
  isPublished: boolean;
  fileName: string | null;
  fileSize: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    kind: item.kind,
    studentName: item.studentName,
    level: item.level,
    description: item.description,
    duration: item.duration,
    videoUrl: item.videoUrl,
    thumbnailUrl: item.thumbnailUrl || deriveVideoThumbnail(item.videoUrl),
    sortOrder: item.sortOrder,
    isPublished: item.isPublished,
    fileName: item.fileName,
    fileSize: item.fileSize,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export const getPublicStudentCorner = async (req: Request, res: Response): Promise<void> => {
  try {
    const kind = parseKind(req.query.kind);

    const items = await prisma.studentCornerItem.findMany({
      where: {
        isPublished: true,
        ...(kind ? { kind } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    res.status(200).json({ status: "success", data: items.map(serializeItem) });
  } catch (error) {
    console.error("Error fetching public student corner:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student corner." });
  }
};

export const getAdminStudentCorner = async (req: Request, res: Response): Promise<void> => {
  try {
    const kind = parseKind(req.query.kind);

    const items = await prisma.studentCornerItem.findMany({
      where: kind ? { kind } : {},
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
    console.error("Error fetching admin student corner:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student corner." });
  }
};

export const createStudentCornerItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      res.status(401).json({ status: "error", message: "Authentication required." });
      return;
    }

    const studentName = asString(req.body?.studentName);
    const videoUrl = asString(req.body?.videoUrl);
    const kind = parseKind(req.body?.kind);
    const level = asString(req.body?.level);

    if (!studentName || !videoUrl || !kind || !level) {
      res.status(400).json({
        status: "error",
        message: "Student name, level, video, and type are required.",
      });
      return;
    }

    const thumbnailUrl = asString(req.body?.thumbnailUrl) || deriveVideoThumbnail(videoUrl);

    const created = await prisma.studentCornerItem.create({
      data: {
        kind,
        studentName,
        level,
        description: asString(req.body?.description),
        duration: asString(req.body?.duration) || null,
        videoUrl,
        thumbnailUrl,
        sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
        isPublished: asBoolean(req.body?.isPublished, true),
        fileName: asString(req.body?.fileName) || null,
        fileSize: asString(req.body?.fileSize) || null,
        uploadedById: adminId,
      },
    });

    res.status(201).json({ status: "success", data: serializeItem(created) });
  } catch (error) {
    console.error("Error creating student corner item:", error);
    res.status(500).json({ status: "error", message: "Failed to create student corner item." });
  }
};

export const updateStudentCornerItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ status: "error", message: "Student corner item ID is required." });
      return;
    }

    const existing = await prisma.studentCornerItem.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Student corner item not found." });
      return;
    }

    const data: {
      kind?: StudentCornerKind;
      studentName?: string;
      level?: string;
      description?: string;
      duration?: string | null;
      videoUrl?: string;
      thumbnailUrl?: string | null;
      sortOrder?: number;
      isPublished?: boolean;
      fileName?: string | null;
      fileSize?: string | null;
    } = {};

    if (req.body?.studentName !== undefined) {
      const studentName = asString(req.body.studentName);
      if (!studentName) {
        res.status(400).json({ status: "error", message: "Student name cannot be empty." });
        return;
      }
      data.studentName = studentName;
    }

    if (req.body?.level !== undefined) {
      const level = asString(req.body.level);
      if (!level) {
        res.status(400).json({ status: "error", message: "Level cannot be empty." });
        return;
      }
      data.level = level;
    }

    if (req.body?.kind !== undefined) {
      const kind = parseKind(req.body.kind);
      if (!kind) {
        res.status(400).json({ status: "error", message: "Invalid student corner type." });
        return;
      }
      data.kind = kind;
    }

    if (req.body?.description !== undefined) data.description = asString(req.body.description);
    if (req.body?.duration !== undefined) data.duration = asString(req.body.duration) || null;

    if (req.body?.videoUrl !== undefined) {
      const videoUrl = asString(req.body.videoUrl);
      if (!videoUrl) {
        res.status(400).json({ status: "error", message: "Video URL cannot be empty." });
        return;
      }
      data.videoUrl = videoUrl;
    }

    if (req.body?.thumbnailUrl !== undefined) data.thumbnailUrl = asString(req.body.thumbnailUrl) || null;
    if (req.body?.isPublished !== undefined) data.isPublished = asBoolean(req.body.isPublished, existing.isPublished);
    if (req.body?.sortOrder !== undefined && Number.isFinite(Number(req.body.sortOrder))) {
      data.sortOrder = Number(req.body.sortOrder);
    }
    if (req.body?.fileName !== undefined) data.fileName = asString(req.body.fileName) || null;
    if (req.body?.fileSize !== undefined) data.fileSize = asString(req.body.fileSize) || null;

    const nextUrl = data.videoUrl ?? existing.videoUrl;
    if ((data.videoUrl || data.thumbnailUrl === undefined) && !data.thumbnailUrl) {
      const derived = deriveVideoThumbnail(nextUrl);
      if (derived && !existing.thumbnailUrl) data.thumbnailUrl = derived;
    }

    const updated = await prisma.studentCornerItem.update({ where: { id }, data });
    res.status(200).json({ status: "success", data: serializeItem(updated) });
  } catch (error) {
    console.error("Error updating student corner item:", error);
    res.status(500).json({ status: "error", message: "Failed to update student corner item." });
  }
};

export const deleteStudentCornerItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ status: "error", message: "Student corner item ID is required." });
      return;
    }

    const existing = await prisma.studentCornerItem.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Student corner item not found." });
      return;
    }

    await prisma.studentCornerItem.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Student corner item deleted successfully." });
  } catch (error) {
    console.error("Error deleting student corner item:", error);
    res.status(500).json({ status: "error", message: "Failed to delete student corner item." });
  }
};
