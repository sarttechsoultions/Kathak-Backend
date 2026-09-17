import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { Permission, Role } from "@prisma/client";
import { uploadImage, uploadLetterheadTemplate, uploadVideoToBunny } from "./upload.controller";
import { authenticate, requireAnyPermission, requireRole } from "../../middleware/auth.middleware";
import { publicUploadRateLimiter } from "../../middleware/rateLimit.middleware";

const storage = multer.memoryStorage();

// Full 500MB allowance — only for authenticated video/image uploads.
const uploadAnyMulter = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

// A profile photo never needs to be more than a few MB. The public route
// gets its own, much smaller cap so it can't be used to push huge payloads
// through an unauthenticated endpoint.
const PUBLIC_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const uploadPublicImageMulter = multer({
  storage,
  limits: { fileSize: PUBLIC_IMAGE_MAX_BYTES },
});

// Leave applications only need a small supporting document. Keep this route
// deliberately separate from the large media upload routes so students and
// teachers can attach evidence without receiving the admin-media 403.
const LEAVE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const uploadLeaveAttachmentMulter = multer({
  storage,
  limits: { fileSize: LEAVE_ATTACHMENT_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = file.originalname.toLowerCase().split(".").pop();
    const allowedExtensions = ["pdf", "jpg", "jpeg", "png"];
    const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (
      !extension ||
      !allowedExtensions.includes(extension) ||
      (file.mimetype && !allowedMimeTypes.includes(file.mimetype))
    ) {
      callback(new Error("Only PDF, JPG, JPEG, and PNG attachments are allowed."));
      return;
    }
    callback(null, true);
  },
});

// A4 artwork must retain print quality. This stays separate from the normal
// image uploader, which optimizes media for the web.
const uploadLetterheadTemplateMulter = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = file.originalname.toLowerCase().split(".").pop();
    const allowedExtensions = ["pdf", "jpg", "jpeg", "png", "webp"];
    const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!extension || !allowedExtensions.includes(extension) || !allowedMimeTypes.includes(file.mimetype)) {
      callback(new Error("Upload an A4 PDF, JPG, PNG, or WEBP template (maximum 25 MB)."));
      return;
    }
    callback(null, true);
  },
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
const handleLeaveAttachmentUpload = makeMulterHandler(uploadLeaveAttachmentMulter);
const handleLetterheadTemplateUpload = makeMulterHandler(uploadLetterheadTemplateMulter);

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
router.post("/letterhead-template", authenticate, requireRole(Role.ADMIN), handleLetterheadTemplateUpload, uploadLetterheadTemplate);
router.post("/video", authenticate, protectedUpload, handleMulterUpload, uploadVideoToBunny);

// Student assignment submissions
router.post("/student/image", authenticate, requireRole(Role.STUDENT), handleMulterUpload, uploadImage);
router.post("/student/video", authenticate, requireRole(Role.STUDENT), handleMulterUpload, uploadVideoToBunny);

// Supporting documents for leave requests. Both portal roles are allowed;
// admins use their own review workflow and never need to upload an attachment.
router.post(
  "/leave-attachment",
  authenticate,
  requireRole(Role.STUDENT, Role.TEACHER),
  handleLeaveAttachmentUpload,
  uploadImage
);

export default router;
