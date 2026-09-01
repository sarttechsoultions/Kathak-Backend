import { Request, Response } from "express";
import { Role, Permission, PaymentStatus, CourseCategory, AttendanceStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { sanitizeUser } from "../../lib/authHelpers";
import { sendEmail } from "../../lib/mailer";
import { env } from "../../config/env";
import { buildInvoiceHtml, InvoiceData } from "../../lib/invoice";
import { enrollmentAmountINR } from "../../lib/fees";
import { loadPlatformPayments, summarizePlatformPayments, isSuccessfulStatus } from "../../lib/platform-payments";
import { getTeacherBatchIds } from "../../lib/batchHelpers";


const mapCategoryToEnum = (cat?: string): CourseCategory => {
  if (!cat) return CourseCategory.BASIC;
  const upper = cat.toUpperCase();
  if (upper.includes("INTERMEDIATE") || upper.includes("YOGA")) return CourseCategory.INTERMEDIATE;
  if (upper.includes("PREMIUM") || upper.includes("ADVANCED") || upper.includes("MUSIC")) return CourseCategory.PREMIUM;
  return CourseCategory.BASIC;
};

// ================= 1. DASHBOARD OVERVIEW =================

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // ==========================================
    // 1. TOP OVERVIEW STATS
    // ==========================================
    const [totalStudents, totalTeachers, activeCourses, liveClassesToday] = await Promise.all([
      prisma.user.count({ where: { role: Role.STUDENT } }),
      prisma.user.count({ where: { role: Role.TEACHER } }),
      prisma.course.count({ where: { published: true } }),
      prisma.liveClass.count({
        where: { scheduledStart: { gte: startOfDay, lte: endOfDay } }
      })
    ]);

    // ==========================================
    // 2. REVENUE OVERVIEW (Platform-wide, last 6 months)
    // ==========================================
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const platformPayments = await loadPlatformPayments();
    const platform = summarizePlatformPayments(platformPayments);
    const successfulPayments = platformPayments.filter((row) => isSuccessfulStatus(row.status));

    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const monthlyRevenueData: Record<string, number> = {};

    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      monthlyRevenueData[monthNames[d.getMonth()]] = 0;
    }

    successfulPayments.forEach((payment) => {
      if (payment.createdAt < sixMonthsAgo) return;
      const month = monthNames[payment.createdAt.getMonth()];
      if (monthlyRevenueData[month] !== undefined) {
        monthlyRevenueData[month] += payment.amount;
      }
    });

    const revenueChart = Object.keys(monthlyRevenueData).map((month) => ({
      month,
      revenue: monthlyRevenueData[month],
    }));

    const currentMonth = new Date().getMonth();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const currentMonthRevenue = monthlyRevenueData[monthNames[currentMonth]] || 0;
    const lastMonthRevenue = monthlyRevenueData[monthNames[lastMonth]] || 0;
    let growth = 0;
    if (lastMonthRevenue > 0) {
      growth = ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;
    } else if (currentMonthRevenue > 0) {
      growth = 100;
    }

    // ==========================================
    // 3. ATTENDANCE SUMMARY (For Today)
    // ==========================================
    const todayAttendances = await prisma.attendance.groupBy({
      by: ['status'],
      _count: true,
      where: { date: { gte: startOfDay, lte: endOfDay } }
    });

    let present = 0, absent = 0, leave = 0, totalAtt = 0;
    todayAttendances.forEach(a => {
      totalAtt += a._count;
      if (a.status === "PRESENT" || a.status === "LATE") present += a._count;
      if (a.status === "ABSENT") absent += a._count;
      if (a.status === "LEAVE") leave += a._count;
    });

    const attendanceSummary = {
      presentPercent: totalAtt > 0 ? Math.round((present / totalAtt) * 100) : 0,
      absentPercent: totalAtt > 0 ? Math.round((absent / totalAtt) * 100) : 0,
      leavePercent: totalAtt > 0 ? Math.round((leave / totalAtt) * 100) : 0,
    };

    // ==========================================
    // 4. TODAY'S SCHEDULE
    // ==========================================
    const scheduleRaw = await prisma.liveClass.findMany({
      where: { scheduledStart: { gte: startOfDay, lte: endOfDay } },
      include: { batch: { select: { totalStudents: true } } },
      orderBy: { scheduledStart: "asc" },
      take: 4
    });

    const todaysSchedule = scheduleRaw.map(cls => {
      const start = new Date(cls.scheduledStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const end = new Date(cls.scheduledEnd).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return {
        id: cls.id,
        title: cls.title,
        subtitle: cls.teacherName,
        time: `${start} - ${end}`,
        studentsCount: cls.batch?.totalStudents || 0,
        status: cls.status
      };
    });

    // ==========================================
    // 5. RECENT STUDENTS (With Today's Attendance)
    // ==========================================
    const recentStudentsRaw = await prisma.user.findMany({
      where: { role: Role.STUDENT },
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
        attendances: {
          where: { date: { gte: startOfDay, lte: endOfDay } },
          select: { status: true },
          take: 1
        }
      }
    });

    const recentStudents = recentStudentsRaw.map(s => ({
      id: s.id,
      name: s.fullName,
      avatar: s.avatarUrl,
      // Default to "Present" visually if no attendance marked yet for new students
      status: s.attendances.length > 0 ? s.attendances[0].status : "PRESENT"
    }));

    // ==========================================
    // 6. UNIFIED RECENT ACTIVITIES LOG
    // ==========================================
    const [newStudents, recentSubs, recentClasses] = await Promise.all([
      prisma.user.findMany({ where: { role: Role.STUDENT }, orderBy: { createdAt: 'desc' }, take: 2, select: { id: true, fullName: true, createdAt: true, enrollments: { select: { course: { select: { title: true } } }, take: 1 } } }),
      prisma.assignmentSubmission.findMany({ orderBy: { submittedAt: 'desc' }, take: 2, select: { id: true, studentName: true, assignment: { select: { title: true } }, submittedAt: true } }),
      prisma.liveClass.findMany({ where: { status: 'LIVE' }, orderBy: { updatedAt: 'desc' }, take: 2, select: { id: true, title: true, teacherName: true, updatedAt: true } })
    ]);

    let activities: any[] = [];

    newStudents.forEach(s => activities.push({ id: `stu_${s.id}`, type: "STUDENT", title: `New student ${s.fullName} registered`, subtitle: `Course: ${s.enrollments[0]?.course?.title || 'Basics'}`, time: s.createdAt }));
    recentSubs.forEach(s => activities.push({ id: `sub_${s.id}`, type: "ASSIGNMENT", title: `Assignment submitted by ${s.studentName}`, subtitle: `Topic: ${s.assignment?.title}`, time: s.submittedAt }));
    successfulPayments.slice(0, 4).forEach((p) =>
      activities.push({
        id: `pay_${p.source}_${p.id}`,
        type: "PAYMENT",
        title: `${p.sourceLabel} received from ${p.studentName}`,
        subtitle: `${p.itemTitle} • ₹${p.amount.toLocaleString("en-IN")}`,
        time: p.createdAt,
      })
    );
    recentClasses.forEach(c => activities.push({ id: `cls_${c.id}`, type: "CLASS", title: `Live class '${c.title}' started`, subtitle: `By ${c.teacherName}`, time: c.updatedAt }));

    // Sort all combined activities by date descending and take top 4
    activities = activities.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 4);

    const formattedActivities = activities.map(a => {
      const diffMins = Math.floor((new Date().getTime() - a.time.getTime()) / 60000);
      let timeAgo = diffMins < 60 ? `${diffMins} mins ago` : `${Math.floor(diffMins/60)} hours ago`;
      if (diffMins === 0) timeAgo = "Just now";
      return { id: a.id, type: a.type, title: a.title, subtitle: `${a.subtitle} • ${timeAgo}` };
    });

    // ==========================================
    // FINAL RESPONSE
    // ==========================================
    res.status(200).json({
      status: "success",
      data: {
        overview: {
          totalStudents,
          totalTeachers,
          activeCourses,
          liveClassesToday,
          totalRevenue: platform.platformRevenue,
          courseRevenue: platform.courseRevenue,
          workshopRevenue: platform.workshopRevenue,
          todayRevenue: platform.todayRevenue,
          successCount: platform.successCount,
          totalPayments: platform.totalPayments,
          revenueGrowth: parseFloat(growth.toFixed(1)),
        },
        revenueChart,
        attendanceSummary,
        todaysSchedule,
        recentStudents,
        recentActivities: formattedActivities
      }
    });
  } catch (error: any) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch dashboard statistics." });
  }
};

// ================= 2. STUDENT MANAGEMENT =================

