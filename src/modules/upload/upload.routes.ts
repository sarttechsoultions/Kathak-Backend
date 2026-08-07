import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { uploadImage, uploadVideoToBunny } from "./upload.controller";
import { authenticate } from "../../middleware/auth.middleware";

const storage = multer.memoryStorage();

const uploadAnyMulter = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

const handleMulterUpload = (req: Request, res: Response, next: NextFunction) => {
  uploadAnyMulter.any()(req, res, (err) => {
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

const router = Router();

// PUBLIC enroll profile photo (no auth)
router.post("/image/public", handleMulterUpload, uploadImage);

// Protected uploads
router.post("/image", authenticate, handleMulterUpload, uploadImage);
router.post("/video", authenticate, handleMulterUpload, uploadVideoToBunny);

export default router;