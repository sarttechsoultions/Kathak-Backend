import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { LEAD_POPUP_ID, ensureLeadPopup } from "../../lib/lead-popup";

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

function asDelaySeconds(value: unknown, fallback: number): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(3600, Math.max(0, Math.round(raw)));
}

function serializePopup(item: {
  id: string;
  isEnabled: boolean;
  delaySeconds: number;
  title: string;
  subtitle: string;
  imageUrl: string;
  imageAlt: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    isEnabled: item.isEnabled,
    delaySeconds: item.delaySeconds,
    title: item.title,
    subtitle: item.subtitle,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export const getPublicPopup = async (_req: Request, res: Response): Promise<void> => {
  try {
    const item = await ensureLeadPopup();
    res.status(200).json({ status: "success", data: serializePopup(item) });
  } catch (error) {
    console.error("Error fetching public popup:", error);
    res.status(500).json({ status: "error", message: "Failed to load popup." });
  }
};

export const getAdminPopup = async (_req: Request, res: Response): Promise<void> => {
  try {
    const item = await ensureLeadPopup();
    res.status(200).json({ status: "success", data: serializePopup(item) });
  } catch (error) {
    console.error("Error fetching admin popup:", error);
    res.status(500).json({ status: "error", message: "Failed to load popup settings." });
  }
};

export const updateAdminPopup = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await ensureLeadPopup();

    const title = req.body?.title !== undefined ? asString(req.body.title) : existing.title;
    if (!title) {
      res.status(400).json({ status: "error", message: "Title cannot be empty." });
      return;
    }

    const imageUrl = req.body?.imageUrl !== undefined ? asString(req.body.imageUrl) : existing.imageUrl;
    if (!imageUrl) {
      res.status(400).json({ status: "error", message: "Popup image is required." });
      return;
    }

    const updated = await prisma.leadPopup.update({
      where: { id: LEAD_POPUP_ID },
      data: {
        isEnabled: req.body?.isEnabled !== undefined ? asBoolean(req.body.isEnabled, existing.isEnabled) : existing.isEnabled,
        delaySeconds:
          req.body?.delaySeconds !== undefined
            ? asDelaySeconds(req.body.delaySeconds, existing.delaySeconds)
            : existing.delaySeconds,
        title,
        subtitle: req.body?.subtitle !== undefined ? asString(req.body.subtitle) : existing.subtitle,
        imageUrl,
        imageAlt: req.body?.imageAlt !== undefined ? asString(req.body.imageAlt) || title : existing.imageAlt,
        updatedById: req.user?.id || existing.updatedById,
      },
    });

    res.status(200).json({ status: "success", data: serializePopup(updated) });
  } catch (error) {
    console.error("Error updating popup:", error);
    res.status(500).json({ status: "error", message: "Failed to update popup settings." });
  }
};
