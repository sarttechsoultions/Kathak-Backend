import { Request, Response } from "express";
import { Role, ClassMode } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import {
  setPortalAuthCookie,
  validatePortalAccess,
  signUserToken,
} from "../../lib/authHelpers";

export const enrollStudent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      fullName,
      email,
      phone,
      password,
      courseId,
      courseTitle,
      skillLevel,
      batch,
      joiningDate,
      paymentMethod,
      groupFeeINR,
      groupFeeUSD
    } = req.body;

    // Validation
    if (!fullName?.trim()) {
      res.status(400).json({
        status: "error",
        message: "Full Name is required."
      });
      return;
    }

    if (!email?.trim()) {
      res.status(400).json({
        status: "error",
        message: "Email is required."
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      res.status(400).json({
        status: "error",
        message: "Invalid email address."
      });
      return;
    }

    if (!phone?.trim()) {
      res.status(400).json({
        status: "error",
        message: "Phone number is required."
      });
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      res.status(400).json({
        status: "error",
        message: "Phone number must be exactly 10 digits."
      });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({
        status: "error",
        message: "Password must be at least 6 characters."
      });
      return;
    }

    if (!courseId) {  
      res.status(400).json({
        status: "error",
        message: "Course is required."
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();

    // Duplicate Check
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          {
            email: normalizedEmail
          },
          {
            phone: normalizedPhone
          }
        ]
      }
    });

    if (existingUser) {
      res.status(409).json({
        status: "error",
        message: "An account with this email or phone already exists. Please login."
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await tx.user.create({
        data: {
          fullName: fullName.trim(),
          email: normalizedEmail,
          phone: normalizedPhone,
          passwordHash,
          role: Role.STUDENT,
          avatarUrl: "/Ananya.png",
          isActive: true
        }
      });

      console.log("Received courseId:", courseId);

const course = await tx.course.findUnique({
  where: {
    id: courseId
  }
});

console.log("Course Found:", course);
            // Create Enrollment
      const enrollment = await tx.enrollment.create({
        data: {
          userId: user.id,
          courseId,
          mode: ClassMode.ONLINE,
          type: "GROUP",
          active: true
        }
      });

      // Assign Student to Batch
      if (batch) {

        const targetBatch = await tx.batch.findFirst({
          where: {
            OR: [
              {
                name: {
                  contains: String(batch).substring(0, 8),
                  mode: "insensitive"
                }
              },
              {
                code: String(batch)
              }
            ]
          }
        });

        if (!targetBatch) {
          throw new Error("Selected batch not found.");
        }

        await tx.batchStudent.create({
          data: {
            batchId: targetBatch.id,
            studentId: user.id
          }
        });

        await tx.batch.update({
          where: {
            id: targetBatch.id
          },
          data: {
            totalStudents: {
              increment: 1
            }
          }
        });
      }

      return {
        user,
        enrollment
      };

    });
        const signOptions: SignOptions = {
      expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"]
    };

    const token = jwt.sign(
      {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        permissions: []
      },
      env.jwtSecret,
      signOptions
    );

    res.status(201).json({
      status: "success",
      message: `Enrollment & course purchase completed successfully for ${result.user.fullName}!`,
      data: {
        user: {
          id: result.user.id,
          fullName: result.user.fullName,
          email: result.user.email,
          phone: result.user.phone,
          role: result.user.role,
          avatarUrl: result.user.avatarUrl
        },
        token,
        courseEnrollment: {
          id: result.enrollment.id,
          courseId,
          courseTitle: courseTitle || "",
          batch: batch || "",
          skillLevel: skillLevel || "Beginner",
          joiningDate:
            joiningDate || new Date().toISOString().split("T")[0],
          paymentMethod: paymentMethod || "",
          paymentStatus: "PENDING",
          amountPaid: groupFeeINR
            ? `₹${groupFeeINR}`
            : groupFeeUSD
            ? `$${groupFeeUSD}`
            : "-"
        }
      }
    });

  } catch (error: any) {
    console.error("Student Enrollment Error:", error);

    res.status(500).json({
      status: "error",
      message: error.message || "Failed to process enrollment."
    });
  }
};

