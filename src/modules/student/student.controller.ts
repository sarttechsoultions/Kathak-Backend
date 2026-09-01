import { Request, Response } from "express";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { mapCourseToPublicMarketingCourse } from "../../lib/publicCourseMapper";
import { env } from "../../config/env";
import {
  setPortalAuthCookie,
  validatePortalAccess,
  signUserToken,
} from "../../lib/authHelpers";
import { getUserDisplayName, getTeacherBatchNames, getStudentBatchName, isOneToOneBatch, resolveStudentBatchForAssignment } from "../../lib/batchHelpers";
import { buildLiveClassReminders, parseLiveClassReminderPrefs } from "../../lib/liveClassReminders";
import { sendEmail } from "../../lib/mailer";
import {
  completePendingEnrollment,
  EnrollmentError,
  sendEnrollmentWelcomeEmail,
  validateEnrollmentInput,
} from "./enrollment.service";
import { OtpError, sendEnrollmentOtp, verifyEnrollmentOtp, assertContactVerified } from "../../lib/otp";


const cleanPhoneInput = (phone: unknown): string => {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
};

const toE164 = (phone: unknown, countryCode: unknown = "+91"): string => {
  const digits = String(phone || "").replace(/\D/g, "");
  const code = String(countryCode || "+91").replace(/\D/g, "");

  if (code && digits.startsWith(code)) {
    return `+${digits}`;
  }

  return `+${code}${digits}`;
};

const normalizeForLookup = (input: unknown): string[] => {
  const cleaned = cleanPhoneInput(input);
  const digitsOnly = cleaned.replace(/\D/g, "");

  const candidates = new Set<string>();

  if (cleaned.startsWith("+")) {
    candidates.add(cleaned);
  }

  candidates.add(`+${digitsOnly}`);
  candidates.add(digitsOnly);

  // Common India cases
  if (digitsOnly.length === 10) {
    candidates.add(`+91${digitsOnly}`);
  }
  if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
    candidates.add(`+${digitsOnly}`);
  }

  return Array.from(candidates);
};

export const enrollStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      pendingEnrollmentId,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      res.status(400).json({ status: "error", message: "Payment verification failed. Please try again." });
      return;
    }

    if (!env.razorpayKeySecret) {
      res.status(500).json({ status: "error", message: "Payment is temporarily unavailable. Please try again later." });
      return;
    }

    const generated_signature = crypto
      .createHmac("sha256", env.razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generated_signature !== razorpay_signature) {
      res.status(400).json({ status: "error", message: "Payment verification failed. Invalid signature." });
      return;
    }

    const result = await completePendingEnrollment({
      pendingId: pendingEnrollmentId ? String(pendingEnrollmentId) : undefined,
      razorpayOrderId: String(razorpay_order_id),
      razorpayPaymentId: String(razorpay_payment_id),
    });

    if (!result.alreadyCompleted) {
      await sendEnrollmentWelcomeEmail(result.user);
    }

    const { token, expiresInMs } = signUserToken({
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      permissions: [],
      rememberMe: true,
    });

    setPortalAuthCookie(res, "student", token, expiresInMs);

    res.status(result.alreadyCompleted ? 200 : 201).json({
      status: "success",
      message: "Student enrolled successfully.",
      data: {
        token,
        user: result.user,
        enrollment: result.enrollment,
      },
    });
  } catch (error: unknown) {
    if (error instanceof EnrollmentError) {
      res.status(error.statusCode).json({ status: "error", message: error.message });
      return;
    }
    console.error("Student enrollment error:", error);
    res.status(500).json({ status: "error", message: "Enrollment failed." });
  }
};

export const enrollStudentBypass = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!env.enablePaymentBypass) {
      res.status(403).json({ status: "error", message: "Enrollment without payment is disabled." });
      return;
    }

    const validated = await validateEnrollmentInput(req.body, { requirePassword: true });
    await assertContactVerified("EMAIL", validated.normalizedEmail);
    await assertContactVerified("MOBILE", validated.e164Phone);

    const { batchId, courseId } = validated.payload;

    const pending = await prisma.pendingEnrollment.create({
      data: {
        email: validated.normalizedEmail,
        phone: validated.e164Phone,
        passwordHash: validated.passwordHash,
        payload: validated.payload,
        batchId: batchId || "",
        courseId,
      },
    });

    const devOrderId = `dev_order_${pending.id}`;
    const devPaymentId = `dev_pay_${pending.id}`;

    await prisma.pendingEnrollment.update({
      where: { id: pending.id },
      data: { razorpayOrderId: devOrderId },
    });

    const result = await completePendingEnrollment({
      pendingId: pending.id,
      razorpayOrderId: devOrderId,
      razorpayPaymentId: devPaymentId,
    });

    if (!result.alreadyCompleted) {
      await sendEnrollmentWelcomeEmail(result.user);
    }

    const { token, expiresInMs } = signUserToken({
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      permissions: [],
      rememberMe: true,
    });

    setPortalAuthCookie(res, "student", token, expiresInMs);

    res.status(result.alreadyCompleted ? 200 : 201).json({
      status: "success",
      message: "Student enrolled successfully (dev bypass).",
      data: {
        token,
        user: result.user,
        enrollment: result.enrollment,
      },
    });
  } catch (error: unknown) {
    if (error instanceof EnrollmentError || error instanceof OtpError) {
      res.status(error.statusCode).json({ status: "error", message: error.message });
      return;
    }
    console.error("Student enrollment bypass error:", error);
    res.status(500).json({ status: "error", message: "Enrollment failed." });
  }
};

