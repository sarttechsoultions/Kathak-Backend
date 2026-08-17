import { Request, Response } from "express";
import { Role, ClassMode, PaymentStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import {
  setPortalAuthCookie,
  validatePortalAccess,
  signUserToken,
} from "../../lib/authHelpers";
import { getUserDisplayName, getTeacherBatchNames, getStudentBatchName } from "../../lib/batchHelpers";
import { sendEmail } from "../../lib/mailer";


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
      fullName,
      email,
      phone,
      password,
      courseId,
      batchId,
      country,
      countryCode,
      address,
      profileImage,
      dob,
      gender,
      city,
      region,
      postalCode,
      skillLevel,
      joiningDate,
      isUnder18,
      guardianName,
      relationship,
      emergencyContact,
      paymentMethod,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    } = req.body;

    // ---------- Payment Signature Validation ----------
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      res.status(400).json({ status: "error", message: "Payment verification failed. Missing Razorpay signature." });
      return;
    }

    const generated_signature = crypto
      .createHmac("sha256", env.razorpayKeySecret)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generated_signature !== razorpay_signature) {
      res.status(400).json({ status: "error", message: "Payment verification failed. Invalid signature." });
      return;
    }

    // ---------- Form Validation ----------
    if (!fullName?.trim()) {
      res.status(400).json({ status: "error", message: "Full Name is required." });
      return;
    }

    if (!email?.trim()) {
      res.status(400).json({ status: "error", message: "Email is required." });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ status: "error", message: "Invalid email address." });
      return;
    }

    if (!country?.toString().trim()) {
      res.status(400).json({ status: "error", message: "Country is required." });
      return;
    }

    if (!phone?.toString().trim()) {
      res.status(400).json({ status: "error", message: "Phone number is required." });
      return;
    }

    // Convert to E.164
    const e164Phone = toE164(phone, countryCode || "+91");

    // Basic length check (E.164 is max 15 digits after +)
    const digitsOnly = e164Phone.replace(/\D/g, "");
    if (digitsOnly.length < 10 || digitsOnly.length > 15) {
      res.status(400).json({
        status: "error",
        message: "Please enter a valid international phone number (10–15 digits).",
      });
      return;
    }

    if (!address?.toString().trim()) {
      res.status(400).json({ status: "error", message: "Residential address is required." });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({ status: "error", message: "Password must be at least 6 characters." });
      return;
    }

    if (!courseId) {
      res.status(400).json({ status: "error", message: "Course is required." });
      return;
    }

    if (batchId && !String(batchId).trim()) {
      res.status(400).json({ status: "error", message: "Batch selection is invalid." });
      return;
    }

    let batchRecord = null;
    if (batchId) {
      batchRecord = await prisma.batch.findUnique({ where: { id: String(batchId) } });
      if (!batchRecord) {
        res.status(400).json({ status: "error", message: "Selected batch does not exist." });
        return;
      }
      if (batchRecord.courseId && batchRecord.courseId !== String(courseId)) {
        res.status(400).json({ status: "error", message: "Selected batch does not belong to the chosen course." });
        return;
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCountryCode = countryCode
      ? (String(countryCode).startsWith("+") ? String(countryCode) : `+${countryCode}`)
      : "+91";

    // ---------- Duplicate Check ----------
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { phone: e164Phone },                    // exact E.164 match
        ],
      },
    });

    if (existingUser) {
      res.status(409).json({
        status: "error",
        message: "An account with this email or phone already exists. Please login.",
      });
      return;
    }

    // ---------- Transaction ----------
    const result = await prisma.$transaction(async (tx) => {
      const passwordHash = await bcrypt.hash(password, 10);

      const user = await tx.user.create({
        data: {
          fullName: fullName.trim(),
          email: normalizedEmail,
          phone: e164Phone,
          countryCode: normalizedCountryCode,
          passwordHash,
          role: Role.STUDENT,
          avatarUrl: profileImage?.trim() || null,
          country: country?.trim() || "India",
          address: address?.trim() || null,
          dob: dob ? new Date(dob) : null,
          gender: gender?.trim() || null,
          city: city?.trim() || null,
          region: region?.trim() || null,
          postalCode: postalCode?.trim() || null,
          skillLevel: skillLevel?.trim() || null,
          joiningDate: joiningDate ? new Date(joiningDate) : null,
          isUnder18: Boolean(isUnder18),
          guardianName: guardianName?.trim() || null,
          relationship: relationship?.trim() || null,
          emergencyContact: emergencyContact?.trim() || null,
          paymentMethod: paymentMethod?.trim() || null,
          isActive: true,
        },
      });

      const enrollment = await tx.enrollment.create({
        data: {
          userId: user.id,
          courseId: String(courseId),
          mode: ClassMode.ONLINE,
          type: "GROUP",
          active: true,
        },
      });

      // Find course fee to record the exact payment amount
      const course = await tx.course.findUnique({ where: { id: String(courseId) } });
      const feePaid = course?.groupFeeINR || 0;

      const payment = await tx.payment.create({
        data: {
          userId: user.id,
          amount: feePaid,
          currency: "INR",
          gateway: "RAZORPAY",
          transactionId: razorpay_payment_id,
          orderId: razorpay_order_id,
          status: PaymentStatus.SUCCESS
        }
      });

      if (batchId) {
        await tx.batchStudent.create({
          data: {
            batchId: String(batchId),
            studentId: user.id,
          },
        });

        await tx.batch.update({
          where: { id: String(batchId) },
          data: { totalStudents: { increment: 1 } },
        });
      }

      return { user, enrollment };
    });

    const { token, expiresInMs } = signUserToken({
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      permissions: [],
      rememberMe: true,
    });

    setPortalAuthCookie(res, "student", token, expiresInMs);

    // --- SEND REGISTRATION WELCOME EMAIL ---
    try {
      await sendEmail({
        to: result.user.email,
        subject: "Welcome to Kathak Academy!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #900C27; text-align: center;">Welcome to Kathak Academy</h2>
            <p>Hi ${result.user.fullName},</p>
            <p>Thank you for registering with us! Your enrollment has been successfully processed.</p>
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1B1B24;">Your Login Details</h3>
              <p><strong>Login URL:</strong> <a href="${env.frontendUrl}/student/login">${env.frontendUrl}/student/login</a></p>
              <p><strong>Email:</strong> ${result.user.email}</p>
              <p><strong>Password:</strong> ${password}</p>
            </div>
            <p>You can log in anytime to view your classes, assignments, and payments.</p>
            <br/>
            <p>Warm Regards,</p>
            <p><strong>Kathak Academy Team</strong></p>
          </div>
        `
      });
    } catch (emailErr) {
      console.error("Failed to send registration welcome email:", emailErr);
    }

    res.status(201).json({
      status: "success",
      message: "Student enrolled successfully.",
      data: {
        token, // 🔥 FIX: Token explicitly added for local storage in frontend
        user: {
          id: result.user.id,
          fullName: result.user.fullName,
          email: result.user.email,
          phone: result.user.phone,
          country: result.user.country,
          countryCode: result.user.countryCode,
          address: result.user.address,
          role: result.user.role,
          avatarUrl: result.user.avatarUrl,
          isActive: result.user.isActive,
          createdAt: result.user.createdAt,
          updatedAt: result.user.updatedAt,
        },
        enrollment: {
          id: result.enrollment.id,
          courseId: result.enrollment.courseId,
          mode: result.enrollment.mode,
          type: result.enrollment.type,
          active: result.enrollment.active,
          createdAt: result.enrollment.createdAt,
        },
      },
    });
  } catch (error: any) {
    console.error("Student enrollment error:", error);
    res.status(500).json({ status: "error", message: "Enrollment failed." });
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

    const enrolledBatchNames: string[] = studentBatches
      .map((sb: any) => sb.batch?.name || sb.batch?.code)
      .filter(Boolean);
    const enrolledBatchIds: string[] = studentBatches
      .map((sb: any) => sb.batchId)
      .filter(Boolean);

    const allAssignments = await (prisma as any).assignment.findMany({
      include: {
        submissions: { where: { studentId: userId } }
      },
      orderBy: { createdAt: "desc" }
    });

    // Filter assignments specifically for enrolled student batches
    const filteredAssignments = allAssignments.filter((a: any) => {
      // If student is not enrolled in any batch yet, show all assignments or "All Batches"
      if (enrolledBatchNames.length === 0 && enrolledBatchIds.length === 0) {
        return true;
      }

      // "All Batches" or "All" targets all students
      if (!a.batchName || a.batchName === "All Batches" || a.batchName === "All" || a.batchName === "All Batches & Courses") {
        return true;
      }

      // Check batch ID match
      if (a.batchId && enrolledBatchIds.includes(a.batchId)) {
        return true;
      }

      // Check batch name match (exact or comma-separated target batch list)
      if (a.batchName) {
        const targetList = a.batchName.split(",").map((s: string) => s.trim().toLowerCase());
        const isMatch = enrolledBatchNames.some((eName: string) =>
          targetList.some((tName: string) => tName.includes(eName.toLowerCase()) || eName.toLowerCase().includes(tName))
        );
        if (isMatch) return true;
      }

      return false;
    });

const mapped = filteredAssignments.map((a: any) => {
  const sub = a.submissions[0];
  let status = "PENDING";
  if (sub) {
    status = sub.status === "GRADED" ? "EVALUATED" : "SUBMITTED";
  }

  return {
    id: a.id,
    name: a.title,
    typeTag: a.typeTag || "Practical Assessment",
    course: a.batchName || "KATHAK",
    dueDate: new Date(a.dueDate).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }),
    status,
    grade: sub?.grade ? `${sub.grade}/100` : "—",
    feedback: sub?.feedback || sub?.notes || null,
    notes: sub?.notes || null,
    fileUrl: sub?.fileUrl,
    referenceFileUrl: a.referenceFileUrl || null,  // ✅ zaruri
    description: a.description || null,
    maxPoints: a.totalPoints ? `${a.totalPoints} pts` : "100 pts",
  };
});

    const totalAssigned = mapped.length;
    const pendingCount = mapped.filter((m: any) => m.status === "PENDING").length;
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

    const student = await prisma.user.findUnique({ where: { id: userId } });

    const submission = await (prisma as any).assignmentSubmission.upsert({
      where: {
        assignmentId_studentId: { assignmentId, studentId: userId }
      },
      update: {
        fileUrl,
        notes,
        submittedAt: new Date(),
        status: "SUBMITTED"
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
    const todayClass = liveClasses.find((lc: any) => {
      const lcDate = new Date(lc.scheduledStart).toISOString().split("T")[0];
      return lcDate === todayStr;
    });

    const upcomingClass = liveClasses.find((lc: any) => new Date(lc.scheduledStart).getTime() > Date.now());

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
    const reminders: { title: string; subtitle: string }[] = [];
    if (upcomingClass) {
      reminders.push({
        title: upcomingClass.title || "Live Practice Session",
        subtitle: `Starting at ${new Date(upcomingClass.scheduledStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      });
    }

    const unsubmittedWithDueDate = allBatchAssignments.filter((a: any) => !submittedAssignmentIds.has(a.id) && a.dueDate);
    unsubmittedWithDueDate.slice(0, 2).forEach((a: any) => {
      reminders.push({
        title: a.title || "Assignment Submission",
        subtitle: `Due: ${new Date(a.dueDate).toLocaleDateString()}`
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
        title: todayClass.title,
        instructor: todayClass.teacherName || firstBatch?.teacherName || "Faculty Instructor",
        timeStr: new Date(todayClass.scheduledStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isLive: todayClass.status === "LIVE" || todayClass.status === "SCHEDULED",
        // roomName is the real, always-present join identifier for this
        // class (zoomLink/description/durationMins don't exist on LiveClass
        // in the schema, so they were always undefined here).
        meetingLink: todayClass.roomName || "/student/classes/room"
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
        title: upcomingClass.title,
        subtitle: `With ${upcomingClass.teacherName || firstBatch?.teacherName || "your instructor"}`,
        timeStr: new Date(upcomingClass.scheduledStart).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
        durationStr: `${Math.max(1, Math.round((new Date(upcomingClass.scheduledEnd).getTime() - new Date(upcomingClass.scheduledStart).getTime()) / 60000))} min`,
        meetingLink: upcomingClass.roomName || "/student/classes/room"
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
          select: {
            id: true,
            name: true,
            schedule: true,
            code: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const allBatches = await prisma.batch.findMany({
      select: {
        id: true,
        name: true,
        schedule: true,
        code: true,
        courseId: true,
        courseName: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const mappedCourses = courses.map((c: any) => {
      const courseBatches = allBatches.filter((b: any) => {
        const batchName = (b.name || "").toLowerCase();
        const courseTitle = (c.title || "").toLowerCase();
        const batchCourseName = (b.courseName || "").toLowerCase();

        // 1. Relational courseId match
        if (b.courseId && b.courseId === c.id) return true;

        // 2. Explicit courseName match
        if (batchCourseName && (batchCourseName.includes(courseTitle) || courseTitle.includes(batchCourseName))) return true;

        // 3. Smart Keyword matching (e.g. "Hobby Kathak Morning Batch" -> matches "Hobby Kathak Batch")
        const courseWords = courseTitle.split(" ").filter((w: string) => w.length > 3 && w !== "batch" && w !== "course");
        if (courseWords.some((w: string) => batchName.includes(w) || batchCourseName.includes(w))) return true;

        return false;
      });

      return {
        id: c.id,
        title: c.title,
        groupFeeINR: c.groupFeeINR || 2500,
        groupFeeUSD: c.groupFeeUSD || 60,
        level: c.category || c.level || "Beginner",
        videoUrl: c.promoVideoUrl || "",
        batches: courseBatches.length > 0 ? courseBatches : allBatches,
      };
    });

    res.json({
      status: "success",
      data: { courses: mappedCourses, allBatches },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Failed to fetch courses" });
  }
};