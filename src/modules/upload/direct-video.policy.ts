export const TARGET_VIDEO_BYTES = 2 * 1024 ** 3;
export const VIDEO_FORMATS = ["mp4", "mov", "webm", "m4v"];
export const VIDEO_EAGER = "vc_h264,ac_aac/f_mp4";

export class UploadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validateSelection(body: Record<string, unknown>, maxBytes: number) {
  const permitted = ["size", "mimeType", "name", "purpose", "relatedId"];
  if (Object.keys(body).some(key => !permitted.includes(key))) throw new UploadError(400, "Unexpected upload parameters.");
  const { size, mimeType, name } = body;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > maxBytes)
    throw new UploadError(400, `Video must be between 1 byte and ${Math.floor(maxBytes / 1024 ** 2)} MB (account limit).`);
  if (typeof name !== "string" || name.length > 255 || !VIDEO_FORMATS.includes(name.split(".").pop()?.toLowerCase() || "") ||
      typeof mimeType !== "string" || !["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"].includes(mimeType))
    throw new UploadError(400, "Choose an MP4, MOV, M4V or WEBM video.");
  return { size, mimeType };
}

export function verifyAsset(asset: Record<string, any>, intent: { publicId: string; size: number; createdAt: Date }) {
  if (asset.public_id !== intent.publicId || asset.resource_type !== "video" || asset.type !== "upload" ||
      !asset.asset_id || !VIDEO_FORMATS.includes(asset.format) || !Number.isSafeInteger(asset.bytes) ||
      asset.bytes !== intent.size || !Number.isFinite(asset.duration) || asset.duration <= 0 ||
      !Number.isFinite(Date.parse(asset.created_at)) || Date.parse(asset.created_at) < intent.createdAt.getTime() - 5000)
    throw new UploadError(422, "Uploaded video could not be verified. Select the original file and retry.");
}