export const sendStudentOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const channel = String(req.body.channel || "").toUpperCase();
    if (channel !== "EMAIL" && channel !== "MOBILE") {
      res.status(400).json({ status: "error", message: "OTP channel must be EMAIL or MOBILE." });
      return;
    }
    const data = await sendEnrollmentOtp({
      channel,
      email: req.body.email,
      phone: req.body.phone,
      countryCode: req.body.countryCode,
    });
    res.json({ status: "success", message: data.message, data });
  } catch (error: unknown) {
    if (error instanceof OtpError) {
      res.status(error.statusCode).json({ status: "error", message: error.message });
      return;
    }
    console.error("Send OTP error:", error);
    res.status(500).json({ status: "error", message: "Failed to send OTP." });
  }
};

export const verifyStudentOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const channel = String(req.body.channel || "").toUpperCase();
    if (channel !== "EMAIL" && channel !== "MOBILE") {
      res.status(400).json({ status: "error", message: "OTP channel must be EMAIL or MOBILE." });
      return;
    }
    const data = await verifyEnrollmentOtp({
      channel,
      email: req.body.email,
      phone: req.body.phone,
      countryCode: req.body.countryCode,
      code: req.body.code,
    });
    res.json({ status: "success", message: "OTP verified successfully.", data });
  } catch (error: unknown) {
    if (error instanceof OtpError) {
      res.status(error.statusCode).json({ status: "error", message: error.message });
      return;
    }
    console.error("Verify OTP error:", error);
    res.status(500).json({ status: "error", message: "Failed to verify OTP." });
  }
};

export const getStudentProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const requestingUser = req.user!;
    // If a studentId param is passed (teacher/admin viewing someone else),
    // use that; otherwise default to viewing own profile
    const targetStudentId = String(req.params.studentId || requestingUser.id);

    // Access control: students can only view their own profile
    if (requestingUser.role === "STUDENT" && requestingUser.id !== targetStudentId) {
      res.status(403).json({
        status: "error",
        message: "You can only view your own profile.",
      });
      return;
    }

    // TEACHER: only students in their own assigned batches
    if (requestingUser.role === "TEACHER") {
      const teacherName = await getUserDisplayName(requestingUser.id, requestingUser.email);
      const assignedBatches = await getTeacherBatchNames(requestingUser.id, teacherName);

      if (assignedBatches.length === 0) {
        res.status(403).json({ status: "error", message: "You have no assigned batches yet." });
        return;
      }

      const targetStudentBatch = await getStudentBatchName(targetStudentId);
      const allowed = assignedBatches.some(
        (b: string) => b.toLowerCase() === targetStudentBatch.toLowerCase()
      );
      if (!allowed) {
        res.status(403).json({
          status: "error",
          message: "You can only view students in your assigned batches.",
        });
        return;
      }
    }

    // ADMIN → unrestricted

    const student = await prisma.user.findUnique({
      where: {
        id: targetStudentId,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        avatarUrl: true,
        countryCode: true,
        country: true,
        address: true,
        isActive: true,
        createdAt: true,
        dob: true,
        gender: true,
        skillLevel: true,
        guardianName: true,
        relationship: true,
        emergencyContact: true,
        city: true,
        region: true,
        postalCode: true,
        batchMemberships: {
          select: {
            batch: {
              select: {
                id: true,
                name: true,
                code: true,
                courseName: true,
                teacherName: true,
                schedule: true,
              },
            },
          },
        },
      },
    });

    if (!student) {
      res.status(404).json({
        status: "error",
        message: "Student not found.",
      });
      return;
    }

    const enrolledBatches = (student.batchMemberships || [])
      .map((membership: any) => membership.batch)
      .filter(Boolean);

    const firstBatch = enrolledBatches[0];

    let father = null;
    let mother = null;
    if (student.guardianName) {
      if (student.relationship?.toLowerCase().includes("father")) {
        father = student.guardianName;
      } else if (student.relationship?.toLowerCase().includes("mother")) {
        mother = student.guardianName;
      } else {
        father = student.guardianName;
      }
    }

    res.json({
      status: "success",
      data: {
        id: student.id,
        fullName: student.fullName,
        email: student.email,
        phone: student.phone,
        countryCode: student.countryCode,
        role: student.role,
        avatarUrl: student.avatarUrl,
        country: student.country,
        address: student.address,
        isActive: student.isActive,
        createdAt: student.createdAt,
        dob: student.dob
          ? new Date(student.dob).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : null,
        gender: student.gender,
        level: student.skillLevel,
        batch: firstBatch?.name || firstBatch?.courseName || firstBatch?.code || null,
        guru: firstBatch?.teacherName || null,
        schedule: firstBatch?.schedule || null,
        father,
        mother,
        emergencyContact: student.emergencyContact,
        city: student.city,
        region: student.region,
        postalCode: student.postalCode,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch profile.",
    });
  }
};

export const updateStudentProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // 🔥 FIX: Added guardianName and emergencyContact
    const { fullName, phone, country, countryCode, address, avatarUrl, gender, guardianName, emergencyContact } = req.body;

    const student = await prisma.user.findUnique({
      where: {
        id: req.user!.id
      }
    });

    if (!student) {
      res.status(404).json({
        status: "error",
        message: "Student not found."
      });
      return;
    }

    const normalizedPhone = phone ? toE164(phone, countryCode ?? student.countryCode) : student.phone;
    const normalizedCountryCode = countryCode
      ? (String(countryCode).startsWith("+") ? String(countryCode) : `+${String(countryCode)}`)
      : student.countryCode;

    // Duplicate check
    if (phone && normalizedPhone !== student.phone) {
      const existingPhone = await prisma.user.findFirst({
        where: {
          phone: normalizedPhone,
          NOT: { id: student.id },
        },
      });

      if (existingPhone) {
        res.status(409).json({ status: "error", message: "Phone number already exists." });
        return;
      }
    }

    const updatedStudent = await prisma.user.update({
      where: {
        id: student.id,
      },
      data: {
        fullName: fullName ?? student.fullName,
        phone: normalizedPhone,
        countryCode: normalizedCountryCode,
        country: country ?? student.country,
        address: address ?? student.address,
        avatarUrl: avatarUrl ?? student.avatarUrl,
        gender: gender ?? student.gender,
        guardianName: guardianName ?? student.guardianName, // 🔥 FIX: Saving guardianName
        emergencyContact: emergencyContact ?? student.emergencyContact, // 🔥 FIX: Saving emergencyContact
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        countryCode: true,
        country: true,
        address: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        createdAt: true,
        dob: true,
        gender: true,
        skillLevel: true,
        guardianName: true,
        relationship: true,
        emergencyContact: true,
      },
    });

    // Formatting date and aligning fields to what frontend expects
    const formattedStudent = {
      ...updatedStudent,
      dob: updatedStudent.dob
        ? new Date(updatedStudent.dob).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : null,
      level: updatedStudent.skillLevel,
      // Mapping Guardian to Father/Mother exactly like `getStudentProfile`
      father: updatedStudent.relationship?.toLowerCase().includes("mother") ? null : updatedStudent.guardianName,
      mother: updatedStudent.relationship?.toLowerCase().includes("mother") ? updatedStudent.guardianName : null,
    };

    res.json({
      status: "success",
      message: "Profile updated successfully.",
      data: formattedStudent,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Failed to update profile."
    });
  }
};

