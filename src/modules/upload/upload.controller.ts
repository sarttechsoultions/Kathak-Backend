import { Request, Response } from "express";
import { Readable } from "stream";
import axios from "axios";
import cloudinary from "../../config/cloudinary.config";
import { BUNNY_CONFIG } from "../../config/bunny.config";

export const uploadImage = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ status: "error", message: "No image file provided." });
      return;
    }

    const fileBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const result = await cloudinary.uploader.upload(fileBase64, {
      folder: "kathak_courses",
    });

    res.status(200).json({
      status: "success",
      message: "Image uploaded successfully.",
      data: {
        url: result.secure_url,
        public_id: result.public_id,
      },
    });
  } catch (error: any) {
    console.error("Cloudinary Upload Error:", error);
    res.status(500).json({ status: "error", message: error.message || "Failed to upload image." });
  }
};

export const uploadVideoToBunny = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ status: "error", message: "No video file provided." });
      return;
    }

    // Binary Stream Upload (No 413 Payload Too Large error!)
    const cloudStreamUpload = (buffer: Buffer): Promise<any> => {
      return new Promise((resolve, reject) => {
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
        Readable.from(buffer).pipe(stream);
      });
    };

    const cloudResult = await cloudStreamUpload(req.file.buffer);

    res.status(200).json({
      status: "success",
      message: "Video uploaded and ready for instant playback.",
      data: {
        videoId: cloudResult.public_id,
        iframeUrl: cloudResult.secure_url,
        directUrl: cloudResult.secure_url
      }
    });
  } catch (error: any) {
    console.error("Stream Video Upload Error:", error?.message || error);

    // Fallback to Bunny.net Stream
    try {
      const { title } = req.body;
      const videoTitle = title || req.file?.originalname || "Kathak Video";

      const createRes = await axios.post(
        `${BUNNY_CONFIG.streamBaseUrl}/${BUNNY_CONFIG.libraryId}/videos`,
        { title: videoTitle },
        { headers: { AccessKey: BUNNY_CONFIG.apiKey, "Content-Type": "application/json" } }
      );

      const videoId = createRes.data.guid;

      await axios.put(
        `${BUNNY_CONFIG.streamBaseUrl}/${BUNNY_CONFIG.libraryId}/videos/${videoId}`,
        req.file?.buffer,
        {
          headers: { AccessKey: BUNNY_CONFIG.apiKey, "Content-Type": "application/octet-stream" },
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        }
      );

      const iframeUrl = `${BUNNY_CONFIG.iframeBaseUrl}/${BUNNY_CONFIG.libraryId}/${videoId}`;

      res.status(200).json({
        status: "success",
        message: "Video uploaded successfully.",
        data: { videoId, libraryId: BUNNY_CONFIG.libraryId, iframeUrl, directUrl: iframeUrl }
      });
    } catch (bunnyErr: any) {
      res.status(500).json({
        status: "error",
        message: "Failed to upload video file. Please try again or paste a YouTube/Vimeo link."
      });
    }
  }
};
