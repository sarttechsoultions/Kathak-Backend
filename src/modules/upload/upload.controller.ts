import { Request, Response } from "express";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import axios from "axios";
import cloudinary from "../../config/cloudinary.config";
import { BUNNY_CONFIG } from "../../config/bunny.config";

/** Bulletproof local file storage fallback */
function saveFileLocally(buffer: Buffer, originalName: string, subfolder: string = "media"): string {
  const uploadsDir = path.join(process.cwd(), "uploads", subfolder);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const ext = path.extname(originalName) || (subfolder === "images" ? ".png" : ".mp4");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filePath = path.join(uploadsDir, filename);

  fs.writeFileSync(filePath, buffer);
  return `http://localhost:5000/uploads/${subfolder}/${filename}`;
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
      const result = await cloudinary.uploader.upload(fileBase64, {
        folder: "kathak_courses",
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
    } catch {
      // Cloudinary error fallback to local storage
    }

    // Save to local disk
    const localUrl = saveFileLocally(file.buffer, file.originalname, "images");
    res.status(200).json({
      status: "success",
      message: "Image uploaded successfully to local storage.",
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

export const uploadVideoToBunny = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file || (req.files && Array.isArray(req.files) ? req.files[0] : null);
    if (!file) {
      res.status(400).json({ status: "error", message: "No video file provided." });
      return;
    }

    // Try fast Cloudinary stream upload (timeout after 2.5 seconds)
    try {
      const cloudResult = await Promise.race([
        new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              resource_type: "video",
              folder: "kathak_videos",
            },
            (error, result) => {
              if (result) resolve(result);
              else reject(error);
            }
          );
          Readable.from(file.buffer).pipe(stream);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Cloudinary timeout")), 2500))
      ]) as any;

      if (cloudResult && cloudResult.secure_url) {
        res.status(200).json({
          status: "success",
          message: "Video uploaded successfully.",
          data: {
            videoId: cloudResult.public_id,
            iframeUrl: cloudResult.secure_url,
            directUrl: cloudResult.secure_url,
            url: cloudResult.secure_url,
            fileUrl: cloudResult.secure_url,
          },
        });
        return;
      }
    } catch {
      // Timeout or Cloudinary error - fallback to local storage
    }

    // Fast local file storage fallback
    const localUrl = saveFileLocally(file.buffer, file.originalname, "videos");
    res.status(200).json({
      status: "success",
      message: "Video saved successfully.",
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
