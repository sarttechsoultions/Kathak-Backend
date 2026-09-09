import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import {
  createRescheduleRequest,
  getRescheduleRequests,
  teacherResponse,
  adminFinalize,
} from "./reschedule.controller";

const router = Router();

router.post("/", authenticate, createRescheduleRequest);
router.get("/", authenticate, getRescheduleRequests);
router.post("/:id/teacher-response", authenticate, teacherResponse);
router.post("/:id/admin-finalize", authenticate, adminFinalize);

export default router;
