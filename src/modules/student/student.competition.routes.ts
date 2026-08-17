import { Router } from "express";
import { Role } from "@prisma/client";
import { getCompetitionTrack } from "./student.competition.controller";
import { authenticate, requireRole } from "../../middleware/auth.middleware";

const router = Router();

router.use(authenticate, requireRole(Role.STUDENT));

router.get("/track", getCompetitionTrack);

export default router;