export const getStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    const students = await prisma.user.findMany({
      where: { role: Role.STUDENT },
      include: {
        batchMemberships: { include: { batch: true } },
        enrollments: { include: { course: true } },
        payments: { orderBy: { createdAt: "desc" } }
      },
      orderBy: { createdAt: "desc" }
    });

    const mapped = students.map((student) => ({
      id: student.id,
      displayId: `STU-${student.id.slice(-4).toUpperCase()}`,
      name: student.fullName,
      fullName: student.fullName,
      email: student.email,
      phone: student.phone,
      avatarUrl: student.avatarUrl,
      avatar: student.avatarUrl || "/Ananya.png",
      country: student.country,
      // Real values only — no hardcoded "Kathak Beginner" / "Beginners
      // Morning Zen" / fixed Mon-Wed time shown for every student regardless
      // of their actual enrollment. null/"" when the student genuinely has
      // no course or batch assigned yet, which the frontend can render as
      // "Not enrolled" rather than a fabricated default.
      course: student.enrollments[0]?.course?.title || null,
      batch: student.batchMemberships[0]?.batch?.name || null,
      time: student.batchMemberships[0]?.batch?.schedule || null,
      joiningDate: student.createdAt.toISOString().split("T")[0],
      status: student.isActive ? "Active" : "Inactive",
      isActive: student.isActive,
      role: student.role,
      createdAt: student.createdAt,
      batches: student.batchMemberships.map((m) => ({
        id: m.batch.id,
        name: m.batch.name,
        code: m.batch.code
      })),
      courses: student.enrollments.map((e) => ({
        id: e.course.id,
        title: e.course.title,
        active: e.active
      })),
      payments: student.payments
    }));

    res.json({
      status: "success",
      data: {
        students: mapped,
        metrics: {
          totalStudents: students.length,
          activeNow: students.filter((s) => s.isActive).length,
          newJoined: students.filter((s) => new Date(s.createdAt).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000).length,
          blockedStudents: students.filter((s) => !s.isActive).length
        }
      }
    });
  } catch (error) {
    console.error("Get Students Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch students." });
  }
};

export const getStudentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const student = await prisma.user.findFirst({
      where: { id, role: Role.STUDENT },
      include: {
        batchMemberships: { include: { batch: true } },
        enrollments: { include: { course: true } },
        attendances: { orderBy: { date: "desc" }, take: 20 },
        payments: { orderBy: { createdAt: "desc" } },
        assignmentSubmissions: {                          // 👈 fix
          include: { assignment: true },
          orderBy: { submittedAt: "desc" }
        }
      }
    });

    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    const sanitized = sanitizeUser(student);
    const assignmentSubmissions = (student as any).assignmentSubmissions || [];

    const attendances = (student as any).attendances || [];
    const totalAttendances = attendances.length;
    const presentCount = attendances.filter(
      (a: any) => a.status === "PRESENT" || a.status === "present" || a.status === true
    ).length;
    const attendanceRate = totalAttendances > 0 ? `${Math.round((presentCount / totalAttendances) * 100)}%` : "0%";

    const totalSubmissions = assignmentSubmissions.length;
    const gradedCount = assignmentSubmissions.filter(
      (s: any) => s.status === "GRADED" || s.grade
    ).length;
    const assignmentsScore = `${gradedCount} / ${totalSubmissions || 10}`;

    res.json({
      status: "success",
      data: {
        ...sanitized,
        batchMemberships: (student as any).batchMemberships,
        enrollments: (student as any).enrollments,
        attendances,
        payments: (student as any).payments || [],
        submissions: assignmentSubmissions,
        attendanceRate,
        assignmentsScore
      }
    });
  } catch (error) {
    console.error("Get Student Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student." });
  }
};

export const createStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, phone, password, country, batchId } = req.body;
    if (!fullName || !email || !phone || !password) {
      res.status(400).json({ status: "error", message: "FullName, Email, Phone, and Password are required." });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { phone }] }
    });
    if (existing) {
      res.status(400).json({ status: "error", message: "Email or Phone already registered." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newStudent = await prisma.user.create({
      data: {
        fullName,
        email: email.toLowerCase(),
        phone,
        passwordHash,
        role: Role.STUDENT,
        country: country || "India"
      }
    });

    if (batchId) {
      await prisma.batchStudent.create({
        data: { batchId: String(batchId), studentId: newStudent.id }
      });
      await prisma.batch.update({
        where: { id: String(batchId) },
        data: { totalStudents: { increment: 1 } }
      });
    }

    // --- SEND WELCOME EMAIL ---
    try {
      await sendEmail({
        to: newStudent.email,
        subject: "Welcome to Kathak Academy!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #900C27; text-align: center;">Welcome to Kathak Academy</h2>
            <p>Hi ${newStudent.fullName},</p>
            <p>Your student account has been successfully created by the administration. We are thrilled to have you join us on this beautiful journey of Kathak!</p>
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1B1B24;">Your Login Credentials</h3>
              <p><strong>Login URL:</strong> <a href="${env.frontendUrl}/student/login">${env.frontendUrl}/student/login</a></p>
              <p><strong>Email:</strong> ${newStudent.email}</p>
              <p><strong>Password:</strong> ${password}</p>
            </div>
            <p>Please log in and change your password as soon as possible.</p>
            <br/>
            <p>Warm Regards,</p>
            <p><strong>Kathak Academy Team</strong></p>
          </div>
        `
      });
    } catch (emailErr) {
      console.error("Failed to send welcome email:", emailErr);
    }

    res.status(201).json({ status: "success", message: "Student account created successfully.", data: sanitizeUser(newStudent) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to create student account." });
  }
};

export const updateStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { 
      fullName, 
      email, 
      phone, 
      country, 
      avatarUrl, 
      batchId,
      // 👇 YE NAYE FIELDS ADD KARIYE JO FRONTEND SE AA RAHE HAIN
      dob,
      gender,
      address,
      city,
      region,
      postalCode,
      guardianName,
      relationship,
      emergencyContact,
      isActive
    } = req.body;

    const student = await prisma.user.findFirst({ where: { id, role: Role.STUDENT } });
    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    if (email) {
      const existingEmail = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), NOT: { id } }
      });
      if (existingEmail) {
        res.status(400).json({ status: "error", message: "Email already exists." });
        return;
      }
    }

    if (phone) {
      const existingPhone = await prisma.user.findFirst({
        where: { phone, NOT: { id } }
      });
      if (existingPhone) {
        res.status(400).json({ status: "error", message: "Phone number already exists." });
        return;
      }
    }

    const updatedStudent = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          fullName: fullName ?? undefined,
          email: email ? email.toLowerCase() : undefined,
          phone: phone ?? undefined,
          country: country ?? undefined,
          avatarUrl: avatarUrl ?? undefined,
          // 👇 YAHAN BHI DATABASE DATA MEIN MAP KARIYE
          dob: dob ? new Date(dob) : undefined,
          gender: gender ?? undefined,
          address: address ?? undefined,
          city: city ?? undefined,
          region: region ?? undefined,
          postalCode: postalCode ?? undefined,
          guardianName: guardianName ?? undefined,
          relationship: relationship ?? undefined,
          emergencyContact: emergencyContact ?? undefined,
          isActive: typeof isActive === "boolean" ? isActive : undefined
        }
      });

      if (batchId) {
        const targetBatchId = String(batchId);
        const batch = await tx.batch.findUnique({ where: { id: targetBatchId } });
        if (batch) {
          const oldMemberships = await tx.batchStudent.findMany({ where: { studentId: id } });
          for (const old of oldMemberships) {
            if (old.batchId !== targetBatchId) {
              await tx.batchStudent.delete({
                where: { batchId_studentId: { batchId: old.batchId, studentId: id } }
              });
              await tx.batch.update({
                where: { id: old.batchId },
                data: { totalStudents: { decrement: 1 } }
              });
            }
          }

          const exists = await tx.batchStudent.findUnique({
            where: { batchId_studentId: { batchId: targetBatchId, studentId: id } }
          });
          if (!exists) {
            await tx.batchStudent.create({ data: { batchId: targetBatchId, studentId: id } });
            await tx.batch.update({ where: { id: targetBatchId }, data: { totalStudents: { increment: 1 } } });
          }
        }
      }

      return user;
    });

    res.json({ status: "success", message: "Student updated successfully.", data: sanitizeUser(updatedStudent) });
  } catch (error) {
    console.error("Update Student Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update student." });
  }
};

export const updateStudentPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.trim().length < 6) {
      res.status(400).json({ status: "error", message: "Password must be at least 6 characters long." });
      return;
    }

    const student = await prisma.user.findFirst({ where: { id, role: Role.STUDENT } });
    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id },
      data: { passwordHash }
    });

    res.json({ status: "success", message: "Student password updated successfully." });
  } catch (error) {
    console.error("Update Student Password Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update password." });
  }
};

export const changeStudentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { isActive } = req.body;

    const student = await prisma.user.findFirst({ where: { id, role: Role.STUDENT } });
    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: Boolean(isActive) }
    });

    res.json({ status: "success", message: `Student ${updated.isActive ? "activated" : "deactivated"} successfully.`, data: sanitizeUser(updated) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to update student status." });
  }
};

export const resetStudentPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { newPassword } = req.body;

    if (!newPassword) {
      res.status(400).json({ status: "error", message: "New password is required." });
      return;
    }

    const student = await prisma.user.findFirst({ where: { id, role: Role.STUDENT } });
    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id }, data: { passwordHash } });

    res.json({ status: "success", message: "Password reset successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to reset password." });
  }
};

export const deleteStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    await prisma.$transaction(async (tx) => {
      await tx.batchStudent.deleteMany({ where: { studentId: id } });
      await tx.attendance.deleteMany({ where: { studentId: id } });
      await tx.payment.deleteMany({ where: { userId: id } });
      await tx.enrollment.deleteMany({ where: { userId: id } });
      await tx.inquiry.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });

    res.json({ status: "success", message: "Student deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to delete student." });
  }
};

export const assignStudentBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { batchId } = req.body;
    const targetBatchId = String(batchId);

    if (!batchId) {
      res.status(400).json({ status: "error", message: "batchId is required." });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const oldMemberships = await tx.batchStudent.findMany({ where: { studentId: id } });
      for (const old of oldMemberships) {
        if (old.batchId !== targetBatchId) {
          await tx.batchStudent.delete({
            where: { batchId_studentId: { batchId: old.batchId, studentId: id } }
          });
          await tx.batch.update({
            where: { id: old.batchId },
            data: { totalStudents: { decrement: 1 } }
          });
        }
      }

      const exists = await tx.batchStudent.findUnique({
        where: { batchId_studentId: { batchId: targetBatchId, studentId: id } }
      });

      if (!exists) {
        await tx.batchStudent.create({ data: { batchId: targetBatchId, studentId: id } });
        await tx.batch.update({
          where: { id: targetBatchId },
          data: { totalStudents: { increment: 1 } }
        });
      }
    });

    res.json({ status: "success", message: "Batch assigned to student successfully." });
  } catch (error) {
    console.error("Assign Student Batch Error:", error);
    res.status(500).json({ status: "error", message: "Failed to assign batch." });
  }
};

export const removeStudentBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const batchId = req.params.batchId as string;

    await prisma.batchStudent.deleteMany({
      where: { studentId: id, batchId }
    });
    await prisma.batch.update({
      where: { id: batchId },
      data: { totalStudents: { decrement: 1 } }
    });

    res.json({ status: "success", message: "Batch removed from student." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to remove batch." });
  }
};

export const getBatchStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = req.params.batchId ? (req.params.batchId as string) : undefined;

    // Strict 1-Student 1-Batch DB Enforcer: Clean up any legacy duplicate memberships
    const allMemberships = await prisma.batchStudent.findMany({
      orderBy: { createdAt: "desc" }
    });
    const seenStudents = new Set<string>();
    const duplicateMemberships: { batchId: string; studentId: string }[] = [];

    for (const m of allMemberships) {
      if (seenStudents.has(m.studentId)) {
        duplicateMemberships.push({ batchId: m.batchId, studentId: m.studentId });
      } else {
        seenStudents.add(m.studentId);
      }
    }

    if (duplicateMemberships.length > 0) {
      for (const dup of duplicateMemberships) {
        await prisma.batchStudent.delete({
          where: { batchId_studentId: { batchId: dup.batchId, studentId: dup.studentId } }
        }).catch(() => {});
      }
    }

    // Sync totalStudents count for all batches
    const allBatches = await prisma.batch.findMany();
    for (const b of allBatches) {
      const actualCount = await prisma.batchStudent.count({ where: { batchId: b.id } });
      if (b.totalStudents !== actualCount) {
        await prisma.batch.update({ where: { id: b.id }, data: { totalStudents: actualCount } }).catch(() => {});
      }
    }

    const students = await prisma.batchStudent.findMany({
      where: batchId ? { batchId } : {},
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            country: true,
            isActive: true,
            createdAt: true
          }
        },
        batch: true
      }
    });

    const mappedStudents = await Promise.all(
      students.map(async (bs) => {
        const batchAssignmentsCount = await (prisma as any).assignment.count({
          where: {
            OR: [
              { batchId: bs.batchId },
              { batchName: bs.batch.name },
              { batchName: bs.batch.code }
            ]
          }
        });

        const submittedCount = await (prisma as any).assignmentSubmission.count({
          where: {
            studentId: bs.student.id,
            assignment: {
              OR: [
                { batchId: bs.batchId },
                { batchName: bs.batch.name },
                { batchName: bs.batch.code }
              ]
            }
          }
        });

        return {
          id: bs.student.id,
          fullName: bs.student.fullName,
          email: bs.student.email,
          phone: bs.student.phone,
          avatar: bs.student.avatarUrl || "/Ananya.png",
          studentId: `#KL-2024-${bs.student.id.slice(0, 4).toUpperCase()}`,
          batchName: bs.batch.code || bs.batch.name,
          batchId: bs.batch.id,
          joiningDate: new Date(bs.student.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          assignmentsSubmitted: `${submittedCount}/${batchAssignmentsCount} Submitted`
        };
      })
    );

    res.json({
      status: "success",
      data: mappedStudents
    });
  } catch (error) {
    console.error("Get Batch Students Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch batch students." });
  }
};

