import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { ensureLetterheadDefaults } from "../../lib/ensure-letterheads";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function serializeTemplate(item: {
  id: string;
  name: string;
  imageUrl: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeLetterhead(item: {
  id: string;
  title: string;
  contentHtml: string;
  pagesJson?: unknown;
  fontFamily: string;
  isDefault: boolean;
  usageCount: number;
  templateId: string;
  createdAt: Date;
  updatedAt: Date;
  template?: { id: string; name: string; imageUrl: string; isActive: boolean };
}) {
  const pages = normalizePagesJson(item.pagesJson, item.contentHtml);
  return {
    id: item.id,
    title: item.title,
    contentHtml: item.contentHtml,
    pages,
    fontFamily: item.fontFamily,
    isDefault: item.isDefault,
    usageCount: item.usageCount,
    templateId: item.templateId,
    template: item.template
      ? {
          id: item.template.id,
          name: item.template.name,
          imageUrl: item.template.imageUrl,
          isActive: item.template.isActive,
        }
      : undefined,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function normalizePagesJson(pagesJson: unknown, fallbackHtml: string) {
  if (Array.isArray(pagesJson) && pagesJson.length > 0) {
    return pagesJson.map((p: any) => ({
      contentHtml: typeof p?.contentHtml === "string" ? p.contentHtml : "<br>",
    }));
  }
  return [{ contentHtml: fallbackHtml || "<br>" }];
}

function parsePagesPayload(body: any, fallbackHtml = "<br>") {
  if (Array.isArray(body.pages) && body.pages.length > 0) {
    const pages = body.pages.map((p: any) => ({
      contentHtml: asString(p?.contentHtml) || "<br>",
    }));
    const fullHtml = asString(body.contentHtml);
    return { pagesJson: pages, contentHtml: fullHtml || pages[0].contentHtml };
  }
  const html = asString(body.contentHtml) || fallbackHtml;
  return { pagesJson: [{ contentHtml: html }], contentHtml: html };
}

export const getLetterheadTemplates = async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureLetterheadDefaults();
    const items = await prisma.letterheadTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    res.status(200).json({ status: "success", data: items.map(serializeTemplate) });
  } catch (error) {
    console.error("getLetterheadTemplates:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch letterhead templates." });
  }
};

export const createLetterheadTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const name = asString(req.body.name);
    const imageUrl = asString(req.body.imageUrl);

    if (!name || !imageUrl) {
      res.status(400).json({ status: "error", message: "Template name and image URL are required." });
      return;
    }

    const item = await prisma.letterheadTemplate.create({
      data: { name, imageUrl, isActive: true },
    });

    res.status(201).json({ status: "success", data: serializeTemplate(item) });
  } catch (error) {
    console.error("createLetterheadTemplate:", error);
    res.status(500).json({ status: "error", message: "Failed to create letterhead template." });
  }
};

export const updateLetterheadTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id);
    const name = asString(req.body.name);
    const imageUrl = asString(req.body.imageUrl);
    const isActive = req.body.isActive !== undefined ? asBoolean(req.body.isActive) : undefined;

    const existing = await prisma.letterheadTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Template not found." });
      return;
    }

    const item = await prisma.letterheadTemplate.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    res.status(200).json({ status: "success", data: serializeTemplate(item) });
  } catch (error) {
    console.error("updateLetterheadTemplate:", error);
    res.status(500).json({ status: "error", message: "Failed to update letterhead template." });
  }
};

export const deleteLetterheadTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id);
    const inUse = await prisma.letterhead.count({ where: { templateId: id } });
    if (inUse > 0) {
      res.status(400).json({
        status: "error",
        message: "Cannot delete template that is used by existing letterheads.",
      });
      return;
    }

    await prisma.letterheadTemplate.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Template deleted." });
  } catch (error) {
    console.error("deleteLetterheadTemplate:", error);
    res.status(500).json({ status: "error", message: "Failed to delete letterhead template." });
  }
};

export const getLetterheads = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureLetterheadDefaults();

    const search = asString(req.query.search);
    const filter = asString(req.query.filter);
    const sort = asString(req.query.sort) || "newest";

    const where: any = {};
    if (search) {
      where.title = { contains: search, mode: "insensitive" };
    }
    if (filter === "default") {
      where.isDefault = true;
    }

    let orderBy: any = { updatedAt: "desc" };
    if (sort === "oldest") orderBy = { updatedAt: "asc" };
    if (sort === "title") orderBy = { title: "asc" };

    const items = await prisma.letterhead.findMany({
      where,
      include: { template: true },
      orderBy,
    });

    res.status(200).json({
      status: "success",
      data: items.map((item) => serializeLetterhead(item)),
    });
  } catch (error) {
    console.error("getLetterheads:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch letterheads." });
  }
};