export const changeStudentPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        status: "error",
        message: "Current password and new password are required."
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        status: "error",
        message: "New password must be at least 6 characters."
      });
      return;
    }

    const student = await prisma.user.findUnique({
      where: {
        id: req.user!.id
      }
    });

    if (!student) {
      res.status(404).json({
        status: "error",
        message: "Student not found."
      });
      return;
    }

    const isPasswordCorrect = await bcrypt.compare(
      currentPassword,
      student.passwordHash
    );

    if (!isPasswordCorrect) {
      res.status(400).json({
        status: "error",
        message: "Current password is incorrect."
      });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: {
        id: student.id
      },
      data: {
        passwordHash
      }
    });

    res.json({
      status: "success",
      message: "Password changed successfully."
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Failed to change password."
    });
  }
};

export const studentLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { emailOrPhone, password, rememberMe } = req.body;

    if (!emailOrPhone || !password) {
      res.status(400).json({
        status: "error",
        message: "Email/Phone and Password are required.",
      });
      return;
    }

    const loginValue = String(emailOrPhone).trim();

    // Try email first
    let user = await prisma.user.findFirst({
      where: {
        email: loginValue.toLowerCase(),
      },
    });

    // If not found by email → try phone with multiple possible formats
    if (!user) {
      const phoneCandidates = normalizeForLookup(loginValue);

      user = await prisma.user.findFirst({
        where: {
          phone: { in: phoneCandidates },
        },
      });
    }

    if (!user || !user.isActive || user.role !== Role.STUDENT) {
      res.status(401).json({ status: "error", message: "Invalid credentials." });
      return;
    }

    const passwordMatched = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatched) {
      res.status(401).json({ status: "error", message: "Invalid credentials." });
      return;
    }

    const { token, expiresInMs } = signUserToken({
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: [],
      rememberMe: Boolean(rememberMe),
    });

    res.clearCookie("auth_teacher"); 
    res.clearCookie("auth_admin");

    setPortalAuthCookie(res, "student", token, expiresInMs);

    res.json({
      status: "success",
      message: "Login successful.",
      data: {
        // Token intentionally omitted from JSON — see auth.controller.ts login for rationale.
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,               // already in E.164
          role: user.role,
          avatarUrl: user.avatarUrl,
          country: user.country,
          countryCode: user.countryCode,
        },
      },
    });
  } catch (error) {
    console.error("Student Login Error:", error);
    res.status(500).json({ status: "error", message: "Login failed." });
  }
};

export const getStudentFinance = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        // Sirf Active enrollment nikalenge
        enrollments: { 
          where: { active: true },
          include: { course: true } 
        },
        payments: { orderBy: { createdAt: "desc" } }
      }
    });

    if (!user) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    // Dynamic fee extraction based on assigned course
    const course = user.enrollments[0]?.course;
    const courseTitle = course?.title || "Kathak Dance Advanced";
    const totalFee = course?.groupFeeINR || 2200; // Database se actual fee uthayega

    // Dynamic Paid & Pending Calculation
    const successfulPayments = user.payments.filter((p) => p.status === "SUCCESS");
    const paidAmount = successfulPayments.reduce((acc, p) => acc + p.amount, 0);
    const pendingAmount = Math.max(0, totalFee - paidAmount);

    res.json({
      status: "success",
      data: {
        courseTitle,
        totalFee,
        paidAmount,
        pendingAmount,
        nextDueDate: pendingAmount > 0 ? "Pay Immediately" : "Cleared",
        transactions: user.payments.map((p) => ({
          id: p.transactionId || `TRA-${p.id.substring(0, 5).toUpperCase()}`,
          date: new Date(p.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
          description: `${courseTitle} - Registration Fee`,
          amount: `₹${p.amount.toLocaleString("en-IN")}`,
          status: p.status,
          statusBadge: p.status === "SUCCESS" 
            ? "text-emerald-600 font-extrabold" // ✅ Success ke liye Green text
            : "bg-[#FDEAE2] text-[#C15C3D] px-2.5 py-0.5 rounded-md font-bold text-[10px]"
        }))
      }
    });
  } catch (error) {
    console.error("Get Student Finance Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student finance data." });
  }
};

