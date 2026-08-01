import { Router } from "express";
import multer from "multer";
import { uploadImage, uploadVideoToBunny } from "./upload.controller";
import { authenticate } from "../../middleware/auth.middleware";

const storage = multer.memoryStorage();

const uploadImageMulter = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for image
});

const uploadVideoMulter = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit for video
});

const router = Router();

router.use(authenticate);

router.post("/image", uploadImageMulter.single("image"), uploadImage);
router.post("/video", uploadVideoMulter.single("video"), uploadVideoToBunny);

export default router;