// ================= 3. TEACHER MANAGEMENT =================

export const getTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    const teachers = await prisma.user.findMany({
      where: { role: Role.TEACHER },
      include: { batchesAsTeacher: { select: { name: true, code: true } } },
      orderBy: { createdAt: "desc" }
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const classesToday = await prisma.liveClass.count({
      where: { scheduledStart: { gte: startOfDay, lte: endOfDay } },
    });

    const mapped = teachers.map((teacher) => {
      const batchNames = teacher.batchesAsTeacher.map((b) => b.name);
      const initials = teacher.fullName
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

      return {
        id: teacher.id,
        fullName: teacher.fullName,
        name: teacher.fullName,
        email: teacher.email,
        phone: teacher.phone,
        avatarUrl: teacher.avatarUrl,
        avatar: teacher.avatarUrl,
        country: teacher.country,
        isActive: teacher.isActive,
        status: teacher.isActive ? "Active" : "Disabled",
        role: teacher.role,
        expertise: "Kathak Instructor",
        category: "Classical",
        assignedBatches: batchNames,
        batches: batchNames,
        initials,
        createdAt: teacher.createdAt,
      };
    });

    const directory = mapped.map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      initials: teacher.initials,
      expertise: teacher.expertise,
      assignedBatches: teacher.batches,
      status: teacher.status === "Active" ? "Active" : "Inactive",
      category: teacher.category,
      email: teacher.email,
    }));

    res.json({
      status: "success",
      data: {
        teachers: mapped,
        directory,
        metrics: {
          totalTeachers: teachers.length,
          totalActiveFaculty: teachers.filter((t) => t.isActive).length,
          activeFaculty: teachers.filter((t) => t.isActive).length,
          classesToday,
          averageRating: "4.9",
        },
      },
    });
  } catch (error) {
    console.error("Get Teachers Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch teachers." });
  }
};