export const getStudentAssignments = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Fetch student's enrolled batches
    const studentBatches = await (prisma as any).batchStudent.findMany({
      where: { studentId: userId },
      include: { batch: true }
    });

    const allAssignments = await (prisma as any).assignment.findMany({
      include: {
        submissions: { where: { studentId: userId } }
      },
      orderBy: { createdAt: "desc" }
    });

    const filteredAssignments = allAssignments
      .map((a: any) => ({
        assignment: a,
        studentBatch: resolveStudentBatchForAssignment(a, studentBatches),
      }))
      .filter((entry: { studentBatch: unknown }) => entry.studentBatch !== null);

    const mapped = filteredAssignments.map(({ assignment: a, studentBatch }: any) => {
      const sub = a.submissions[0];
      const batchLabel = studentBatch?.courseName || studentBatch?.name || "KATHAK";
      let status = "PENDING";
      let reassignmentNote: string | null = null;

      if (sub) {
        if (sub.status === "GRADED") {
          status = "EVALUATED";
        } else if (sub.status === "SUBMITTED") {
          status = "SUBMITTED";
        } else if (sub.status === "PENDING" && sub.feedback) {
          try {
            const parsed =
              typeof sub.feedback === "string" ? JSON.parse(sub.feedback) : sub.feedback;
            if (parsed?.type === "reassign") {
              status = "REASSIGNED";
              reassignmentNote = parsed.comment || null;
            }
          } catch {
            // keep PENDING
          }
        }
      }

      let feedbackComment: string | null = reassignmentNote;
      let scoreBreakdown: { name: string; score: number }[] | null = null;
      let correctionNotes: string[] = [];

      if (sub?.feedback && status !== "REASSIGNED") {
        try {
          const parsed =
            typeof sub.feedback === "string" ? JSON.parse(sub.feedback) : sub.feedback;
          feedbackComment = parsed?.comment || parsed?.feedbackNotes || null;
          if (Array.isArray(parsed?.criteriaParts)) {
            scoreBreakdown = parsed.criteriaParts.map((p: any) => ({
              name: String(p.name || p.label || "Criteria"),
              score: Number(p.score) || 0,
            }));
          }
          if (Array.isArray(parsed?.pointers)) {
            correctionNotes = parsed.pointers.filter(Boolean);
          }
        } catch {
          feedbackComment = typeof sub.feedback === "string" ? sub.feedback : null;
        }
      }

      return {
        id: a.id,
        submissionId: sub?.id || null,
        name: a.title,
        typeTag: a.typeTag || "Practical Assessment",
        course: batchLabel,
        batchName: studentBatch?.name || null,
        dueDate: new Date(a.dueDate).toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
        }),
        status,
        grade: sub?.grade ? `${sub.grade}/100` : "—",
        gradeValue: sub?.grade ? Number(sub.grade) : null,
        feedback: feedbackComment || sub?.notes || null,
        scoreBreakdown,
        correctionNotes,
        notes: sub?.notes || null,
        fileUrl: sub?.fileUrl,
        referenceFileUrl: a.referenceFileUrl || null,
        referenceFileName: a.referenceFileName || null,
        teacherName: a.teacherName || null,
        evaluationCriteria: a.evaluationCriteria || null,
        description: a.description || null,
        maxPoints: a.totalPoints ? `${a.totalPoints} pts` : "100 pts",
        totalPoints: a.totalPoints || 100,
        submittedAt: sub?.submittedAt
          ? new Date(sub.submittedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : null,
        evaluatedAt: sub?.updatedAt && sub.status === "GRADED"
          ? new Date(sub.updatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : null,
      };
    });

    const totalAssigned = mapped.length;
    const pendingCount = mapped.filter((m: any) => m.status === "PENDING" || m.status === "REASSIGNED").length;
    const completedCount = mapped.filter((m: any) => m.status === "EVALUATED" || m.status === "SUBMITTED").length;

    res.json({
      status: "success",
      data: {
        assignments: mapped,
        metrics: { totalAssigned, pendingCount, completedCount }
      }
    });
  } catch (error) {
    console.error("Get Student Assignments Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch assignments." });
  }
};



export const submitStudentAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { assignmentId, fileUrl, notes } = req.body;

    if (!assignmentId) {
      res.status(400).json({ status: "error", message: "Assignment ID is required." });
      return;
    }

    if (!fileUrl || String(fileUrl).startsWith("blob:")) {
      res.status(400).json({
        status: "error",
        message: "A valid uploaded file URL is required. Please wait for upload to finish.",
      });
      return;
    }

    const studentBatches = await (prisma as any).batchStudent.findMany({
      where: { studentId: userId },
      include: { batch: true },
    });

    const assignment = await (prisma as any).assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      res.status(404).json({ status: "error", message: "Assignment not found." });
      return;
    }

    const matchedBatch = resolveStudentBatchForAssignment(assignment, studentBatches);
    if (!matchedBatch) {
      res.status(403).json({
        status: "error",
        message: "Access denied: this assignment is not assigned to your batch.",
      });
      return;
    }

    const student = await prisma.user.findUnique({ where: { id: userId } });

    const submission = await (prisma as any).assignmentSubmission.upsert({
      where: {
        assignmentId_studentId: { assignmentId, studentId: userId }
      },
      update: {
        fileUrl,
        notes,
        submittedAt: new Date(),
        status: "SUBMITTED",
        grade: null,
        feedback: null,
      },
      create: {
        assignmentId,
        studentId: userId,
        studentName: student?.fullName || "Student",
        fileUrl,
        notes,
        status: "SUBMITTED"
      }
    });

    res.status(200).json({ status: "success", message: "Assignment submitted successfully.", data: submission });
  } catch (error) {
    console.error("Submit Assignment Error:", error);
    res.status(500).json({ status: "error", message: "Failed to submit assignment." });
  }
};

// ================= STUDENT EXAM MANAGEMENT =================

