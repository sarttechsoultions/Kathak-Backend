import { NextFunction, Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { authorizeStudentTarget, validateLinkedDirectVideos } from "./direct-video.controller";
import { UploadError } from "./direct-video.policy";
import { authenticate } from "../../middleware/auth.middleware";

// Opt in after authentication on mutation routers. Only the new namespace is
// checked so historical/external media links keep their existing behavior.
export async function verifyDirectVideoLinks(req: Request, res: Response, next: NextFunction) {
  try {
    if (!["POST", "PUT", "PATCH"].includes(req.method)) { next(); return; }
    const urls = new Set<string>();
    function visit(value: unknown, depth = 0) {
      if (depth > 15) return;
      if (typeof value === "string") {
        let decoded = value;
        try { decoded = decodeURIComponent(decodeURIComponent(value)); } catch { /* Ordinary text may contain percent signs. */ }
        // Provider IDs also contain the namespace; only playback URLs are links.
        const candidate = value.includes("|https://") ? value.slice(value.lastIndexOf("|https://") + 1) : value;
        if (/^https?:\/\//i.test(candidate) && decoded.includes("kathak_direct")) urls.add(candidate);
      }
      else if (Array.isArray(value)) value.forEach(item => visit(item, depth + 1));
      else if (value && typeof value === "object") Object.values(value).forEach(item => visit(item, depth + 1));
    }
    visit(req.body);
    if (!urls.size) { next(); return; }
    if (!req.user) {
      await authenticate(req, res, () => { void verifyDirectVideoLinks(req, res, next); });
      return;
    }
    if (req.user.role === "STUDENT") {
      const purpose = req.originalUrl.includes("/video/student/submit") ? "PRACTICE" : "ASSIGNMENT";
      const relatedId = purpose === "PRACTICE" ? req.body.taskId : req.body.assignmentId;
      if (typeof relatedId !== "string") throw new UploadError(400, "An assigned task is required.");
      await authorizeStudentTarget(req.user.id, purpose, relatedId);
      await validateLinkedDirectVideos([...urls].map(url => ({ url })), req.user.id, purpose, relatedId);
    } else {
      for (const url of urls) {
        const asset = await prisma.videoUploadIntent.findFirst({ where: { playbackUrl: url, purpose: "STAFF_MEDIA", status: "READY" } });
        if (!asset) throw new UploadError(400, "Save a verified, ready video URL.");
      }
    }
    next();
  } catch (error) {
    res.status(error instanceof UploadError ? error.status : 503).json({ status: "error",
      message: error instanceof UploadError ? error.message : "Could not verify the video. Please retry." });
  }
}