export const getTeacherById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const teacher = await prisma.user.findFirst({
      where: { id, role: Role.TEACHER },
      include: { batchesAsTeacher: { select: { name: true } } }
    });

    if (!teacher) {
      res.status(404).json({ status: "error", message: "Teacher not found." });
      return;
    }

    res.json({
      status: "success",
      data: {
        ...sanitizeUser(teacher),
        assignedBatches: teacher.batchesAsTeacher.map((b) => b.name),
        batches: teacher.batchesAsTeacher.map((b) => b.name)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch teacher." });
  }
};

export const createTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      fullName, 
      email, 
      phone, 
      password, 
      country, 
      assignedBatches = [],
      bankAccounts = [],
      documents = []
      // permissions destructure hataya
    } = req.body;

    if (!fullName || !email || !phone || !password) {
      res.status(400).json({ 
        status: "error", 
        message: "FullName, Email, Phone, and Password are required." 
      });
      return;
    }

    const existingUser = await prisma.user.findFirst({
      where: { 
        OR: [
          { email: email.toLowerCase() }, 
          { phone }
        ] 
      }
    });

    if (existingUser) {
      res.status(400).json({ 
        status: "error", 
        message: "Email or Phone already exists." 
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newTeacher = await prisma.user.create({
      data: {
        fullName,
        email: email.toLowerCase(),
        phone,
        passwordHash,
        role: Role.TEACHER,
        country: country || "India",
        bankAccounts: Array.isArray(bankAccounts) ? bankAccounts : [],
        documents: Array.isArray(documents) ? documents : []
        // permissions create block hataya
      }
    });

    if (assignedBatches.length > 0) {
      await prisma.batch.updateMany({
        where: {
          name: { in: assignedBatches }
        },
        data: {
          teacherId: newTeacher.id,
          teacherName: newTeacher.fullName
        }
      });
    }

    // --- SEND WELCOME EMAIL ---
    try {
      await sendEmail({
        to: newTeacher.email,
        subject: "Welcome to Kathak Academy, Teacher!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #900C27; text-align: center;">Welcome to the Faculty</h2>
            <p>Hi ${newTeacher.fullName},</p>
            <p>Your Teacher account has been successfully created by the administration. We are thrilled to have you lead our students.</p>
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1B1B24;">Your Login Credentials</h3>
              <p><strong>Login URL:</strong> <a href="${env.frontendUrl}/admin/login">${env.frontendUrl}/admin/login</a></p>
              <p><strong>Email:</strong> ${newTeacher.email}</p>
              <p><strong>Password:</strong> ${password}</p>
            </div>
            <p>Please log in and change your password as soon as possible.</p>
            <br/>
            <p>Warm Regards,</p>
            <p><strong>Kathak Academy Admin</strong></p>
          </div>
        `
      });
    } catch (emailErr) {
      console.error("Failed to send teacher welcome email:", emailErr);
    }

    res.status(201).json({
      status: "success",
      message: "Teacher account created successfully.",
      data: {
        id: newTeacher.id,
        fullName: newTeacher.fullName,
        email: newTeacher.email,
        phone: newTeacher.phone,
        role: newTeacher.role,
        assignedBatches: assignedBatches
        // permissions field hataya
      }
    });
  } catch (error) {
    console.error("Create Teacher Error:", error);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to create teacher." 
    });
  }
};

export const updateTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const {
      fullName,
      email,
      phone,
      country,
      isActive,
      password,
      assignedBatches = [],
      avatarUrl,
      address,
      dob,
      gender,
      joiningDate,
      emergencyContact,
      maritalStatus,
      nationality,
      languagesKnown,
      bankDetails,
      bankAccounts,
      idProofType,
      idProofUrl,
      idProofFileName,
      documents,
      designation,
      primaryExpertise,
      salaryRate,
      // permissions destructure hataya
    } = req.body;

    const teacher = await prisma.user.findFirst({
      where: { id, role: Role.TEACHER },
    });

    if (!teacher) {
      res.status(404).json({ status: "error", message: "Teacher not found." });
      return;
    }

    let emergencyContactValue: string | undefined = undefined;
    if (Array.isArray(emergencyContact) && emergencyContact.length > 0) {
      emergencyContactValue = String(emergencyContact[0]);
    } else if (typeof emergencyContact === "string") {
      emergencyContactValue = emergencyContact;
    }

    await prisma.$transaction(async (tx) => {
      const updateData: any = {
        fullName: fullName ?? undefined,
        email: email ? email.toLowerCase() : undefined,
        phone: phone ?? undefined,
        country: country ?? undefined,
        isActive: typeof isActive === "boolean" ? isActive : undefined,
        avatarUrl: avatarUrl ?? undefined,
        address: address ?? undefined,
        gender: gender ?? undefined,
        emergencyContact: emergencyContactValue,
        maritalStatus: maritalStatus ?? undefined,
        nationality: nationality ?? undefined,
        languagesKnown: languagesKnown ?? undefined,
        bankDetails: Array.isArray(bankDetails) ? bankDetails : undefined,
        bankAccounts: Array.isArray(bankAccounts) ? bankAccounts : undefined,
        idProofType: idProofType ?? undefined,
        idProofUrl: idProofUrl ?? undefined,
        documents: Array.isArray(documents) ? documents : undefined,
        designation: designation ?? undefined,
        primaryExpertise: primaryExpertise ?? undefined,
        salaryRate: salaryRate ?? undefined,
      };

      if (dob) updateData.dob = new Date(dob);
      if (joiningDate) updateData.joiningDate = new Date(joiningDate);

      if (password && typeof password === "string" && password.trim().length >= 6) {
        updateData.passwordHash = await bcrypt.hash(password, 10);
      }

      await tx.user.update({
        where: { id },
        data: updateData,
      });

      // Permissions block poora hataya

      if (Array.isArray(assignedBatches)) {
        await tx.batch.updateMany({
          where: { teacherId: id },
          data: {
            teacherId: null,
            teacherName: "Unassigned",
          },
        });

        if (assignedBatches.length > 0) {
          await tx.batch.updateMany({
            where: {
              name: { in: assignedBatches },
            },
            data: {
              teacherId: id,
              teacherName: fullName || teacher.fullName,
            },
          });
        }
      }
    });

    res.json({
      status: "success",
      message: "Teacher account updated successfully.",
    });
  } catch (error) {
    console.error("Update Teacher Error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to update teacher.",
    });
  }
};

export const deleteTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.$transaction(async (tx) => {
      await tx.teacherPermission.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });

    res.json({ status: "success", message: "Teacher account deleted successfully." });
  } catch (error) {
    console.error("Delete Teacher Error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete teacher." });
  }
};

// ================= 4. COURSE & LESSON MANAGEMENT =================

export const getCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    const courses = await prisma.course.findMany({
      include: { lessons: { orderBy: { orderIndex: "asc" } }, batches: true },
      orderBy: { createdAt: "asc" }
    });

    const mapped = courses.map((c) => ({
      ...c,
      code: c.slug ? `CRS-${c.slug.slice(0, 6).toUpperCase()}` : `CRS-${c.id.slice(-4).toUpperCase()}`,
      level: c.category || "BEGINNER",
      duration: c.groupClassesCount || "12 Sessions",
      status: c.published !== false ? "Active" : "Draft",
      thumbnail: (c as any).thumbnail || "/Ananya.png"
    }));

    res.json({
      status: "success",
      data: {
        courses: mapped,
        metrics: {
          totalCourses: courses.length,
          publishedCourses: courses.filter((c) => c.published).length,
          draftCourses: courses.filter((c) => !c.published).length
        }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch courses." });
  }
};
export const getCourseById = async (req: Request, res: Response): Promise<void> => {
  try {
    // URL parameter se ID nikalenge (e.g., /api/v1/courses/123)
    const id = req.params.id as string;

    // Database se specific course fetch 
    const course = await prisma.course.findUnique({
      where: { id },
      include: { 
        lessons: { orderBy: { orderIndex: "asc" } }, 
        batches: true 
      }
    });

    if (!course) {
      res.status(404).json({ 
        status: "error", 
        message: "Course not found." 
      });
      return;
    }

    const formattedCourse = {
      ...course,
      code: course.slug ? `CRS-${course.slug.slice(0, 6).toUpperCase()}` : `CRS-${course.id.slice(-4).toUpperCase()}`,
      level: course.category || "BEGINNER",
      duration: course.groupClassesCount || "12 Sessions",
      status: course.published !== false ? "Active" : "Draft",
      thumbnail: (course as any).thumbnail || "/Ananya.png" // Agar Prisma schema me thumbnail add nahi hai toh as any
    };

    // Final response bhejenge
    res.json({
      status: "success",
      data: formattedCourse
    });

  } catch (error) {
    console.error("Get Course By ID Error:", error);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to fetch course details." 
    });
  }
};
export const createCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      title, 
      description, 
      category, 
      slug: requestedSlug,
      groupFeeINR, 
      groupFeeUSD, 
      oneToOneFeeINR, 
      oneToOneFeeUSD,
      groupClassesCount,     
      oneToOneClassesCount,
      thumbnail,
       videoUrl   
    } = req.body;

    // 1. Strict Validation
    if (!title || !title.trim()) {
      res.status(400).json({ status: "error", message: "Course title is required." });
      return;
    }

    // 2. Slug Generation — keep a provided slug stable so enroll links keep working
    const baseSlug = String(requestedSlug || title)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
    const slug = requestedSlug
      ? baseSlug
      : `${baseSlug}-${Date.now().toString(36)}`;

    // 3. Database Creation
    const newCourse = await prisma.course.create({
      data: {
        title: title.trim(),
        slug,
        description: description || "",
        category: mapCategoryToEnum(category),
        
        // Fees: Default to 0 instead of random numbers like 4999
        groupFeeINR: Number(groupFeeINR) || 0,
        groupFeeUSD: Number(groupFeeUSD) || 0,
        oneToOneFeeINR: Number(oneToOneFeeINR) || 0,
        oneToOneFeeUSD: Number(oneToOneFeeUSD) || 0,
        
        // Class Counts: Taking dynamic values from frontend based on client's data
        groupClassesCount: groupClassesCount || "", 
        oneToOneClassesCount: oneToOneClassesCount || "",
        thumbnail: thumbnail || null, // Default thumbnail if not provided
        videoUrl: videoUrl || null, // Default empty if not provided
        
        published: true
      }
    });

    res.status(201).json({ status: "success", message: "Course created successfully.", data: newCourse });
  } catch (error: any) {
    console.error("Create Course Error:", error);
    res.status(500).json({ status: "error", message: error.message || "Failed to create course." });
  }
};

export const updateCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { 
           title, 
      description, 
      category, 
      groupFeeINR, 
      groupFeeUSD, 
      oneToOneFeeINR, 
      oneToOneFeeUSD,
      groupClassesCount,     
      oneToOneClassesCount,
      thumbnail,
       videoUrl  
    } = req.body;

    const updated = await prisma.course.update({
      where: { id },
      data: {
        title: title ?? undefined,
        description: description ?? undefined,
        category: category ? mapCategoryToEnum(category) : undefined,
        groupFeeINR: groupFeeINR ? Number(groupFeeINR) : undefined,
        groupFeeUSD: groupFeeUSD ? Number(groupFeeUSD) : undefined,
        oneToOneFeeINR: oneToOneFeeINR ? Number(oneToOneFeeINR) : undefined,
        oneToOneFeeUSD: oneToOneFeeUSD ? Number(oneToOneFeeUSD) : undefined,
        groupClassesCount: groupClassesCount ?? undefined,
        oneToOneClassesCount: oneToOneClassesCount ?? undefined,
        thumbnail: thumbnail ?? undefined,
        videoUrl: videoUrl ?? undefined,
        // published: typeof published === "boolean" ? published : undefined
      }
    });

    res.json({ status: "success", message: "Course updated successfully.", data: updated });
  } catch (error: any) {
    console.error("Update Course Error:", error);
    res.status(500).json({ status: "error", message: error.message || "Failed to update course." });
  }
};

export const deleteCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.course.delete({ where: { id } });
    res.json({ status: "success", message: "Course deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to delete course." });
  }
};

export const addLesson = async (req: Request, res: Response): Promise<void> => {
  try {
    const courseId = req.params.id as string;
    const { title, description, durationSec, bunnyVideoId, videoLibraryId } = req.body;

    const lastLesson = await prisma.lesson.findFirst({
      where: { courseId },
      orderBy: { orderIndex: "desc" }
    });
    const orderIndex = lastLesson ? lastLesson.orderIndex + 1 : 1;

    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title,
        description: description || undefined,
        durationSec: Number(durationSec) || 600,
        orderIndex,
        bunnyVideoId: bunnyVideoId || "sample-bunny-id",
        videoLibraryId: videoLibraryId || "sample-lib-id"
      }
    });

    res.status(201).json({ status: "success", message: "Lesson added successfully.", data: lesson });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to add lesson." });
  }
};

export const deleteLesson = async (req: Request, res: Response): Promise<void> => {
  try {
    const lessonId = req.params.lessonId as string;
    await prisma.lesson.delete({ where: { id: lessonId } });
    res.json({ status: "success", message: "Lesson deleted." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to delete lesson." });
  }
};

// ================= 5. BATCH MANAGEMENT =================
export const getBatches = async (req: Request, res: Response): Promise<void> => {
  try {
    const batches = await prisma.batch.findMany({
      include: {
        students: { include: { student: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true } } } },
        course: true,
        teacher: { select: { id: true, fullName: true, avatarUrl: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    const computeBatchStatus = (schedule?: string, dbStatus?: string) => {
      if (!dbStatus) return "Active";
      const s = dbStatus.toUpperCase();
      return s === "ACTIVE" || s === "ACTIVE" ? "Active" : s === "UPCOMING" ? "Upcoming" : "Completed";
    };

    const mapped = batches.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      courseId: b.courseId || b.course?.id,
      courseName: b.courseName || b.course?.title || "Unassigned Course",
      teacherId: b.teacherId,
      teacherName: b.teacherName || b.teacher?.fullName || "Unassigned",
      schedule: b.schedule || "Not Scheduled",
      level: b.level || "BEGINNER",
      totalStudents: b.totalStudents || b.students.length || 0,
      status: computeBatchStatus(b.schedule || undefined, b.status),
      createdAt: b.createdAt
    }));

    const activeCount = mapped.filter((b) => b.status === "Active").length;
    const completedCount = mapped.filter((b) => b.status === "Completed").length;

    res.json({
      status: "success",
      data: {
        batches: mapped,
        metrics: {
          totalBatches: batches.length,
          activeBatches: activeCount,
          totalStudents: batches.reduce((acc, b) => acc + (b.totalStudents || b.students?.length || 0), 0),
          completedBatches: completedCount,
        }
      }
    });
  } catch (error) {
    console.error("Get Batches Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch batches." });
  }
};

// 🔥 NEW: Controller to fetch a specific batch by ID
export const getBatchById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        course: true,
        teacher: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        students: {
          include: { student: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true } } }
        }
      }
    });

    if (!batch) {
      res.status(404).json({ status: "error", message: "Batch not found." });
      return;
    }

    res.json({ status: "success", data: batch });
  } catch (error) {
    console.error("Get Batch By ID Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch batch details." });
  }
};

export const createBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, code, courseId, teacherId, schedule, level, studentIds } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ status: "error", message: "Batch name is required." });
      return;
    }
    if (!courseId) {
      res.status(400).json({ status: "error", message: "Course selection is required." });
      return;
    }

    const batchCode = code || `KTH-${Date.now().toString().slice(-4).toUpperCase()}`;

    const newBatch = await prisma.$transaction(async (tx) => {
      // 1. Fetch exact details to maintain data integrity
      const course = await tx.course.findUnique({ where: { id: courseId } });
      let teacherName = "Unassigned";
      
      if (teacherId) {
        const teacher = await tx.user.findUnique({ where: { id: teacherId } });
        if (teacher) teacherName = teacher.fullName;
      }

      // 2. Create the batch
      const created = await tx.batch.create({
        data: {
          name: name.trim(),
          code: batchCode,
          courseId: courseId,
          courseName: course?.title || "Unknown Course",
          teacherId: teacherId || null,
          teacherName: teacherName,
          schedule: schedule || null,
          level: level || "BEGINNER",
          totalStudents: Array.isArray(studentIds) ? studentIds.length : 0
        }
      });

      // 3. Assign students if any are provided
      if (Array.isArray(studentIds) && studentIds.length > 0) {
        await tx.batchStudent.createMany({
          data: studentIds.map((sid: string) => ({
            batchId: created.id,
            studentId: sid
          })),
          skipDuplicates: true
        });
      }

      return created;
    });

    res.status(201).json({ status: "success", message: "Batch created successfully.", data: newBatch });
  } catch (error) {
    console.error("Create Batch Error:", error);
    res.status(500).json({ status: "error", message: "Failed to create batch." });
  }
};

export const updateBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, code, courseId, teacherId, schedule, level, status, studentIds } = req.body;

    const existingBatch = await prisma.batch.findUnique({ where: { id } });
    if (!existingBatch) {
      res.status(404).json({ status: "error", message: "Batch not found." });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Update student assignments if a new array is provided
      if (Array.isArray(studentIds)) {
        await tx.batchStudent.deleteMany({ where: { batchId: id } });
        if (studentIds.length > 0) {
          await tx.batchStudent.createMany({
            data: studentIds.map((sid: string) => ({
              batchId: id,
              studentId: sid
            })),
            skipDuplicates: true
          });
        }
      }

      const totalCount = Array.isArray(studentIds) ? studentIds.length : await tx.batchStudent.count({ where: { batchId: id } });

      // Fetch names for denormalized fields if IDs changed
      let newCourseName = existingBatch.courseName;
      if (courseId && courseId !== existingBatch.courseId) {
        const c = await tx.course.findUnique({ where: { id: courseId } });
        if (c) newCourseName = c.title;
      }

      let newTeacherName = existingBatch.teacherName;
      if (teacherId && teacherId !== existingBatch.teacherId) {
        const t = await tx.user.findUnique({ where: { id: teacherId } });
        if (t) newTeacherName = t.fullName;
      }

      return await tx.batch.update({
        where: { id },
        data: {
          name: name ?? undefined,
          code: code ?? undefined,
          courseId: courseId ?? undefined,
          courseName: newCourseName,
          teacherId: teacherId ?? undefined,
          teacherName: newTeacherName,
          schedule: schedule ?? undefined,
          level: level ?? undefined,
          status: status ?? undefined,
          totalStudents: totalCount
        }
      });
    });

    res.json({ status: "success", message: "Batch updated successfully.", data: updated });
  } catch (error) {
    console.error("Update Batch Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update batch." });
  }
};

export const deleteBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.$transaction(async (tx) => {
      await tx.batchStudent.deleteMany({ where: { batchId: id } });
      await tx.batch.delete({ where: { id } });
    });
    res.json({ status: "success", message: "Batch deleted successfully." });
  } catch (error) {
    console.error("Delete Batch Error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete batch." });
  }
};

// ================= 5.5 ASSIGNMENT MANAGEMENT =================

export const getAssignments = async (req: Request, res: Response): Promise<void> => {
  try {
    const assignments = await (prisma as any).assignment.findMany({
      include: {
        batch: true,
        submissions: true,
      },
      orderBy: { createdAt: "desc" },
    });

const mapped = await Promise.all(
  assignments.map(async (a: any) => {
    let teacherName = a.teacherName || "Unknown";
    let teacherAvatar = "/Ananya.png";
    let teacherRole = "Teacher";

    if (a.teacherId) {
      const user = await prisma.user.findUnique({
        where: { id: a.teacherId },
        select: {
          fullName: true,
          avatarUrl: true,
          role: true,
        },
      });

      if (user) {
        teacherName = user.fullName || teacherName;
        teacherAvatar = user.avatarUrl || teacherAvatar;
        teacherRole = user.role === "ADMIN" ? "Admin" : "Teacher";
      }
    }

    return {
      id: a.id,
      teacherName,
      teacherDept: teacherRole,
      teacherAvatar,
      title: a.title,
      typeTag: a.typeTag || "Practical Assessment",
      targetBatch: a.batchName || a.batch?.name || "Kathak Basics",
      dueDate: new Date(a.dueDate).toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }),
      totalStudents: `${a.submissions?.length || 0} Submissions`,
      evaluationCriteria: a.evaluationCriteria || null,
      referenceFileUrl: a.referenceFileUrl || null,
      referenceFileName: a.referenceFileName || null,
      description: a.description || null,
    };
  })
);

    // ---- Real metrics ----
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    let pendingReviews = 0;
    let submissionsThisWeek = 0;
    let totalSubmittedOrGraded = 0;
    let totalExpected = 0;

    for (const a of assignments as any[]) {
      const subs: any[] = a.submissions || [];

      pendingReviews += subs.filter((s) => s.status === "SUBMITTED").length;

      submissionsThisWeek += subs.filter((s) => {
        const t = new Date(s.submittedAt || s.createdAt || 0).getTime();
        return t >= weekAgo;
      }).length;

      totalSubmittedOrGraded += subs.filter(
        (s) => s.status === "SUBMITTED" || s.status === "GRADED"
      ).length;

      const batchSize = a.batch?.totalStudents ?? 0;
      totalExpected += batchSize > 0 ? batchSize : Math.max(subs.length, 1);
    }

    const avgCompletionRate =
      totalExpected > 0
        ? `${Math.round((totalSubmittedOrGraded / totalExpected) * 1000) / 10}%`
        : "0%";

    res.json({
      status: "success",
      data: {
        assignments: mapped,
        records: mapped,
        metrics: {
          totalActive: assignments.length,
          pendingReviews,
          submissionsThisWeek,
          avgCompletionRate,
        },
      },
    });
  } catch (error) {
    console.error("Get Assignments Error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch assignments.",
    });
  }
};

export const createAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      title,
      description,
      dueDate,
      totalPoints,
      status,
    } = req.body;

    const typeTag = req.body.typeTag || req.body.category || "Practical Assessment";
    const referenceFileUrl = req.body.referenceFileUrl || req.body.fileUrl || null;
    const referenceFileName = req.body.referenceFileName || null;
    let evaluationCriteriaStr: string | null = null;
    if (req.body.evaluationCriteria) {
      evaluationCriteriaStr =
        typeof req.body.evaluationCriteria === "string"
          ? req.body.evaluationCriteria
          : JSON.stringify(req.body.evaluationCriteria);
    }

    const userRole = (req.user as any)?.role;
    const teacherId = req.user?.id || null;
    const teacherName =
      (req.user as any)?.fullName ||
      (req.user as any)?.name ||
      "Teacher";

    const requestedBatchIds: string[] = Array.isArray(req.body.batchIds) && req.body.batchIds.length > 0
      ? req.body.batchIds.map((id: unknown) => String(id)).filter(Boolean)
      : req.body.batchId
        ? [String(req.body.batchId)]
        : [];

    if (userRole === "TEACHER" && requestedBatchIds.length > 0 && teacherId) {
      const myBatchIds = await getTeacherBatchIds(teacherId);
      const invalidBatches = requestedBatchIds.filter((batchId) => !myBatchIds.includes(batchId));
      if (invalidBatches.length > 0) {
        res.status(403).json({
          status: "error",
          message: "Access Denied: You can only assign to batches assigned to you.",
        });
        return;
      }
    }

    let targetBatch = req.body.targetBatch;
    if (!targetBatch && Array.isArray(req.body.batches)) {
      targetBatch = req.body.batches.join(", ");
    } else if (!targetBatch && typeof req.body.batches === "string") {
      targetBatch = req.body.batches;
    }

    let batchId: string | null = requestedBatchIds[0] || req.body.batchId || null;

    if (requestedBatchIds.length > 0) {
      const selectedBatches = await (prisma as any).batch.findMany({
        where: { id: { in: requestedBatchIds } },
        select: { id: true, name: true, status: true },
      });

      for (const targetB of selectedBatches) {
        if (targetB?.status) {
          const s = String(targetB.status).toLowerCase();
          if (s === "upcoming" || s === "not started" || s === "pending") {
            res.status(400).json({
              status: "error",
              message: `Cannot assign assignment. Batch "${targetB.name}" has not started yet (Status: ${targetB.status}).`,
            });
            return;
          }
        }
      }

      if (!targetBatch) {
        targetBatch = selectedBatches.map((b: { name: string }) => b.name).join(", ");
      }
    }

    targetBatch = targetBatch || "All Batches";

    if (!batchId && Array.isArray(req.body.batches) && req.body.batches.length > 0) {
      const firstBatchName = String(req.body.batches[0]).trim();
      const foundBatch = await (prisma as any).batch.findFirst({
        where: {
          OR: [{ name: firstBatchName }, { code: firstBatchName }],
        },
      });
      if (foundBatch) batchId = foundBatch.id;
    }

    if (!title || !title.trim()) {
      res.status(400).json({ status: "error", message: "Assignment title is required." });
      return;
    }

const data: any = {
  title: title.trim(),
  description: description || "Complete Tatkar practice video.",
  typeTag: typeTag || "Practical Assessment",
  batchName: targetBatch || "All Batches",
  dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  totalPoints: totalPoints ? Number(totalPoints) : 100,
  referenceFileUrl: referenceFileUrl || null,
  referenceFileName: referenceFileName || null,
  evaluationCriteria: evaluationCriteriaStr,
  teacherId,
  teacherName,
};

    if (batchId) {
      data.batch = { connect: { id: batchId } };
    }

    // Agar teacher relation Prisma mein defined hai to connect bhi kar sakte ho:
    // if (teacherId) {
    //   data.teacher = { connect: { id: teacherId } };
    // }

    const assignment = await (prisma as any).assignment.create({ data });

    // --- BROADCAST NOTIFICATION ---
    try {
      const notifyBatchIds = requestedBatchIds.length > 0 ? requestedBatchIds : batchId ? [batchId] : [];

      if (notifyBatchIds.length > 0) {
        const studentsInBatch = await (prisma as any).batchStudent.findMany({
          where: { batchId: { in: notifyBatchIds } },
          select: { studentId: true },
        });

        const uniqueStudentIds = [...new Set(studentsInBatch.map((s: { studentId: string }) => s.studentId))];

        if (uniqueStudentIds.length > 0) {
          const notifications = uniqueStudentIds.map((studentId) => ({
            userId: studentId,
            type: "ANNOUNCEMENT",
            title: `New Assignment: ${assignment.title}`,
            message: `A new assignment "${assignment.title}" has been posted for your batch.`,
            link: "/student/assignments",
          }));
          await (prisma as any).notification.createMany({ data: notifications });
        }
      } else {
        // Broadcast to all active students if no batch specified
        const allStudents = await (prisma as any).user.findMany({
          where: { role: "STUDENT", isActive: true },
          select: { id: true },
        });
        if (allStudents.length > 0) {
          const notifications = allStudents.map((s: any) => ({
            userId: s.id,
            type: "ANNOUNCEMENT",
            title: `New Assignment: ${assignment.title}`,
            message: `A new global assignment "${assignment.title}" has been posted.`,
            link: "/student/assignments",
          }));
          await (prisma as any).notification.createMany({ data: notifications });
        }
      }
    } catch (notifErr) {
      console.error("Failed to send assignment notifications:", notifErr);
    }

    res.status(201).json({
      status: "success",
      message: "Assignment created successfully.",
      data: assignment,
    });
  } catch (error) {
    console.error("Create Assignment Error:", error);
    res.status(500).json({ status: "error", message: "Failed to create assignment." });
  }
};

export const getAssignmentSubmissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const submissions = await (prisma as any).assignmentSubmission.findMany({
      include: {
        assignment: true,
        student: { select: { id: true, fullName: true, email: true, avatarUrl: true } }
      },
      orderBy: { submittedAt: "desc" }
    });

    const mapped = submissions.map((s: any) => ({
      id: s.id,
      assignmentId: s.assignment?.id,
      studentName: s.studentName || s.student?.fullName || "Student",
      studentId: `#STU-${s.studentId.substring(0, 4).toUpperCase()}`,
      studentAvatar: s.student?.avatarUrl || "/Ananya.png",
      assignmentTitle: s.assignment?.title || "Practical Exercise",
      batch: s.assignment?.batchName || "Kathak Basics",
      submittedDate: new Date(s.submittedAt).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      status: s.status === "GRADED" ? "Submitted" : s.status === "OVERDUE" ? "Overdue" : "Submitted",
      grade: s.grade,
      feedback: s.feedback,
      notes: s.notes,
      fileUrl: s.fileUrl
    }));

    res.json({
      status: "success",
      data: {
        submissions: mapped,
        records: mapped
      }
    });
  } catch (error) {
    console.error("Get Assignment Submissions Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch assignment submissions." });
  }
};

