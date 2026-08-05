import { Router } from "express";
import multer from "multer";
import { uploadImage, uploadVideoToBunny } from "./upload.controller";
import { authenticate } from "../../middleware/auth.middleware";

const storage = multer.memoryStorage();

const uploadImageMulter = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadVideoMulter = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

const router = Router();

// ✅ PUBLIC — enroll profile photo (no auth)
router.post("/image/public", uploadImageMulter.single("image"), uploadImage);

// Protected uploads
router.post("/image", authenticate, uploadImageMulter.single("image"), uploadImage);
router.post("/video", authenticate, uploadVideoMulter.single("video"), uploadVideoToBunny);

export default router;