export const getStudentProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const student = await prisma.user.findUnique({
      where: {
        id: req.user!.id
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        avatarUrl: true,
        country: true,
        isActive: true,
        createdAt: true
      }
    });

    if (!student) {
      res.status(404).json({
        status: "error",
        message: "Student not found."
      });
      return;
    }

    res.json({
      status: "success",
      data: student
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Failed to fetch profile."
    });
  }
};

export const updateStudentProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fullName, phone, country, avatarUrl } = req.body;

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

    // Check duplicate phone number
    if (phone && phone !== student.phone) {
      const existingPhone = await prisma.user.findFirst({
        where: {
          phone,
          NOT: {
            id: student.id
          }
        }
      });

      if (existingPhone) {
        res.status(409).json({
          status: "error",
          message: "Phone number already exists."
        });
        return;
      }
    }

    const updatedStudent = await prisma.user.update({
      where: {
        id: student.id
      },
      data: {
        fullName: fullName ?? student.fullName,
        phone: phone ?? student.phone,
        country: country ?? student.country,
        avatarUrl: avatarUrl ?? student.avatarUrl
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        country: true,
        avatarUrl: true,
        role: true,
        isActive: true
      }
    });

    res.json({
      status: "success",
      message: "Profile updated successfully.",
      data: updatedStudent
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
    const { emailOrPhone, password, rememberMe } = req.body;  // rememberMe optional

    if (!emailOrPhone || !password) {
      res.status(400).json({
        status: "error",
        message: "Email/Phone and Password are required."
      });
      return;
    }

    const loginValue = String(emailOrPhone).trim();

    const user = await prisma.user.findFirst({
      where: {
        role: Role.STUDENT,          // pehle se hai
        OR: [
          { email: loginValue.toLowerCase() },
          { phone: loginValue }
        ]
      }
    });

    if (!user) {
      res.status(404).json({ status: "error", message: "Student account not found." });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ status: "error", message: "Your account is inactive." });
      return;
    }

    // ---------- YAHAN ADD KARO (password check se pehle bhi chalega) ----------
    const portalError = validatePortalAccess(user.role, "student");
    if (portalError) {
      res.status(403).json({ status: "error", message: portalError });
      return;
    }
    // --------------------------------------------------------------------------

    const passwordMatched = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatched) {
      res.status(401).json({ status: "error", message: "Invalid credentials." });
      return;
    }

    // ---------- PURANA jwt.sign HATAO, YE LIKHO ----------
    const { token, expiresInMs } = signUserToken({
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: [],
      rememberMe: Boolean(rememberMe),
    });

    setPortalAuthCookie(res, "student", token, expiresInMs);
    // -----------------------------------------------------

    res.json({
      status: "success",
      message: "Login successful.",
      data: {
        token,                       // transitional – frontend abhi use kar sakta hai
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatarUrl: user.avatarUrl,
          country: user.country
        }
      }
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
        enrollments: { include: { course: true } },
        payments: { orderBy: { createdAt: "desc" } }
      }
    });

    if (!user) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    const course = user.enrollments[0]?.course;
    const courseTitle = course?.title || "Kathak Dance Advanced";
    const totalFee = course ? (course.groupFeeINR || 12000) : 12000;
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
        nextDueDate: pendingAmount > 0 ? "15th Next Month" : "Cleared",
        transactions: user.payments.map((p) => ({
          id: p.transactionId || `TRA-${p.id.substring(0, 5).toUpperCase()}`,
          date: new Date(p.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
          description: `${courseTitle} - Fee Payment`,
          amount: `₹${p.amount.toLocaleString("en-IN")}`,
          status: p.status,
          statusBadge: p.status === "SUCCESS" ? "text-rose-700 font-bold" : "bg-[#FDEAE2] text-[#C15C3D] px-2.5 py-0.5 rounded-md font-bold text-[10px]"
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
        dueDate: new Date(a.dueDate).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
        status,
        grade: sub?.grade ? `${sub.grade}/100` : "—",
        feedback: sub?.feedback || sub?.notes || null,
        notes: sub?.notes || null,
        fileUrl: sub?.fileUrl
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