export const gradeAssignmentSubmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { grade, feedback, comment, criteria, criteriaParts, pointers } = req.body;

    const gradeMatch = String(grade ?? "").match(/\d+/);
    const numericGrade = gradeMatch ? gradeMatch[0] : "0";

    let feedbackStr: string;
    if (typeof feedback === "object" && feedback !== null) {
      feedbackStr = JSON.stringify(feedback);
    } else if (typeof feedback === "string" && feedback.trim().startsWith("{")) {
      feedbackStr = feedback;
    } else {
      const parts = Array.isArray(criteriaParts)
        ? criteriaParts
        : Array.isArray(criteria)
          ? criteria
          : [];
      feedbackStr = JSON.stringify({
        comment: comment || (typeof feedback === "string" ? feedback : "") || "",
        criteriaParts: parts.map((p: { name?: string; label?: string; score?: number | string }) => ({
          name: p.name || p.label || "Criteria",
          score: Number(p.score) || 0,
        })),
        pointers: Array.isArray(pointers) ? pointers.filter(Boolean) : [],
      });
    }

    const updated = await (prisma as any).assignmentSubmission.update({
      where: { id },
      data: {
        grade: numericGrade,
        feedback: feedbackStr,
        status: "GRADED",
      },
    });

    res.json({ status: "success", message: "Submission graded successfully.", data: updated });
  } catch (error) {
    console.error("Grade Submission Error:", error);
    res.status(500).json({ status: "error", message: "Failed to grade submission." });
  }
};