export const getStudentExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Fetch student's enrolled batches
    const studentBatches = await (prisma as any).batchStudent.findMany({
      where: { studentId: userId },
      include: { batch: true }
    });

    const enrolledBatchNames: string[] = studentBatches
      .map((sb: any) => sb.batch?.name || sb.batch?.code)
      .filter(Boolean);

    const allExams = await (prisma as any).assignment.findMany({
      where: {
        OR: [
          { typeTag: { startsWith: "EXAM" } },
          { typeTag: { startsWith: "Exam" } },
          { typeTag: "Practical Assessment" }
        ]
      },
      include: {
        submissions: { where: { studentId: userId } }
      },
      orderBy: { createdAt: "desc" }
    });

    const filteredExams = allExams.filter((ex: any) => {
      if (enrolledBatchNames.length === 0) return true;
      if (!ex.batchName || ex.batchName === "All Batches" || ex.batchName === "All") return true;
      return enrolledBatchNames.some((eName) =>
        ex.batchName.toLowerCase().includes(eName.toLowerCase()) || eName.toLowerCase().includes(ex.batchName.toLowerCase())
      );
    });

    const mapped = filteredExams.map((ex: any) => {
      let extraData: any = {};
      if (ex.description && ex.description.startsWith("{")) {
        try { extraData = JSON.parse(ex.description); } catch {}
      }

      const sub = ex.submissions[0];
      let status = "Upcoming";
      let statusBadge = "bg-[#E5F2FF] text-[#2B78C5]";
      let scoreStr = "--";
      let isRedScore = false;

      if (sub) {
        if (sub.status === "GRADED") {
          status = "Completed";
          statusBadge = "bg-[#E6F7ED] text-[#22A05B]";
          scoreStr = sub.grade ? `${sub.grade}/100` : "--";
        } else {
          status = "Submitted";
          statusBadge = "bg-[#FEF3C7] text-[#D97706]";
          scoreStr = "--";
        }
      } else {
        const due = new Date(ex.dueDate).getTime();
        if (due < Date.now()) {
          status = "Missed";
          statusBadge = "bg-[#FDF2F4] text-[#C10F3A]";
          scoreStr = "0/100";
          isRedScore = true;
        }
      }

      const formattedDate = new Date(ex.dueDate).toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric"
      });

      return {
        id: ex.id,
        name: ex.title,
        code: `Code: ${extraData.examCode || "EX-101"}`,
        date: extraData.dateTime || formattedDate,
        category: ex.typeTag && ex.typeTag.includes("FINAL") ? "FINAL" : ex.typeTag && ex.typeTag.includes("MID") ? "MIDTERM" : "MONTHLY",
        score: scoreStr,
        isRedScore,
        status,
        statusBadge,
        actionRoute: (status === "Completed" || status === "Submitted" || status === "EVALUATED" || status === "Missed" || sub) ? `/student/exam/results?id=${ex.id}` : `/student/exam/take?id=${ex.id}`,
        questions: extraData.questions || [],
        durationMins: extraData.durationMins || "120",
        feedback: sub?.feedback || sub?.notes || null,
        fileUrl: sub?.fileUrl
      };
    });

    res.json({ status: "success", data: { exams: mapped } });
  } catch (error) {
    console.error("Get Student Exams Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student exams." });
  }
};

export const getStudentExamById = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const exam = await (prisma as any).assignment.findUnique({
      where: { id },
      include: {
        submissions: { where: { studentId: userId } }
      }
    });

    if (!exam) {
      res.status(404).json({ status: "error", message: "Exam not found." });
      return;
    }

    let extraData: any = {};
    if (exam.description && exam.description.startsWith("{")) {
      try { extraData = JSON.parse(exam.description); } catch {}
    }

    const sub = exam.submissions[0];

    res.json({
      status: "success",
      data: {
        id: exam.id,
        title: exam.title,
        examCode: extraData.examCode || "EX-101",
        batchCourse: exam.batchName || "KATHAK",
        durationMins: extraData.durationMins || "120",
        passingMark: extraData.passingMark || 60,
        questions: extraData.questions || [],
        submission: sub ? {
          grade: sub.grade,
          feedback: sub.feedback,
          notes: sub.notes,
          fileUrl: sub.fileUrl,
          submittedAt: sub.submittedAt
        } : null
      }
    });
  } catch (error) {
    console.error("Get Exam By ID Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch exam." });
  }
};

export const submitStudentExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { examId, answers, fileUrl, notes } = req.body;

    if (!examId) {
      res.status(400).json({ status: "error", message: "Exam ID is required." });
      return;
    }

    const student = await prisma.user.findUnique({ where: { id: userId } });
    const notesPayload = typeof answers === "object" ? JSON.stringify({ answers, notes }) : (notes || "Exam submission");

    const submission = await (prisma as any).assignmentSubmission.upsert({
      where: {
        assignmentId_studentId: { assignmentId: examId, studentId: userId }
      },
      update: {
        fileUrl,
        notes: notesPayload,
        submittedAt: new Date(),
        status: "SUBMITTED"
      },
      create: {
        assignmentId: examId,
        studentId: userId,
        studentName: student?.fullName || "Student",
        fileUrl,
        notes: notesPayload,
        status: "SUBMITTED"
      }
    });

    res.json({ status: "success", message: "Exam submitted successfully.", data: submission });
  } catch (error) {
    console.error("Submit Exam Error:", error);
    res.status(500).json({ status: "error", message: "Failed to submit exam." });
  }
};

