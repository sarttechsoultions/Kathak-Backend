import { randomUUID } from "crypto";
import { Request, Response } from "express";
import cloudinary from "../../config/cloudinary.config";
import { prisma } from "../../lib/prisma";
import { getStudentBatchMembershipRows, resolveStudentBatchForAssignment } from "../../lib/batchHelpers";
import { TARGET_VIDEO_BYTES, VIDEO_FORMATS, VIDEO_EAGER, UploadError, validateSelection, verifyAsset } from "./direct-video.policy";

// Cloudinary presets do NOT support per-preset size caps. The operator must
// confirm the account-level cap; completion independently checks actual bytes.
async function configuration() {
  const maxBytes = Number(process.env.CLOUDINARY_VIDEO_MAX_BYTES);
  const presetName = process.env.CLOUDINARY_VIDEO_SIGNED_PRESET;
  const config = cloudinary.config();
  if (process.env.CLOUDINARY_VIDEO_ACCOUNT_LIMIT_CONFIRMED !== "true" || !presetName || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > TARGET_VIDEO_BYTES ||
      !config.cloud_name || !config.api_key || !config.api_secret)
    throw new UploadError(503, "Video uploads are awaiting account limit configuration. Please contact the academy.");
  const preset = await cloudinary.api.upload_preset(presetName);
  const options = preset.settings || {};
  const formats = Array.isArray(options.allowed_formats) ? options.allowed_formats : String(options.allowed_formats || "").split(",");
  if (preset.unsigned !== false ||
      !formats.length || formats.some((format: string) => !VIDEO_FORMATS.includes(format)))
    throw new UploadError(503, "Video upload restrictions need administrator verification.");
  return { maxBytes, presetName, config };
}

export async function authorizeStudentTarget(userId: string, purpose: string, relatedId: string | null) {
  if (!["ASSIGNMENT", "PRACTICE"].includes(purpose) || !relatedId)
    throw new UploadError(400, "Choose an assignment or practice task before uploading.");
  const memberships = await getStudentBatchMembershipRows(userId);
  const target = purpose === "ASSIGNMENT"
    ? await prisma.assignment.findUnique({ where: { id: relatedId } })
    : await prisma.videoTask.findUnique({ where: { id: relatedId } });
  const batch = target && resolveStudentBatchForAssignment(target, memberships);
  if (!target || !batch) throw new UploadError(403, "This task is not available for your batch.");
  // Membership and a current enrollment are both required.
  const batchRow = await prisma.batch.findUnique({ where: { id: batch.id }, select: { courseId: true } });
  const enrolled = await prisma.enrollment.findFirst({ where: {
    userId, active: true, ...(batchRow?.courseId ? { courseId: batchRow.courseId } : {}),
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  } });
  if (!enrolled) throw new UploadError(403, "An active course enrollment is required.");
  if ("dueDate" in target) {
    const deadline = new Date(target.dueDate);
    deadline.setHours(23, 59, 59, 999); // Match the existing assignment submission policy.
    if (target.status !== "ACTIVE" || (!target.allowLateSubmissions && new Date() > deadline))
      throw new UploadError(403, "This assignment is closed for submissions.");
  } else if (target.strictDeadline) {
    const date = target.submissionDate.toISOString().slice(0, 10);
    const deadline = new Date(`${date}T${target.cutOffTime || "23:59"}:00+05:30`);
    if (new Date() > deadline) throw new UploadError(403, "The practice submission deadline has passed.");
  }
}

function failure(res: Response, error: unknown) {
  res.status(error instanceof UploadError ? error.status : 502).json({
    status: "error", message: error instanceof UploadError ? error.message : "Video service is temporarily unavailable. Please retry.",
  });
}

export const initDirectVideo = (student: boolean) => async (req: Request, res: Response) => {
  try {
    const { maxBytes, presetName, config } = await configuration();
    const body = req.body || {};
    const selection = validateSelection(body, maxBytes);
    const purpose = student ? body.purpose : "STAFF_MEDIA";
    const relatedId = student && typeof body.relatedId === "string" ? body.relatedId : null;
    if (student) await authorizeStudentTarget(req.user!.id, purpose, relatedId);
    else if (body.purpose && body.purpose !== "STAFF_MEDIA") throw new UploadError(400, "Invalid staff upload purpose.");
    const id = randomUUID();
    const publicId = `kathak_direct/${req.user!.id}/${id}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
      timestamp, public_id: publicId, overwrite: false, upload_preset: presetName,
      allowed_formats: VIDEO_FORMATS.join(","), eager: VIDEO_EAGER, eager_async: true,
      type: "upload",
    };
    // Signature expiry is controlled by Cloudinary (one hour). The application
    // separately expires uncompleted intents after 55 minutes.
    const intent = await prisma.videoUploadIntent.create({ data: {
      id, userId: req.user!.id, purpose, relatedId, publicId, ...selection,
      expiresAt: new Date(Date.now() + 55 * 60 * 1000),
    } });
    res.status(201).json({ status: "success", data: {
      intentId: id, expiresAt: intent.expiresAt, maxBytes, chunkBytes: 10 * 1024 ** 2,
      uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloud_name}/video/upload`,
      params: { ...params, api_key: config.api_key, signature: cloudinary.utils.api_sign_request(params, config.api_secret!) },
    } });
  } catch (error) { failure(res, error); }
};