export const reassignAssignmentSubmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason, comment } = req.body;
    const reassignComment =
      (typeof reason === "string" && reason.trim()) ||
      (typeof comment === "string" && comment.trim()) ||
      "Please redo this assignment and submit again.";

    const updated = await (prisma as any).assignmentSubmission.update({
      where: { id },
      data: {
        status: "PENDING",
        grade: null,
        fileUrl: null,
        feedback: JSON.stringify({
          type: "reassign",
          comment: reassignComment,
          requestedAt: new Date().toISOString(),
        }),
      },
    });

    res.json({
      status: "success",
      message: "Submission sent back to the student for reassignment.",
      data: updated,
    });
  } catch (error) {
    console.error("Reassign Submission Error:", error);
    res.status(500).json({ status: "error", message: "Failed to request reassignment." });
  }
};
export const getAssignmentDetails = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
const id = req.params.id as string;
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        batch: true,
        submissions: {
          include: {
            student: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!assignment) {
      res.status(404).json({
        status: "error",
        message: "Assignment not found",
      });
      return;
    }

    let teacherName = assignment.teacherName || "Aswini";
    let teacherDept = "Classical Dance Dept.";
    let teacherAvatar = "/Ananya.png";
    let teacherDesignation = "Senior Faculty";

    if (assignment.teacherId) {
      const user = await prisma.user.findUnique({
        where: { id: assignment.teacherId },
        select: {
          fullName: true,
          avatarUrl: true,
          role: true,
        },
      });

      if (user) {
        teacherName = user.fullName || teacherName;
        teacherAvatar = user.avatarUrl || teacherAvatar;
        teacherDesignation = user.role === "ADMIN" ? "Faculty Lead" : "Senior Faculty";
      }
    }

    res.json({
      status: "success",
      data: {
        ...assignment,
        teacherName,
        teacherDept,
        teacherAvatar,
        teacherDesignation,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to fetch assignment details",
    });
  }
};

