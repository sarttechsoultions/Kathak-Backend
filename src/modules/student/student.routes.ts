import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import {
  enrollStudent,
  getStudentProfile,
  updateStudentProfile,
  changeStudentPassword,
  studentLogin
} from "./student.controller";

const router = Router();
router.post("/login", studentLogin);
router.post("/enroll", enrollStudent);

router.get(
  "/profile",
  authenticate,
  getStudentProfile,
  updateStudentProfile,
  changeStudentPassword,
  
);

export default router;