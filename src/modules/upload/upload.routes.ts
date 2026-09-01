import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { Permission, Role } from "@prisma/client";
import { uploadImage, uploadVideoToBunny } from "./upload.controller";
import { authenticate, requireAnyPermission, requireRole } from "../../middleware/auth.middleware";
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

// Protected uploads — admin permissions or teacher/admin role for assignment media
const protectedUpload = (req: Request, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  if (role === Role.TEACHER || role === Role.ADMIN) {
    next();
    return;
  }
  return requireAnyPermission(
    Permission.MANAGE_RECORDED_CLASSES,
    Permission.UPLOAD_RECORDED_CLASS,
    Permission.MANAGE_COURSES,
    Permission.MANAGE_ASSIGNMENTS
  )(req, res, next);
};

router.post("/image", authenticate, protectedUpload, handleMulterUpload, uploadImage);
router.post("/video", authenticate, protectedUpload, handleMulterUpload, uploadVideoToBunny);

// Student assignment submissions
router.post("/student/image", authenticate, requireRole(Role.STUDENT), handleMulterUpload, uploadImage);
router.post("/student/video", authenticate, requireRole(Role.STUDENT), handleMulterUpload, uploadVideoToBunny);

export default router;