function payload(intent: { id: string; status: string; processingStatus: string; publicId: string; playbackUrl: string | null }) {
  return { intentId: intent.id, status: intent.status, processingStatus: intent.processingStatus,
    ...(intent.status === "READY" ? { url: intent.playbackUrl, fileUrl: intent.playbackUrl, directUrl: intent.playbackUrl,
      iframeUrl: intent.playbackUrl, videoId: intent.publicId, public_id: intent.publicId } : {}),
  };
}

export async function completeDirectVideo(req: Request, res: Response) {
  try {
    if (Object.keys(req.body || {}).length) throw new UploadError(400, "Completion accepts no asset parameters.");
    let intent = await prisma.videoUploadIntent.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
    if (!intent) throw new UploadError(404, "Upload not found.");
    if (["FAILED", "CANCELLED"].includes(intent.status)) throw new UploadError(409, "Upload is no longer available. Select the file again.");
    if (req.user!.role === "STUDENT") await authorizeStudentTarget(req.user!.id, intent.purpose, intent.relatedId);
    if (intent.status === "READY") { res.json({ status: "success", data: payload(intent) }); return; }
    if (intent.status === "PROCESSING" && intent.verifiedAt && Date.now() - intent.verifiedAt.getTime() < 60000) {
      res.json({ status: "success", data: payload(intent) }); return;
    }
    if (intent.status === "UPLOADING" && intent.expiresAt < new Date()) throw new UploadError(410, "Upload authorization expired. Select the file again.");
    const asset = await cloudinary.api.resource(intent.publicId, {
  resource_type: "video",
  type: "upload",
  media_metadata: true
});
    try { verifyAsset(asset, intent); } catch (error) {
      await prisma.videoUploadIntent.updateMany({ where: { id: intent.id, status: "UPLOADING" }, data: { status: "FAILED", processingStatus: "FAILED" } });
      throw error;
    }
    const derivatives = Array.isArray(asset.derived) ? asset.derived : [];
    const canonical = (value: string) => value.split("/").map(part => part.split(",").sort().join(",")).join("/");
    const derivative = derivatives.find((item: any) => canonical(String(item.transformation)) === canonical(VIDEO_EAGER));
    const failed = derivative?.status === "failed" || derivative?.status === "error" || asset.status === "error" ||
      (intent.completedAt !== null && Date.now() - intent.completedAt.getTime() > 24 * 60 * 60 * 1000);
    const ready = derivative && !failed && (!derivative.status || derivative.status === "complete") && derivative.secure_url;
    const playbackUrl = cloudinary.url(intent.publicId, { resource_type: "video", type: "upload", secure: true,
      version: asset.version, transformation: [{ raw_transformation: VIDEO_EAGER }], format: "mp4" });
    // Compare-and-set prevents stale concurrent pollers overwriting a terminal status.
    await prisma.videoUploadIntent.updateMany({ where: { id: intent.id, userId: req.user!.id, status: { in: ["UPLOADING", "UPLOADED", "PROCESSING"] } }, data: {
      assetId: asset.asset_id, format: asset.format, duration: asset.duration,
      status: failed ? "FAILED" : ready ? "READY" : "PROCESSING",
      processingStatus: failed ? "FAILED" : ready ? "READY" : "PROCESSING",
      playbackUrl, completedAt: intent.completedAt || new Date(), verifiedAt: new Date(),
    } });
    intent = (await prisma.videoUploadIntent.findUniqueOrThrow({ where: { id: intent.id } }));
    res.json({ status: "success", data: payload(intent) });
  } catch (error) { failure(res, error); }
}

export async function cancelDirectVideo(req: Request, res: Response) {
  try {
    await prisma.videoUploadIntent.updateMany({ where: { id: String(req.params.id), userId: req.user!.id,
      status: { in: ["UPLOADING", "UPLOADED", "PROCESSING"] } }, data: { status: "CANCELLED" } });
    // Do not delete immediately: an issued signature can still create the asset.
    res.json({ status: "success" });
  } catch (error) { failure(res, error); }
}

/** Preserve historical URLs while enforcing provenance for the new namespace. */
export async function validateLinkedDirectVideos(files: Array<{ url: string }>, userId: string, purpose: string, relatedId: string) {
  for (const file of files) {
    const intent = await prisma.videoUploadIntent.findFirst({ where: {
      playbackUrl: file.url, userId, purpose, relatedId, status: "READY",
    } });
    if (!intent) throw new UploadError(403, "This video is not a verified upload for your submission.");
  }
}
