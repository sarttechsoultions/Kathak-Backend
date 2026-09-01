import { Request, Response } from "express";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import axios from "axios";
import cloudinary from "../../config/cloudinary.config";
import { BUNNY_CONFIG } from "../../config/bunny.config";
import { env } from "../../config/env";

function saveFileLocally(buffer: Buffer, originalName: string, subfolder: string = "media"): string {
  const uploadsDir = path.join(process.cwd(), "uploads", subfolder);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const ext = path.extname(originalName) || (subfolder === "images" ? ".png" : ".mp4");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filePath = path.join(uploadsDir, filename);

  fs.writeFileSync(filePath, buffer);
  return `${env.publicUrl}/uploads/${subfolder}/${filename}`;
}

export const uploadImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file || (req.files && Array.isArray(req.files) ? req.files[0] : null);
    if (!file) {
      res.status(400).json({ status: "error", message: "No image file provided." });
      return;
    }

    try {
      const fileBase64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
      const result = await cloudinary.uploader.upload(fileBase64, {
        folder: "kathak_courses",
        resource_type: isPdf ? "image" : "auto",
        format: isPdf ? "pdf" : undefined,
      });

      if (result && result.secure_url) {
        res.status(200).json({
          status: "success",
          message: "Image uploaded successfully.",
          data: {
            url: result.secure_url,
            fileUrl: result.secure_url,
            public_id: result.public_id,
          },
        });
        return;
      }
    } catch (cloudErr: any) {
      console.error("Cloudinary image upload failed:", cloudErr?.message || cloudErr);

      // In production, do NOT silently fall back to local disk — most prod
      // hosts have ephemeral/multi-instance filesystems, so the file (and
      // its URL) may not survive a restart or be visible to other instances.
      // Surface the failure so the caller can retry instead of getting a
      // URL that quietly breaks later.
      if (env.isProduction) {
        res.status(502).json({ status: "error", message: "Image upload service is temporarily unavailable. Please try again." });
        return;
      }
    }

    // Local disk fallback — development only.
    const localUrl = saveFileLocally(file.buffer, file.originalname, "images");
    res.status(200).json({
      status: "success",
      message: "Image uploaded successfully to local storage (dev fallback).",
      data: {
        url: localUrl,
        fileUrl: localUrl,
        public_id: `local-${Date.now()}`,
      },
    });
  } catch (error: any) {
    console.error("Image Upload Error:", error?.message || error);
    res.status(500).json({ status: "error", message: "Failed to upload image." });
  }
};

/** Creates a video entry in Bunny Stream and uploads the binary. Two calls, per Bunny's API. */
async function uploadToBunnyStream(buffer: Buffer, title: string): Promise<{ videoId: string; iframeUrl: string; directUrl: string; thumbnailUrl: string }> {
  const headers = { AccessKey: BUNNY_CONFIG.apiKey, "Content-Type": "application/json" };

  const createRes = await axios.post(
    `${BUNNY_CONFIG.streamBaseUrl}/${BUNNY_CONFIG.libraryId}/videos`,
    { title },
    { headers, timeout: 15000 }
  );
  const videoId = createRes.data?.guid;
  if (!videoId) throw new Error("Bunny Stream did not return a video id.");

  await axios.put(
    `${BUNNY_CONFIG.streamBaseUrl}/${BUNNY_CONFIG.libraryId}/videos/${videoId}`,
    buffer,
    {
      headers: { AccessKey: BUNNY_CONFIG.apiKey, "Content-Type": "application/octet-stream" },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 5 * 60 * 1000,
    }
  );

  const thumbnailUrl = `https://${BUNNY_CONFIG.pullZoneHostname}/${videoId}/thumbnail.jpg`;

  return {
    videoId,
    iframeUrl: `${BUNNY_CONFIG.iframeBaseUrl}/${BUNNY_CONFIG.libraryId}/${videoId}`,
    directUrl: `${BUNNY_CONFIG.iframeBaseUrl}/${BUNNY_CONFIG.libraryId}/${videoId}`,
    thumbnailUrl,
  };
}
export const uploadVideoToBunny = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file || (req.files && Array.isArray(req.files) ? req.files[0] : null);
    if (!file) {
      res.status(400).json({ status: "error", message: "No video file provided." });
      return;
    }

    // Removed Bunny.net upload logic to provide instant playback using Cloudinary

    // Secondary path: Cloudinary video upload. No artificial timeout — a real
    // upload of a multi-hundred-MB file legitimately takes longer than a
    // couple of seconds, so a short timeout here just meant this path never
    // actually succeeded and every video silently landed on local disk.
    try {
      const cloudResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "video", folder: "kathak_videos" },
          (error, result) => (result ? resolve(result) : reject(error))
        );
        Readable.from(file.buffer).pipe(stream);
      }) as any;

      if (cloudResult?.secure_url) {
        const thumbnailUrl = cloudinary.url(cloudResult.public_id, {
          resource_type: "video",
          format: "jpg",
          transformation: [{ width: 640, height: 360, crop: "fill", quality: "auto" }],
        });

        res.status(200).json({
          status: "success",
          message: "Video uploaded successfully.",
          data: {
            videoId: cloudResult.public_id,
            iframeUrl: cloudResult.secure_url,
            directUrl: cloudResult.secure_url,
            url: cloudResult.secure_url,
            fileUrl: cloudResult.secure_url,
            thumbnailUrl,
          },
        });
        return;
      }
    } catch (cloudErr: any) {
      console.error("Cloudinary video upload failed:", cloudErr?.message || cloudErr);
    }

    // In production, don't fall back to local disk for the same reason as
    // uploadImage above — surface the failure instead of a URL that breaks later.
    if (env.isProduction) {
      res.status(502).json({ status: "error", message: "Video upload service is temporarily unavailable. Please try again." });
      return;
    }

    // Local disk fallback — development only.
    const localUrl = saveFileLocally(file.buffer, file.originalname, "videos");
    res.status(200).json({
      status: "success",
      message: "Video saved successfully (dev fallback).",
      data: {
        videoId: `local-${Date.now()}`,
        iframeUrl: localUrl,
        directUrl: localUrl,
        url: localUrl,
        fileUrl: localUrl,
      },
    });
  } catch (error: any) {
    console.error("Video Upload Error:", error?.message || error);
    res.status(500).json({ status: "error", message: "Failed to process video upload." });
  }
};
