import { Request, Response } from "express";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import axios from "axios";
import sharp from "sharp";
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
    const filesToUpload = Array.isArray(req.files) && req.files.length > 0 ? (req.files as Express.Multer.File[]) : (req.file ? [req.file] : []);
    if (filesToUpload.length === 0) {
      res.status(400).json({ status: "error", message: "No image file provided." });
      return;
    }

    try {
      const uploadResults = await Promise.all(
        filesToUpload.map(async (file) => {
          const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
          const isImage = file.mimetype.startsWith("image/");
          
          let uploadBuffer = file.buffer;
          if (isImage && !isPdf) {
            // Compress the image before uploading to stay under Cloudinary's 10MB free tier limit
            uploadBuffer = await sharp(file.buffer)
              .resize(1920, 1920, { fit: "inside", withoutEnlargement: true }) // Max HD size
              .jpeg({ quality: 80 }) // Convert to high-quality JPEG to guarantee size reduction
              .toBuffer();
          }

          return new Promise<any>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: "kathak_courses",
                resource_type: isPdf ? "image" : "auto",
                format: isPdf ? "pdf" : undefined,
              },
              (error, result) => {
                if (error) {
                  reject(error);
                } else if (result && result.secure_url) {
                  resolve({
                    url: result.secure_url,
                    fileUrl: result.secure_url,
                    public_id: result.public_id,
                    name: file.originalname,
                    type: file.mimetype
                  });
                } else {
                  reject(new Error("No secure_url returned"));
                }
              }
            );
            stream.end(uploadBuffer);
          });
        })
      );

      const firstResult = uploadResults[0];
      res.status(200).json({
        status: "success",
        message: "Image(s) uploaded successfully.",
        data: {
          url: firstResult.url,
          fileUrl: firstResult.fileUrl,
          public_id: firstResult.public_id,
          files: uploadResults,
        },
      });
      return;
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
    const fallbackResults = filesToUpload.map((file) => {
      const localUrl = saveFileLocally(file.buffer, file.originalname, "images");
      return {
        url: localUrl,
        fileUrl: localUrl,
        public_id: `local-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        name: file.originalname,
        type: file.mimetype
      };
    });

    const firstFallback = fallbackResults[0];
    res.status(200).json({
      status: "success",
      message: "Image(s) uploaded successfully to local storage (dev fallback).",
      data: {
        url: firstFallback.url,
        fileUrl: firstFallback.fileUrl,
        public_id: firstFallback.public_id,
        files: fallbackResults,
      },
    });
  } catch (error: any) {
    console.error("Image Upload Error:", error?.message || error);
    res.status(500).json({ status: "error", message: "Failed to upload image." });
  }
};

/** Converts a PDF/image to a high-resolution A4 background for editable PDF export. */
export const uploadLetterheadTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file || (req.files && Array.isArray(req.files) ? req.files[0] : null);
    if (!file) {
      res.status(400).json({ status: "error", message: "No letterhead template file provided." });
      return;
    }

    const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");

    // The installed Sharp build does not include PDF decoding. Let Cloudinary
    // rasterize page one of an A4 PDF instead, then save its PNG delivery URL
    // as the editable letterhead background.
    if (isPdf) {
      try {
        const pdfUpload = await new Promise<any>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "kathak_letterheads", resource_type: "image", format: "pdf" },
            (error, result) => (result ? resolve(result) : reject(error))
          );
          stream.end(file.buffer);
        });

        if (pdfUpload?.public_id) {
          const previewUrl = cloudinary.url(pdfUpload.public_id, {
            resource_type: "image",
            format: "png",
            transformation: [{ page: 1, width: 2480, height: 3508, crop: "pad", background: "white" }],
          });
          res.status(200).json({
            status: "success",
            message: "A4 PDF template uploaded and prepared for print.",
            data: {
              url: previewUrl,
              fileUrl: previewUrl,
              sourcePdfUrl: pdfUpload.secure_url,
              public_id: pdfUpload.public_id,
            },
          });
          return;
        }
      } catch (error: any) {
        console.error("Letterhead PDF upload failed:", error?.message || error);
        res.status(502).json({
          status: "error",
          message: "The PDF template could not be processed. Please try again or upload a PNG/JPG template.",
        });
        return;
      }
    }

    let printBackground: Buffer;
    try {
      printBackground = await sharp(file.buffer)
        .rotate()
        .resize({ width: 2480, height: 3508, fit: "contain", background: "#ffffff", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch (error) {
      console.error("Letterhead template conversion failed:", error);
      res.status(400).json({ status: "error", message: "We could not read this template. Please upload a standard single-page A4 PDF or image." });
      return;
    }

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "kathak_letterheads", resource_type: "image", format: "png" },
          (error, uploadResult) => (uploadResult ? resolve(uploadResult) : reject(error))
        );
        stream.end(printBackground);
      });
      if (result?.secure_url) {
        res.status(200).json({ status: "success", message: "Print-ready letterhead template uploaded successfully.", data: { url: result.secure_url, fileUrl: result.secure_url, public_id: result.public_id } });
        return;
      }
    } catch (cloudErr: any) {
      console.error("Letterhead template upload failed:", cloudErr?.message || cloudErr);
      if (env.isProduction) {
        res.status(502).json({ status: "error", message: "Template upload service is temporarily unavailable. Please try again." });
        return;
      }
    }

    const localUrl = saveFileLocally(printBackground, `${path.parse(file.originalname).name}.png`, "letterheads");
    res.status(200).json({ status: "success", message: "Print-ready letterhead template saved locally.", data: { url: localUrl, fileUrl: localUrl, public_id: `local-${Date.now()}` } });
  } catch (error: any) {
    console.error("Letterhead Template Upload Error:", error?.message || error);
    res.status(500).json({ status: "error", message: "Failed to upload letterhead template." });
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
    const filesToUpload = Array.isArray(req.files) && req.files.length > 0 ? (req.files as Express.Multer.File[]) : (req.file ? [req.file] : []);
    if (filesToUpload.length === 0) {
      res.status(400).json({ status: "error", message: "No video file provided." });
      return;
    }

    // Removed Bunny.net upload logic to provide instant playback using Cloudinary

    // Secondary path: Cloudinary video upload. No artificial timeout — a real
    // upload of a multi-hundred-MB file legitimately takes longer than a
    // couple of seconds, so a short timeout here just meant this path never
    // actually succeeded and every video silently landed on local disk.
    try {
      const uploadResults = await Promise.all(
        filesToUpload.map(async (file) => {
          return new Promise<any>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                resource_type: "video",
                folder: "kathak_videos",
                // Convert iPhone/Android HEVC MOV files into a universally
                // playable MP4 before giving its URL to the browser.
                eager: [{ format: "mp4", transformation: [{ video_codec: "h264", audio_codec: "aac" }] }],
                eager_async: false,
              },
              (error, result) => {
                if (error) {
                  reject(error);
                } else if (result && result.secure_url) {
                  // Deliver an H.264/AAC MP4 variant. Phones frequently record HEVC
                  // videos, which may upload successfully but render as 0:00/black in
                  // Chromium on another device without this browser-safe transcode.
                  const playableUrl = result.eager?.[0]?.secure_url || cloudinary.url(result.public_id, {
                    resource_type: "video",
                    format: "mp4",
                    transformation: [{ video_codec: "h264", audio_codec: "aac" }],
                  });
                  const thumbnailUrl = cloudinary.url(result.public_id, {
                    resource_type: "video",
                    format: "jpg",
                    transformation: [{ width: 640, height: 360, crop: "fill", quality: "auto" }],
                  });

                  resolve({
                    videoId: result.public_id,
                    iframeUrl: playableUrl,
                    directUrl: playableUrl,
                    url: playableUrl,
                    fileUrl: playableUrl,
                    thumbnailUrl,
                    name: file.originalname,
                    type: file.mimetype
                  });
                } else {
                  reject(new Error("No secure_url returned"));
                }
              }
            );
            stream.end(file.buffer);
          });
        })
      );

      const firstResult = uploadResults[0];
      res.status(200).json({
        status: "success",
        message: "Video(s) uploaded successfully.",
        data: {
          videoId: firstResult.videoId,
          iframeUrl: firstResult.iframeUrl,
          directUrl: firstResult.directUrl,
          url: firstResult.url,
          fileUrl: firstResult.fileUrl,
          thumbnailUrl: firstResult.thumbnailUrl,
          files: uploadResults,
        },
      });
      return;
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
    const fallbackResults = filesToUpload.map((file) => {
      const localUrl = saveFileLocally(file.buffer, file.originalname, "videos");
      return {
        videoId: `local-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        iframeUrl: localUrl,
        directUrl: localUrl,
        url: localUrl,
        fileUrl: localUrl,
        name: file.originalname,
        type: file.mimetype
      };
    });

    const firstFallback = fallbackResults[0];
    res.status(200).json({
      status: "success",
      message: "Video(s) saved successfully (dev fallback).",
      data: {
        videoId: firstFallback.videoId,
        iframeUrl: firstFallback.iframeUrl,
        directUrl: firstFallback.directUrl,
        url: firstFallback.url,
        fileUrl: firstFallback.fileUrl,
        files: fallbackResults,
      },
    });
  } catch (error: any) {
    console.error("Video Upload Error:", error?.message || error);
    res.status(500).json({ status: "error", message: "Failed to process video upload." });
  }
};
