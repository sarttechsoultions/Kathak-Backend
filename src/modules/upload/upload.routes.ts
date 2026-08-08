import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { uploadImage, uploadVideoToBunny } from "./upload.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { publicUploadRateLimiter } from "../../middleware/rateLimit.middleware";

const storage = multer.memoryStorage();

// Full 500MB allowance — only for authenticated video/image uploads.
const uploadAnyMulter = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

// A profile photo never needs to be more than a few MB. The public route
// gets its own, much smaller cap so it can't be used to push huge payloads
// through an unauthenticated endpoint.
const PUBLIC_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const uploadPublicImageMulter = multer({
  storage,
  limits: { fileSize: PUBLIC_IMAGE_MAX_BYTES },
});

const makeMulterHandler = (instance: multer.Multer) => (req: Request, res: Response, next: NextFunction) => {
  instance.any()(req, res, (err) => {
    if (err) {
      res.status(400).json({ status: "error", message: err.message || "File upload parse error." });
      return;
    }
    const files = req.files as Express.Multer.File[];
    if (files && Array.isArray(files) && files.length > 0) {
      req.file = files[0];
    }
    next();
  });
};

const handleMulterUpload = makeMulterHandler(uploadAnyMulter);
const handlePublicImageUpload = makeMulterHandler(uploadPublicImageMulter);

const router = Router();

// PUBLIC enroll profile photo (no auth) — tighter size cap + dedicated rate limit.
router.post("/image/public", publicUploadRateLimiter, handlePublicImageUpload, uploadImage);

// Protected uploads
router.post("/image", authenticate, handleMulterUpload, uploadImage);
router.post("/video", authenticate, handleMulterUpload, uploadVideoToBunny);

export default router;