export const getStudentDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const student = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        batchMemberships: {
          include: {
            batch: {
              include: {
                course: {
                  include: {
                    lessons: true
                  }
                },
                liveClasses: true,
                assignments: true
              }
            }
          }
        },
        enrollments: {
          include: {
            course: {
              include: {
                lessons: true
              }
            }
          }
        },
        attendances: {
          orderBy: { date: "desc" },
          take: 5,
          include: {
            batch: true
          }
        },
        assignmentSubmissions: true
      }
    });

    if (!student) {
      res.status(404).json({ status: "error", message: "Student profile not found." });
      return;
    }

    const enrolledBatches = (student.batchMemberships || []).map((m: any) => m.batch).filter(Boolean);
    const firstBatch = enrolledBatches[0];
    const primaryCourse = firstBatch?.course || student.enrollments[0]?.course;

    const courseTitle = primaryCourse?.title || firstBatch?.courseName || firstBatch?.name || "";
    const totalLessons = primaryCourse?.lessons?.length || 0;
    const completedSubmissions = student.assignmentSubmissions?.length || 0;
    const progressPercent = totalLessons > 0 ? Math.min(100, Math.round((completedSubmissions / totalLessons) * 100)) : (completedSubmissions > 0 ? 100 : 0);

    // Fetch live classes across student's enrolled batches
    const batchIds = enrolledBatches.map((b: any) => b.id);
    const liveClasses = batchIds.length > 0 ? await (prisma as any).liveClass.findMany({
      where: {
        batchId: { in: batchIds }
      },
      orderBy: { scheduledStart: "asc" }
    }) : [];

    const todayStr = new Date().toISOString().split("T")[0];
    const activeClasses = liveClasses.filter(
      (lc: any) => lc.status !== "COMPLETED" && lc.status !== "CANCELLED" && new Date(lc.scheduledEnd).getTime() > Date.now()
    );

    const todayClass =
      activeClasses.find((lc: any) => lc.status === "LIVE") ||
      activeClasses.find((lc: any) => {
        const lcDate = new Date(lc.scheduledStart).toISOString().split("T")[0];
        return lcDate === todayStr;
      });

    const upcomingClass =
      activeClasses.find((lc: any) => lc.status === "LIVE") ||
      activeClasses.find(
        (lc: any) => lc.status === "SCHEDULED" && new Date(lc.scheduledStart).getTime() > Date.now()
      );

    // Calculate pending assignments
    const allBatchAssignments = enrolledBatches.flatMap((b: any) => b.assignments || []);
    const submittedAssignmentIds = new Set((student.assignmentSubmissions || []).map((s: any) => s.assignmentId));
    const pendingAssignmentsCount = allBatchAssignments.filter((a: any) => !submittedAssignmentIds.has(a.id)).length;

    // Course progress list
    const courseProgressList = (student.enrollments || []).map((e: any) => {
      const cLessons = e.course?.lessons?.length || 0;
      const percent = cLessons > 0 ? Math.min(100, Math.round((completedSubmissions / cLessons) * 100)) : 0;
      return {
        name: e.course?.title || "Enrolled Course",
        percent
      };
    });

    // Reminders
    const reminderPrefs = parseLiveClassReminderPrefs(student.notificationPrefs);
    const liveClassReminders = buildLiveClassReminders(
      liveClasses.map((lc: any) => ({
        id: lc.id,
        title: lc.title,
        scheduledStart: lc.scheduledStart,
        scheduledEnd: lc.scheduledEnd,
        status: lc.status,
        teacherName: lc.teacherName,
        batch: enrolledBatches.find((b: any) => b.id === lc.batchId) || firstBatch,
      })),
      { enabled: reminderPrefs.liveClassReminders, max: 5, daysAhead: 14 }
    );

    const reminders: { title: string; subtitle: string; kind?: string; href?: string }[] =
      liveClassReminders.map((r) => ({
        title: r.title,
        subtitle: r.subtitle,
        kind: r.kind,
        href: r.href,
      }));

    const unsubmittedWithDueDate = allBatchAssignments.filter((a: any) => !submittedAssignmentIds.has(a.id) && a.dueDate);
    unsubmittedWithDueDate.slice(0, 2).forEach((a: any) => {
      reminders.push({
        title: a.title || "Assignment Submission",
        subtitle: `Due: ${new Date(a.dueDate).toLocaleDateString()}`,
        kind: "assignment",
        href: "/student/assignments",
      });
    });

    const dashboardData = {
      user: {
        id: student.id,
        fullName: student.fullName,
        email: student.email,
        phone: student.phone,
        profileImage: student.avatarUrl
      },
      currentCourse: courseTitle ? {
        title: courseTitle,
        subtitle: primaryCourse?.description || "Master the rhythm of the soul. Practice your Mudras & Tatkaar today!",
        completedLessons: completedSubmissions,
        totalLessons: totalLessons,
        progressPercent: progressPercent
      } : null,
      todayLiveClass: todayClass ? {
        id: todayClass.id,
        title: todayClass.title,
        instructor: todayClass.teacherName || firstBatch?.teacherName || "Faculty Instructor",
        timeStr: new Date(todayClass.scheduledStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isLive: todayClass.status === "LIVE",
        meetingLink: todayClass.status === "LIVE"
          ? `/student/classes/room/${todayClass.id}`
          : "/student/classes"
      } : null,
      // Attendance has four real states (PRESENT/ABSENT/LATE/LEAVE) — show
      // the actual status instead of collapsing LATE/LEAVE into "Absent".
      recentClasses: (student.attendances || []).map((att: any) => ({
        title: att.batch?.name || "Practice Session",
        subtitle: att.batch?.courseName || "Kathak Lesson",
        status: att.status,
        date: new Date(att.date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
      })),
      upcomingLiveClass: upcomingClass ? {
        id: upcomingClass.id,
        title: upcomingClass.title,
        subtitle: `With ${upcomingClass.teacherName || firstBatch?.teacherName || "your instructor"}`,
        timeStr: new Date(upcomingClass.scheduledStart).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
        durationStr: `${Math.max(1, Math.round((new Date(upcomingClass.scheduledEnd).getTime() - new Date(upcomingClass.scheduledStart).getTime()) / 60000))} min`,
        isLive: upcomingClass.status === "LIVE",
        meetingLink: upcomingClass.status === "LIVE"
          ? `/student/classes/room/${upcomingClass.id}`
          : "/student/classes"
      } : null,
      courseProgress: courseProgressList,
      metrics: {
        completedLessons: completedSubmissions,
        practiceHours: `${Math.floor(completedSubmissions * 1.5)}h 00m`,
        assignmentsPending: pendingAssignmentsCount
      },
      reminders
    };

    res.json({ status: "success", data: dashboardData });
  } catch (error) {
    console.error("Get Student Dashboard Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student dashboard data." });
  }
};