export const getAssignmentSubmissionsByAssignment = async (
  req: Request,
  res: Response
) => {
  try {
const id = req.params.id as string;
    const submissions = await (prisma as any).assignmentSubmission.findMany({
      where: {
        assignmentId: id,
      },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
        assignment: true,
      },
      orderBy: { submittedAt: "desc" },
    });

    const mapped = submissions.map((s: any) => ({
      id: s.id,
      assignmentId: s.assignment?.id || s.assignmentId,
      studentName: s.studentName || s.student?.fullName || "Student",
      studentId: `#STU-${(s.studentId || s.student?.id || "0000").substring(0, 4).toUpperCase()}`,
      studentAvatar: s.student?.avatarUrl || "/Ananya.png",
      assignmentTitle: s.assignment?.title || "Practical Exercise",
      batch: s.assignment?.batchName || s.assignment?.targetBatch || "Kathak Basics",
      submittedDate: s.submittedAt
        ? new Date(s.submittedAt).toLocaleString("en-US", {
            month: "short",
            day: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Aug 05, 2026",
      status: s.status === "GRADED" ? "Submitted" : "Submitted",
      grade: s.grade,
      feedback: s.feedback,
      notes: s.notes,
      fileUrl: s.fileUrl,
    }));

    res.json({
      status: "success",
      data: {
        submissions: mapped,
        records: mapped,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to fetch submissions",
    });
  }
};
// ================= 6. ATTENDANCE MANAGEMENT =================

export const getAttendanceRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = req.query.batchId as string;
    const dateStr = req.query.date as string;
    const sessionStr = (req.query.session as string) || "Morning Session";

    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const allBatches = await prisma.batch.findMany({
      orderBy: { name: "asc" }
    });

    let records: any[] = [];

    if (batchId) {
      const batchStudents = await prisma.batchStudent.findMany({
        where: { batchId },
        include: {
          student: true,
          batch: { include: { course: true } }
        }
      });

      const existingAttendances = await prisma.attendance.findMany({
        where: {
          batchId,
          date: { gte: dayStart, lte: dayEnd }
        }
      });

      records = batchStudents.map((bs) => {
        const att = existingAttendances.find((a) => a.studentId === bs.studentId);
        let status = "U"; // Default Unmarked

        if (att) {
          if (att.status === "PRESENT") status = "P";
          else if (att.status === "ABSENT") status = "A";
          else if (att.status === "LATE") status = "L";
          else if (att.status === "LEAVE") status = "LV";
        }

        return {
          id: att ? att.id : `temp-${bs.studentId}`,
          studentId: `STU-${bs.student.id.substring(0, 4).toUpperCase()}`,
          rawStudentId: bs.student.id,
          name: bs.student.fullName,
          email: bs.student.email,
          avatar: bs.student.avatarUrl || "/Ananya.png",
          batchCode: bs.batch.code,
          courseName: bs.batch.courseName || bs.batch.course?.title || "Kathak Basics",
          status
        };
      });
    }

    const batchAnalytics = await Promise.all(
      allBatches.map(async (b) => {
        const total = await prisma.batchStudent.count({ where: { batchId: b.id } });
        const presentCount = await prisma.attendance.count({
          where: { 
            batchId: b.id, 
            status: { in: ["PRESENT", "LATE"] },
            date: { gte: dayStart, lte: dayEnd },
            session: sessionStr ? String(sessionStr) : undefined
          }
        });
        const rate = total > 0 ? Math.round((presentCount / total) * 100) : 0;
        return { id: b.id, name: b.name, rate };
      })
    );

    res.json({
      status: "success",
      data: {
        records,
        attendanceRecords: records,
        batchAnalytics
      }
    });
  } catch (error) {
    console.error("Get Attendance Records Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch attendance records." });
  }
};

export const saveAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    const { batchId, date, session, records } = req.body;

    if (!batchId || !Array.isArray(records)) {
      res.status(400).json({ status: "error", message: "Batch and attendance records array are required." });
      return;
    }

    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      res.status(404).json({ status: "error", message: "Batch not found." });
      return;
    }

    const targetDate = date ? new Date(date) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    if (dayStart > todayStart) {
      res.status(400).json({ status: "error", message: "Cannot mark attendance for a future date." });
      return;
    }

    const batchStartOfDay = new Date(batch.createdAt);
    batchStartOfDay.setHours(0, 0, 0, 0);

    if (dayStart < batchStartOfDay) {
      res.status(400).json({ status: "error", message: "Cannot mark attendance for a date before the batch was created." });
      return;
    }

    const batchStudents = await prisma.batchStudent.findMany({ where: { batchId } });
    const studentEnrollmentMap = new Map();
    for (const bs of batchStudents) {
      const d = new Date(bs.createdAt);
      d.setHours(0, 0, 0, 0);
      studentEnrollmentMap.set(bs.studentId, d);
    }

    let savedCount = 0;

    for (const r of records) {
      const studentId = r.rawStudentId || r.studentId;
      if (!studentId || r.status === "U") continue;

      const enrolledDate = studentEnrollmentMap.get(studentId);
      if (enrolledDate && dayStart < enrolledDate) {
         continue; // Skip marking attendance for dates before student was enrolled
      }

      let dbStatus: AttendanceStatus = AttendanceStatus.PRESENT;
      if (r.status === "A") dbStatus = AttendanceStatus.ABSENT;
      else if (r.status === "L") dbStatus = AttendanceStatus.LATE;
      else if (r.status === "LV") dbStatus = AttendanceStatus.LEAVE;

      const existing = await prisma.attendance.findFirst({
        where: {
          studentId,
          batchId,
          date: { gte: dayStart, lte: dayEnd }
        }
      });

      if (existing) {
        await prisma.attendance.update({
          where: { id: existing.id },
          data: { status: dbStatus, session: session || "Morning Session" }
        });
      } else {
        await prisma.attendance.create({
          data: {
            studentId,
            studentName: r.name || "Student",
            batchId,
            batchName: batch?.name || "General Batch",
            session: session || "Morning Session",
            date: targetDate,
            status: dbStatus,
            remarks: "Manually marked by admin"
          }
        });
      }
    }

    res.status(200).json({ status: "success", message: "Attendance saved successfully." });
  } catch (error) {
    console.error("Save Attendance Error:", error);
    res.status(500).json({ status: "error", message: "Failed to save attendance records." });
  }
};

// ================= 7. PAYMENTS & FINANCE =================

export const getPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const students = await prisma.user.findMany({
      where: { role: Role.STUDENT },
      include: {
        enrollments: { include: { course: true } },
        payments: { where: { status: PaymentStatus.SUCCESS }, orderBy: { createdAt: "desc" } },
        batchMemberships: { include: { batch: true } }
      }
    });

    let totalFeeAmount = 0;
    let amountReceived = 0;
    let paidStudentsCount = 0;
    let pendingStudentsCount = 0;

    const studentFinanceRecords = students.map((s) => {
      const course = s.enrollments[0]?.course;
      const courseName = course?.title || null;
      // A student with no course enrollment has no fee to owe — don't
      // fabricate a ₹12,000 charge for them (that previously counted every
      // unenrolled account as a pending debtor and inflated totalFeeAmount /
      // pendingStudentsCount on the finance dashboard).
      const totalFee = course ? enrollmentAmountINR(course.groupFeeINR) : 0;
      const paid = s.payments.reduce((acc, p) => acc + p.amount, 0);
      const pending = Math.max(0, totalFee - paid);

      totalFeeAmount += totalFee;
      amountReceived += paid;

      if (course) {
        if (pending === 0) {
          paidStudentsCount++;
        } else {
          pendingStudentsCount++;
        }
      }

      const batchName = s.batchMemberships[0]?.batch?.name || s.batchMemberships[0]?.batch?.code || null;
      const lastPayment = s.payments[0];
      const statusLabel = !course ? "No Enrollment" : pending === 0 ? "Paid" : paid > 0 ? "Partial" : "Pending";

      return {
        id: s.id,
        studentIdCode: `STU-${s.id.substring(0, 4).toUpperCase()}`,
        studentName: s.fullName,
        studentAvatar: s.avatarUrl || "/Ananya.png",
        email: s.email,
        phone: s.phone,
        country: s.country,
        city: s.city,
        region: s.region,
        address: s.address,
        joiningDate: s.joiningDate,
        paymentMethod: s.paymentMethod,
        course: courseName,
        batch: batchName,
        totalFees: `₹${totalFee.toLocaleString("en-IN")}`,
        paidAmount: `₹${paid.toLocaleString("en-IN")}`,
        pendingAmount: `₹${pending.toLocaleString("en-IN")}`,
        rawTotal: totalFee,
        rawPaid: paid,
        rawPending: pending,
        statusLabel,
        lastPaymentId: lastPayment?.id || null,
        lastTransactionId: lastPayment?.transactionId || null,
        lastPaymentDate: lastPayment?.createdAt || null,
        lastGateway: lastPayment?.gateway || null,
      };
    });

    const platformPayments = await loadPlatformPayments();
    const platform = summarizePlatformPayments(platformPayments);

    res.json({
      status: "success",
      data: {
        totalRevenue: platform.platformRevenue,
        payments: platformPayments,
        platformPayments,
        financeList: studentFinanceRecords,
        records: studentFinanceRecords,
        metrics: {
          totalStudents: students.length || studentFinanceRecords.length,
          paidStudents: paidStudentsCount,
          pendingStudents: pendingStudentsCount,
          totalFeeAmount,
          amountReceived,
          pendingAmount: Math.max(0, totalFeeAmount - amountReceived),
          overdueCount: studentFinanceRecords.filter((r) => r.rawPending > 5000).length,
          overdueAmount: studentFinanceRecords.reduce((acc, r) => acc + (r.rawPending > 5000 ? r.rawPending : 0), 0),
          partialCount: studentFinanceRecords.filter((r) => r.rawPaid > 0 && r.rawPending > 0).length,
          partialAmount: studentFinanceRecords.reduce((acc, r) => acc + (r.rawPaid > 0 ? r.rawPending : 0), 0),
          platformRevenue: platform.platformRevenue,
          courseRevenue: platform.courseRevenue,
          workshopRevenue: platform.workshopRevenue,
          totalPayments: platform.totalPayments,
          successCount: platform.successCount,
          pendingCount: platform.pendingCount,
          todayRevenue: platform.todayRevenue,
        },
        todaysPayments: platform.todaysPayments,
      }
    });
  } catch (error) {
    console.error("Get Payments Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch payments." });
  }
};