export const getLetterheadById = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureLetterheadDefaults();
    const id = asString(req.params.id);

    const item = await prisma.letterhead.findUnique({
      where: { id },
      include: { template: true },
    });

    if (!item) {
      res.status(404).json({ status: "error", message: "Letterhead not found." });
      return;
    }

    res.status(200).json({ status: "success", data: serializeLetterhead(item) });
  } catch (error) {
    console.error("getLetterheadById:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch letterhead." });
  }
};

export const createLetterhead = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureLetterheadDefaults();

    const title = asString(req.body.title) || "Untitled Letterhead";
    const templateId = asString(req.body.templateId);
    const fontFamily = asString(req.body.fontFamily) || "Georgia, serif";
    const isDefault = asBoolean(req.body.isDefault);
    const { pagesJson, contentHtml } = parsePagesPayload(req.body);

    if (!templateId) {
      res.status(400).json({ status: "error", message: "Template is required." });
      return;
    }

    const template = await prisma.letterheadTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      res.status(400).json({ status: "error", message: "Invalid template selected." });
      return;
    }

    if (isDefault) {
      await prisma.letterhead.updateMany({ data: { isDefault: false } });
    }

    const item = await prisma.letterhead.create({
      data: {
        title,
        contentHtml,
        pagesJson,
        templateId,
        fontFamily,
        isDefault,
        createdById: req.user?.id || null,
      },
      include: { template: true },
    });

    res.status(201).json({ status: "success", data: serializeLetterhead(item) });
  } catch (error) {
    console.error("createLetterhead:", error);
    res.status(500).json({ status: "error", message: "Failed to create letterhead." });
  }
};

export const updateLetterhead = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id);
    const existing = await prisma.letterhead.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Letterhead not found." });
      return;
    }

    const title = req.body.title !== undefined ? asString(req.body.title) : undefined;
    const templateId = req.body.templateId !== undefined ? asString(req.body.templateId) : undefined;
    const fontFamily = req.body.fontFamily !== undefined ? asString(req.body.fontFamily) : undefined;
    const isDefault = req.body.isDefault !== undefined ? asBoolean(req.body.isDefault) : undefined;

    let pagesJson: unknown | undefined;
    let contentHtml: string | undefined;
    if (req.body.pages !== undefined || req.body.contentHtml !== undefined) {
      const parsed = parsePagesPayload(req.body, existing.contentHtml);
      pagesJson = parsed.pagesJson;
      contentHtml = parsed.contentHtml;
    }

    if (templateId) {
      const template = await prisma.letterheadTemplate.findUnique({ where: { id: templateId } });
      if (!template) {
        res.status(400).json({ status: "error", message: "Invalid template selected." });
        return;
      }
    }

    if (isDefault) {
      await prisma.letterhead.updateMany({ data: { isDefault: false } });
    }

    const item = await prisma.letterhead.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: title || "Untitled Letterhead" } : {}),
        ...(contentHtml !== undefined ? { contentHtml } : {}),
        ...(pagesJson !== undefined ? { pagesJson } : {}),
        ...(templateId ? { templateId } : {}),
        ...(fontFamily ? { fontFamily } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
      include: { template: true },
    });

    res.status(200).json({ status: "success", data: serializeLetterhead(item) });
  } catch (error) {
    console.error("updateLetterhead:", error);
    res.status(500).json({ status: "error", message: "Failed to update letterhead." });
  }
};

export const deleteLetterhead = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id);
    const existing = await prisma.letterhead.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: "error", message: "Letterhead not found." });
      return;
    }
    await prisma.letterhead.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Letterhead deleted." });
  } catch (error) {
    console.error("deleteLetterhead:", error);
    res.status(500).json({ status: "error", message: "Failed to delete letterhead." });
  }
};

export const trackLetterheadDownload = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id);
    const item = await prisma.letterhead.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
      include: { template: true },
    });
    res.status(200).json({ status: "success", data: serializeLetterhead(item) });
  } catch (error) {
    console.error("trackLetterheadDownload:", error);
    res.status(500).json({ status: "error", message: "Failed to track download." });
  }
};