export const getPublicCourses = async (req: Request, res: Response) => {
  try {
    const courses = await prisma.course.findMany({
      include: {
        batches: {
          where: { status: "Active" },
          select: {
            id: true,
            name: true,
            schedule: true,
            code: true,
            courseId: true,
            courseName: true,
            status: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const mappedCourses = courses.map((c) => {
      const courseBatches = (c.batches || [])
        .filter((b) => !b.courseId || b.courseId === c.id)
        .filter((b) => !isOneToOneBatch(b.name, b.code));

      return {
        id: c.id,
        title: c.title,
        slug: c.slug,
        groupFeeINR: c.groupFeeINR || 2500,
        groupFeeUSD: c.groupFeeUSD || 60,
        oneToOneFeeINR: c.oneToOneFeeINR || 0,
        oneToOneFeeUSD: c.oneToOneFeeUSD || 0,
        duration: c.groupClassesCount || "",
        oneToOneDuration: c.oneToOneClassesCount || "",
        level: c.category || "Beginner",
        videoUrl: c.videoUrl || "",
        batches: courseBatches.map((b) => ({
          id: b.id,
          name: b.name,
          schedule: b.schedule,
          code: b.code,
          courseId: c.id,
          courseName: c.title,
        })),
      };
    });

    res.json({
      status: "success",
      data: { courses: mappedCourses },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Failed to fetch courses" });
  }
};

export const getPublicMarketingCourses = async (req: Request, res: Response) => {
  try {
    const homepageOnly = String(req.query.homepage || "") === "true";

    const courses = await prisma.course.findMany({
      where: {
        published: true,
        ...(homepageOnly ? { showOnHome: true } : {}),
      },
      orderBy: [{ homepageSortOrder: "asc" }, { createdAt: "asc" }],
    });

    res.json({
      status: "success",
      data: {
        courses: courses.map(mapCourseToPublicMarketingCourse),
      },
    });
  } catch (error) {
    console.error("Public marketing courses error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch public courses" });
  }
};

export const getPublicMarketingCourseBySlug = async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) {
      return res.status(400).json({ status: "error", message: "Course slug is required." });
    }

    const courses = await prisma.course.findMany({
      where: { published: true },
    });

    const matched = courses.find(
      (course) =>
        course.slug.toLowerCase() === slug ||
        (course.aliases || []).some((alias) => alias.toLowerCase() === slug)
    );

    if (!matched) {
      return res.status(404).json({ status: "error", message: "Course not found." });
    }

    res.json({
      status: "success",
      data: mapCourseToPublicMarketingCourse(matched),
    });
  } catch (error) {
    console.error("Public marketing course error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch course details" });
  }
};

export const getStudentAttendance = async (req: Request, res: Response) => {
  try {
    const studentId = req.user!.id;
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      include: {
        batchMemberships: { include: { batch: true } }
      }
    });

    if (!student) {
      return res.status(404).json({ status: "error", message: "Student not found" });
    }

    const batchIds = student.batchMemberships.map((m) => m.batchId);

    // Fetch all attendance logs for this student
    const attendanceLogs = await prisma.attendance.findMany({
      where: { studentId },
      orderBy: { date: "desc" }
    });

    // Fetch leave requests for this student
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: { userId: studentId },
      orderBy: { startDate: "desc" }
    });

    // We also map Leave Requests into the unified logs array for the frontend
    const logs = [
      ...attendanceLogs.map((a) => ({
        id: a.id,
        date: a.date,
        type: "attendance",
        className: a.session || a.batchName || "Class Session",
        time: a.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: a.status,
      })),
      ...leaveRequests.map((l) => ({
        id: l.id,
        date: l.startDate,
        type: "leave",
        className: `${l.leaveType} Leave`,
        time: "-",
        status: l.status === "APPROVED" ? "LEAVE" : (l.status === "PENDING" ? "PENDING" : "REJECTED"),
      }))
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const presentCount = attendanceLogs.filter(a => a.status === "PRESENT").length;
    const absentCount = attendanceLogs.filter(a => a.status === "ABSENT").length;
    const lateCount = attendanceLogs.filter(a => a.status === "LATE").length;
    const leaveCount = attendanceLogs.filter(a => a.status === "LEAVE").length + leaveRequests.reduce((acc, curr) => acc + curr.totalDays, 0);

    const totalDays = presentCount + absentCount + lateCount + leaveCount;
    const overallAttendance = totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 100;

    // Calculate current streak
    let currentStreak = 0;
    const sortedAttendance = [...attendanceLogs].sort((a, b) => b.date.getTime() - a.date.getTime());
    for (const log of sortedAttendance) {
      if (log.status === "PRESENT") currentStreak++;
      else break;
    }

    res.json({
      status: "success",
      data: {
        logs,
        stats: {
          overallAttendance,
          totalWorkingDays: totalDays || 0,
          presentDays: presentCount,
          totalAbsent: absentCount,
          totalLeaves: leaveCount,
          currentStreak
        }
      }
    });

  } catch (error) {
    console.error("Error fetching student attendance:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch attendance" });
  }
};

export const applyStudentLeave = async (req: Request, res: Response) => {
  try {
    const studentId = req.user!.id;
    const { leaveType, startDate, endDate, totalDays, reason, attachment } = req.body;

    if (!startDate || !endDate || !leaveType || !reason) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }

    const user = await prisma.user.findUnique({ where: { id: studentId } });
    const studentName = user?.fullName || "Student";

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        userId: studentId,
        userName: studentName,
        leaveType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        totalDays: Number(totalDays),
        reason,
        attachment
      }
    });

    res.json({
      status: "success",
      message: "Leave application submitted successfully",
      data: leaveRequest
    });
  } catch (error) {
    console.error("Error applying for leave:", error);
    return res.status(500).json({ status: "error", message: "Failed to submit leave application" });
  }
};