export const recordFeePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { studentId, amount, gateway, transactionId } = req.body;
    if (!studentId || !amount || Number(amount) <= 0) {
      res.status(400).json({ status: "error", message: "Student and valid payment amount are required." });
      return;
    }

    const txId = transactionId || `TXN-${Date.now().toString(36).toUpperCase()}`;
    const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`;

    const payment = await prisma.payment.create({
      data: {
        userId: studentId,
        amount: Number(amount),
        currency: "INR",
        gateway: gateway || "MANUAL_CASH",
        transactionId: txId,
        orderId,
        status: PaymentStatus.SUCCESS
      }
    });

    // Fetch student to send email
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { fullName: true, email: true }
    });

    if (student && student.email) {
      try {
        await sendEmail({
          to: student.email,
          subject: "Kathak Academy - Payment Receipt",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
              <h2 style="color: #900C27; text-align: center;">Payment Receipt</h2>
              <p>Hi ${student.fullName},</p>
              <p>We have successfully received your payment. Thank you!</p>
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="border-bottom: 1px solid #ddd;">
                  <td style="padding: 10px 0;"><strong>Amount Paid:</strong></td>
                  <td style="padding: 10px 0; text-align: right;">₹${amount}</td>
                </tr>
                <tr style="border-bottom: 1px solid #ddd;">
                  <td style="padding: 10px 0;"><strong>Transaction ID:</strong></td>
                  <td style="padding: 10px 0; text-align: right;">${txId}</td>
                </tr>
                <tr style="border-bottom: 1px solid #ddd;">
                  <td style="padding: 10px 0;"><strong>Method:</strong></td>
                  <td style="padding: 10px 0; text-align: right;">${gateway || "MANUAL_CASH"}</td>
                </tr>
              </table>
              <p>You can view and download your full digital receipt anytime from your Student Dashboard under the Finance section.</p>
              <br/>
              <p>Warm Regards,</p>
              <p><strong>Kathak Academy Team</strong></p>
            </div>
          `
        });
      } catch (emailErr) {
        console.error("Failed to send payment receipt:", emailErr);
      }
    }

    res.status(201).json({ status: "success", message: "Fee payment recorded successfully.", data: payment });
  } catch (error) {
    console.error("Record Payment Error:", error);
    res.status(500).json({ status: "error", message: "Failed to record payment." });
  }
};

export const refundPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const updated = await prisma.payment.update({
      where: { id },
      data: { status: PaymentStatus.REFUNDED }
    });

    res.json({ status: "success", message: "Payment status marked as Refunded.", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to process refund." });
  }
};

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const paymentToInvoice = (payment: {
  id: string;
  amount: number;
  currency: string;
  gateway: string;
  transactionId: string;
  orderId: string;
  status: string;
  createdAt: Date;
  user?: {
    fullName: string;
    email: string;
    phone: string;
    address?: string | null;
    paymentMethod?: string | null;
    batchMemberships?: { batch?: { name?: string | null; code?: string | null } | null }[];
  } | null;
  enrollment?: { course?: { title?: string | null } | null } | null;
}): InvoiceData => ({
  invoiceNumber: `INV-${(payment.transactionId || payment.id).slice(-10).toUpperCase()}`,
  issuedAt: payment.createdAt,
  studentName: payment.user?.fullName || "Student",
  studentEmail: payment.user?.email || "",
  studentPhone: payment.user?.phone || "",
  studentAddress: payment.user?.address,
  courseTitle: payment.enrollment?.course?.title || "Kathak Course Enrollment",
  batchName: payment.user?.batchMemberships?.[0]?.batch?.name || payment.user?.batchMemberships?.[0]?.batch?.code || null,
  amount: payment.amount,
  currency: String(payment.currency || "INR"),
  gateway: payment.gateway,
  paymentMethod: payment.user?.paymentMethod || payment.gateway,
  transactionId: payment.transactionId,
  orderId: payment.orderId,
  status: payment.status,
});

export const getPaymentInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        user: {
          include: { batchMemberships: { include: { batch: true } } },
        },
        enrollment: { include: { course: true } },
      },
    });

    if (!payment) {
      res.status(404).json({ status: "error", message: "Payment not found." });
      return;
    }

    const html = buildInvoiceHtml(paymentToInvoice(payment));
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${`INV-${(payment.transactionId || payment.id).slice(-10)}.html`}"`);
    res.send(html);
  } catch (error) {
    console.error("Get payment invoice error:", error);
    res.status(500).json({ status: "error", message: "Failed to generate invoice." });
  }
};

export const exportFinanceCsv = async (req: Request, res: Response): Promise<void> => {
  try {
    const platformPayments = await loadPlatformPayments();

    const headers = [
      "Type",
      "Payment Date",
      "Student / Payer",
      "Email",
      "Phone",
      "Course / Workshop",
      "Transaction ID",
      "Order ID",
      "Gateway",
      "Status",
      "Amount",
      "Currency",
    ];

    const rows = platformPayments.map((payment) =>
      [
        payment.sourceLabel,
        new Date(payment.createdAt).toLocaleString("en-IN"),
        payment.studentName,
        payment.email,
        payment.phone,
        payment.itemTitle,
        payment.transactionId,
        payment.orderId,
        payment.gateway,
        payment.status,
        payment.amount,
        payment.currency,
      ]
        .map(csvCell)
        .join(",")
    );

    const csv = `\uFEFF${headers.join(",")}\n${rows.join("\n")}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="Kathak_Platform_Payments_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error("Export finance CSV error:", error);
    res.status(500).json({ status: "error", message: "Failed to export finance CSV." });
  }
};

// ================= 8. INQUIRIES MANAGEMENT =================

export const getInquiries = async (req: Request, res: Response): Promise<void> => {
  try {
    const inquiries = await prisma.inquiry.findMany({
      orderBy: { createdAt: "desc" }
    });

    res.json({
      status: "success",
      data: {
        inquiries,
        leads: inquiries
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch inquiries." });
  }
};

export const updateInquiryStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    const updated = await prisma.inquiry.update({
      where: { id },
      data: { status: status || "CLOSED" }
    });

    res.json({ status: "success", message: "Inquiry status updated.", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to update inquiry." });
  }
};

export const deleteInquiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.inquiry.delete({ where: { id } });
    res.json({ status: "success", message: "Inquiry deleted." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to delete inquiry." });
  }
};

export const replyToInquiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ status: "error", message: "Reply message is required." });
      return;
    }

    // Update status to RESOLVED since we've replied
    const updated = await prisma.inquiry.update({
      where: { id },
      data: { status: "RESOLVED" }
    });

    const emailSent = await sendEmail({
      to: updated.contactInfo,
      subject: `Re: ${updated.subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #900C27;">Support Response</h2>
          <p>Hi ${updated.fullName},</p>
          <p>Thank you for reaching out. Here is our response regarding your inquiry: <strong>"${updated.subject}"</strong></p>
          <div style="background-color: #f9f9f9; border-left: 4px solid #900C27; padding: 15px; margin: 20px 0;">
            <p style="white-space: pre-wrap; margin: 0;">${message}</p>
          </div>
          <p>If you have any further questions, feel free to submit another ticket or reply to this email.</p>
          <br />
          <p>Best regards,</p>
          <p><strong>Kathak Academy Team</strong></p>
        </div>
      `
    });

    res.json({ 
      status: "success", 
      message: emailSent ? "Reply sent successfully via Email." : "Status updated, but failed to send email.", 
      data: updated 
    });
  } catch (error) {
    console.error("Reply to Inquiry Error:", error);
    res.status(500).json({ status: "error", message: "Failed to send reply." });
  }
};

// ================= 9. ADMIN PROFILE =================

export const getAdminProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id }
    });

    if (!user) {
      res.status(404).json({ status: "error", message: "Admin user not found." });
      return;
    }

    res.json({ status: "success", data: sanitizeUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch profile." });
  }
};

export const updateAdminProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, phone, avatarUrl } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        fullName: fullName ?? undefined,
        email: email ? email.toLowerCase() : undefined,
        phone: phone ?? undefined,
        avatarUrl: avatarUrl ?? undefined
      }
    });

    res.json({ status: "success", message: "Admin profile updated.", data: sanitizeUser(updated) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to update profile." });
  }
};

export const changeAdminPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ status: "error", message: "Current and new password are required." });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ status: "error", message: "Admin user not found." });
      return;
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      res.status(400).json({ status: "error", message: "Current password is incorrect." });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash: newHash }
    });

    res.json({ status: "success", message: "Password changed successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to change password." });
  }
};

