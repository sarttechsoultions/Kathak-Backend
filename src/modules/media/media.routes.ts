import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { previewMediaResource } from "./media.controller";

const router = Router();

router.get("/preview", authenticate, previewMediaResource);

export default router;