export const getStudentProgress = async (req: Request, res: Response) => {
  try {
    const studentId = req.user!.id;
    
    // 1. Get Attendance
    const attendanceRecords = await prisma.attendance.findMany({
      where: { studentId },
      orderBy: { date: "desc" },
    });
    
    let presentCount = 0;
    attendanceRecords.forEach(a => {
      if (a.status === "PRESENT" || a.status === "LATE") presentCount++;
    });
    const attendanceRate = attendanceRecords.length > 0 
      ? Math.round((presentCount / attendanceRecords.length) * 100) 
      : 100;
      
    // 2. Get Assignments
    const assignmentSubmissions = await prisma.assignmentSubmission.findMany({
      where: { studentId },
      include: { assignment: true },
      orderBy: { submittedAt: "desc" }
    });
    
    let totalAssignmentMarks = 0;
    let gradedAssignments = 0;
    
    const formattedAssignments = assignmentSubmissions.map(sub => {
       if (sub.status === "GRADED" && sub.grade) {
          gradedAssignments++;
          totalAssignmentMarks += Number(sub.grade) || 0;
       }
       return {
         id: sub.assignmentId,
         title: sub.assignment.title,
         assignedDate: sub.assignment.createdAt.toISOString(),
         deadline: sub.assignment.dueDate.toISOString(),
         status: sub.status,
         marks: sub.grade || "--",
         totalMarks: sub.assignment.totalPoints
       };
    });
    
    const avgAssignmentScore = gradedAssignments > 0 
      ? Math.round(totalAssignmentMarks / gradedAssignments)
      : 0;
      
    // Get pending assignments
    const batchStudent = await prisma.batchStudent.findFirst({
      where: { studentId }
    });
    
    if (batchStudent) {
      const pendingAssignments = await prisma.assignment.findMany({
        where: {
          batchId: batchStudent.batchId,
          submissions: { none: { studentId } }
        }
      });
      
      pendingAssignments.forEach(a => {
        formattedAssignments.push({
          id: a.id,
          title: a.title,
          assignedDate: a.createdAt.toISOString(),
          deadline: a.dueDate.toISOString(),
          status: "PENDING",
          marks: "--",
          totalMarks: a.totalPoints
        });
      });
    }

    // 3. Get Tasks
    const examResults = await prisma.examResult.findMany({
      where: { studentId },
      include: { exam: true },
      orderBy: { submittedAt: "desc" }
    });
    
    const formattedTasks = examResults.map(er => ({
      id: er.examId,
      title: er.exam.title,
      assignedDate: er.exam.date.toISOString(),
      completedDate: er.submittedAt.toISOString(),
      status: er.status === "PENDING" ? "SUBMITTED" : er.status,
      marks: er.marksObtained !== null ? er.marksObtained : "--",
      totalMarks: er.exam.totalMarks
    }));
    
    const videoSubmissions = await prisma.videoSubmission.findMany({
      where: { studentId },
      include: { task: true },
      orderBy: { submissionDate: "desc" }
    });
    
    videoSubmissions.forEach(vs => {
       formattedTasks.push({
         id: vs.id,
         title: vs.task?.title || vs.videoTitle,
         assignedDate: vs.task?.submissionDate.toISOString() || vs.submissionDate.toISOString(),
         completedDate: vs.submissionDate.toISOString(),
         status: vs.status === "PENDING" ? "SUBMITTED" : (vs.status === "REVIEWED" ? "GRADED" : vs.status),
         marks: vs.marks !== null ? vs.marks : "--",
         totalMarks: 100
       });
    });
    
    // Sort combined tasks & assignments
    formattedAssignments.sort((a, b) => new Date(b.assignedDate).getTime() - new Date(a.assignedDate).getTime());
    formattedTasks.sort((a, b) => new Date(b.assignedDate).getTime() - new Date(a.assignedDate).getTime());

    // Task Completion Rate
    const totalAssignedTasks = formattedAssignments.length + formattedTasks.length;
    const completedTasks = formattedAssignments.filter(a => a.status !== "PENDING").length + formattedTasks.length;
    
    const taskCompletionRate = totalAssignedTasks > 0 
      ? Math.round((completedTasks / totalAssignedTasks) * 100)
      : 100;
      
    // Overall Progress (Weighted Avg: 30% attendance, 30% task completion, 40% assignments)
    // If no assignments, fallback to 50/50 attendance and tasks.
    let overallProgress = 0;
    if (formattedAssignments.length > 0) {
      overallProgress = Math.round((attendanceRate * 0.3) + (taskCompletionRate * 0.3) + (avgAssignmentScore * 0.4));
    } else {
      overallProgress = Math.round((attendanceRate * 0.5) + (taskCompletionRate * 0.5));
    }
    
    // Format Attendance History for UI
    const formattedAttendanceHistory = attendanceRecords.slice(0, 5).map(a => ({
      id: a.id,
      date: a.date.toISOString(),
      class: a.session,
      instructor: "Faculty Instructor",
      status: a.status
    }));

    return res.status(200).json({
      status: "success",
      data: {
        metrics: {
          overallProgress,
          attendanceRate,
          taskCompletionRate,
          avgAssignmentScore,
          totalTasks: totalAssignedTasks,
          completedTasks,
          presentDays: presentCount,
          totalDays: attendanceRecords.length,
          pendingAssignments: formattedAssignments.filter(a => a.status === "PENDING").length
        },
        attendanceHistory: formattedAttendanceHistory,
        assignments: formattedAssignments,
        tasks: formattedTasks
      }
    });

  } catch (error: any) {
    console.error("Error fetching progress:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student progress" });
  }
};