import { Request, Response } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { env } from "../../config/env";
import { resolveCloudinaryDownloadCandidates } from "../../lib/cloudinaryUrl";

function isAllowedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("res.cloudinary.com")) return true;
    if (parsed.hostname.includes("api.cloudinary.com")) return true;

    const apiOrigin = env.publicUrl.replace(/\/$/, "");
    if (url.startsWith(apiOrigin) && parsed.pathname.includes("/uploads/")) return true;
    if (parsed.pathname.startsWith("/uploads/")) return true;

    return false;
  } catch {
    return false;
  }
}

function resolveLocalUploadPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    const uploadsIndex = parsed.pathname.indexOf("/uploads/");
    if (uploadsIndex === -1) return null;
    const relative = parsed.pathname.slice(uploadsIndex + "/uploads/".length);
    if (!relative || relative.includes("..")) return null;
    return path.join(process.cwd(), "uploads", relative);
  } catch {
    if (url.includes("/uploads/")) {
      const relative = url.split("/uploads/")[1]?.split("?")[0];
      if (!relative || relative.includes("..")) return null;
      return path.join(process.cwd(), "uploads", relative);
    }
    return null;
  }
}

async function streamRemotePdf(fetchUrl: string, res: Response): Promise<void> {
  const response = await axios.get(fetchUrl, {
    responseType: "stream",
    timeout: 45000,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const rawContentType = response.headers["content-type"];
  const contentType =
    typeof rawContentType === "string"
      ? rawContentType
      : Array.isArray(rawContentType)
        ? rawContentType[0] || "application/pdf"
        : "application/pdf";
  res.setHeader("Content-Type", contentType.includes("pdf") ? contentType : "application/pdf");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "private, max-age=300");

  await new Promise<void>((resolve, reject) => {
    response.data.on("error", reject);
    res.on("error", reject);
    res.on("finish", resolve);
    response.data.pipe(res);
  });
}

export const previewMediaResource = async (req: Request, res: Response): Promise<void> => {
  try {
    const sourceUrl = String(req.query.url || "").trim();
    if (!sourceUrl) {
      res.status(400).json({ status: "error", message: "Media URL is required." });
      return;
    }

    if (!isAllowedMediaUrl(sourceUrl)) {
      res.status(403).json({ status: "error", message: "Media URL is not allowed." });
      return;
    }

    const localPath = resolveLocalUploadPath(sourceUrl);
    if (localPath && fs.existsSync(localPath)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
      fs.createReadStream(localPath).pipe(res);
      return;
    }

    const candidates = sourceUrl.includes("res.cloudinary.com")
      ? await resolveCloudinaryDownloadCandidates(sourceUrl)
      : [sourceUrl];

    for (const candidate of candidates) {
      if (!isAllowedMediaUrl(candidate)) continue;
      try {
        await streamRemotePdf(candidate, res);
        return;
      } catch (error) {
        if (res.headersSent) return;
        console.warn("Media preview candidate failed:", candidate, error instanceof Error ? error.message : error);
      }
    }

    res.status(404).json({ status: "error", message: "Unable to load media preview." });
  } catch (error) {
    console.error("Preview Media Resource Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ status: "error", message: "Failed to load media preview." });
    }
  }
};
