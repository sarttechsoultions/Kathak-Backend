import { Request, Response } from "express";
import { Role, Permission, PaymentStatus, CourseCategory } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";

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
    const totalStudents = await prisma.user.count({ where: { role: Role.STUDENT } });
    const totalTeachers = await prisma.user.count({ where: { role: Role.TEACHER } });
    const activeCourses = await prisma.course.count({ where: { published: true } });
    const totalBatches = await prisma.batch.count();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const liveClassesToday = await prisma.liveClass.count({
      where: {
        scheduledStart: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    });

    const revenueResult = await prisma.payment.aggregate({
      where: { status: PaymentStatus.SUCCESS },
      _sum: { amount: true }
    });
    const revenueVal = revenueResult._sum.amount || 0;

    const totalAttendanceCount = await prisma.attendance.count();
    const presentAttendanceCount = await prisma.attendance.count({ where: { status: "PRESENT" } });
    const attendanceRateNum = totalAttendanceCount > 0 ? Math.round((presentAttendanceCount / totalAttendanceCount) * 100) : 95;

    const recentInquiries = await prisma.inquiry.findMany({
      take: 5,
      orderBy: { createdAt: "desc" }
    });

    const recentStudents = await prisma.user.findMany({
      where: { role: Role.STUDENT },
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        createdAt: true
      }
    });

    const recentPayments = await prisma.payment.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { fullName: true, email: true } },
        enrollment: { include: { course: { select: { title: true } } } }
      }
    });

    res.status(200).json({
      status: "success",
      data: {
        overview: {
          totalStudents,
          totalTeachers,
          activeCourses,
          totalBatches,
          liveClassesToday,
          totalRevenue: `₹${revenueVal.toLocaleString("en-IN")}`,
          attendanceRate: `${attendanceRateNum}%`
        },
        recentStudents,
        recentInquiries,
        recentPayments
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
      course: student.enrollments[0]?.course?.title || "Kathak Beginner",
      batch: student.batchMemberships[0]?.batch?.name || "Beginners Morning Zen",
      time: "Mon, Wed (06:00 PM)",
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
        payments: { orderBy: { createdAt: "desc" } }
      }
    });

    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    res.json({ status: "success", data: student });
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

    res.status(201).json({ status: "success", message: "Student account created successfully.", data: newStudent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to create student account." });
  }
};

export const updateStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { fullName, email, phone, country, avatarUrl, batchId } = req.body;

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
          avatarUrl: avatarUrl ?? undefined
        }
      });

      if (batchId) {
        const targetBatchId = String(batchId);
        const batch = await tx.batch.findUnique({ where: { id: targetBatchId } });
        if (batch) {
          const oldMembership = await tx.batchStudent.findFirst({ where: { studentId: id } });
          if (oldMembership && oldMembership.batchId !== targetBatchId) {
            await tx.batchStudent.delete({
              where: { batchId_studentId: { batchId: oldMembership.batchId, studentId: id } }
            });
            await tx.batch.update({
              where: { id: oldMembership.batchId },
              data: { totalStudents: { decrement: 1 } }
            });
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

    res.json({ status: "success", message: "Student updated successfully.", data: updatedStudent });
  } catch (error) {
    console.error("Update Student Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update student." });
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

    res.json({ status: "success", message: `Student ${updated.isActive ? "activated" : "deactivated"} successfully.`, data: updated });
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

    const exists = await prisma.batchStudent.findUnique({
      where: { batchId_studentId: { batchId: targetBatchId, studentId: id } }
    });

    if (!exists) {
      await prisma.batchStudent.create({ data: { batchId: targetBatchId, studentId: id } });
      await prisma.batch.update({
        where: { id: targetBatchId },
        data: { totalStudents: { increment: 1 } }
      });
    }

    res.json({ status: "success", message: "Batch assigned to student successfully." });
  } catch (error) {
    console.error(error);
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

    res.json({
      status: "success",
      data: students.map((bs) => ({
        id: bs.student.id,
        fullName: bs.student.fullName,
        name: bs.student.fullName,
        email: bs.student.email,
        phone: bs.student.phone,
        avatar: bs.student.avatarUrl || "/Ananya.png",
        batchId: bs.batchId,
        batchName: bs.batch.name
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch batch students." });
  }
};

// ================= 3. TEACHER MANAGEMENT =================

export const getTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    const teachers = await prisma.user.findMany({
      where: { role: Role.TEACHER },
      include: { permissions: true },
      orderBy: { createdAt: "desc" }
    });

    const mapped = teachers.map((teacher) => ({
      id: teacher.id,
      fullName: teacher.fullName,
      name: teacher.fullName,
      title: "Senior Kathak Faculty",
      email: teacher.email,
      phone: teacher.phone,
      avatarUrl: teacher.avatarUrl,
      avatar: teacher.avatarUrl || "/Ananya.png",
      country: teacher.country,
      isActive: teacher.isActive,
      status: teacher.isActive ? "Active" : "Disabled",
      role: teacher.role,
      designation: "Senior Kathak Faculty",
      assignedBatches: ["Beginners Morning Zen"],
      batches: ["Beginners Morning Zen"],
      id_proof: "Verified",
      qualifications: ["MA in Kathak", "Sangeet Visharad"],
      bank_details: ["HDFC Bank **** 4321"],
      emergency_contact: [9876543210],
      category: "Kathak",
      expertise: "Senior Kathak Instructor",
      permissions: teacher.permissions.map((p) => p.permission),
      createdAt: teacher.createdAt
    }));

    res.json({
      status: "success",
      data: {
        teachers: mapped,
        metrics: {
          totalTeachers: teachers.length,
          activeFaculty: teachers.filter((t) => t.isActive).length,
          avgRating: "4.9"
        }
      }
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
      include: { permissions: true }
    });

    if (!teacher) {
      res.status(404).json({ status: "error", message: "Teacher not found." });
      return;
    }

    res.json({
      status: "success",
      data: {
        ...teacher,
        permissions: teacher.permissions.map((p) => p.permission)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch teacher." });
  }
};

export const createTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, phone, password, country, permissions } = req.body;

    if (!fullName || !email || !phone || !password) {
      res.status(400).json({ status: "error", message: "FullName, Email, Phone, and Password are required." });
      return;
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { phone }] }
    });
    if (existingUser) {
      res.status(400).json({ status: "error", message: "Email or Phone already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const validPermissions: Permission[] = Array.isArray(permissions)
      ? permissions.filter((p: any) => Object.values(Permission).includes(p))
      : [];

    const newTeacher = await prisma.user.create({
      data: {
        fullName,
        email: email.toLowerCase(),
        phone,
        passwordHash,
        role: Role.TEACHER,
        country: country || "India",
        permissions: {
          create: validPermissions.map((perm) => ({ permission: perm }))
        }
      },
      include: { permissions: true }
    });

    res.status(201).json({
      status: "success",
      message: "Teacher account created successfully.",
      data: {
        id: newTeacher.id,
        fullName: newTeacher.fullName,
        email: newTeacher.email,
        phone: newTeacher.phone,
        role: newTeacher.role,
        permissions: newTeacher.permissions.map((p) => p.permission)
      }
    });
  } catch (error) {
    console.error("Create Teacher Error:", error);
    res.status(500).json({ status: "error", message: "Failed to create teacher." });
  }
};

export const updateTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { fullName, email, phone, country, permissions, isActive } = req.body;

    const teacher = await prisma.user.findFirst({ where: { id, role: Role.TEACHER } });
    if (!teacher) {
      res.status(404).json({ status: "error", message: "Teacher not found." });
      return;
    }

    const validPermissions: Permission[] = Array.isArray(permissions)
      ? permissions.filter((p: any) => Object.values(Permission).includes(p))
      : [];

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          fullName: fullName ?? undefined,
          email: email ? email.toLowerCase() : undefined,
          phone: phone ?? undefined,
          country: country ?? undefined,
          isActive: typeof isActive === "boolean" ? isActive : undefined
        }
      });

      if (Array.isArray(permissions)) {
        await tx.teacherPermission.deleteMany({ where: { userId: id } });
        if (validPermissions.length > 0) {
          await tx.teacherPermission.createMany({
            data: validPermissions.map((perm) => ({ userId: id, permission: perm }))
          });
        }
      }
    });

    res.json({ status: "success", message: "Teacher account updated successfully." });
  } catch (error) {
    console.error("Update Teacher Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update teacher." });
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
      orderBy: { createdAt: "desc" }
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

export const createCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, category, groupFeeINR, groupFeeUSD, oneToOneFeeINR, oneToOneFeeUSD } = req.body;
    const baseSlug = (title || "course").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const newCourse = await prisma.course.create({
      data: {
        title: title || "New Course",
        slug,
        description: description || "",
        category: mapCategoryToEnum(category),
        groupFeeINR: Number(groupFeeINR) || 4999,
        groupFeeUSD: Number(groupFeeUSD) || 99,
        groupClassesCount: "12 Sessions",
        oneToOneFeeINR: Number(oneToOneFeeINR) || 12999,
        oneToOneFeeUSD: Number(oneToOneFeeUSD) || 249,
        oneToOneClassesCount: "12 Sessions",
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
    const { title, description, category, groupFeeINR, groupFeeUSD, published } = req.body;

    const updated = await prisma.course.update({
      where: { id },
      data: {
        title: title ?? undefined,
        description: description ?? undefined,
        category: category ? mapCategoryToEnum(category) : undefined,
        groupFeeINR: groupFeeINR ? Number(groupFeeINR) : undefined,
        groupFeeUSD: groupFeeUSD ? Number(groupFeeUSD) : undefined,
        published: typeof published === "boolean" ? published : undefined
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
        students: { include: { student: { select: { id: true, fullName: true, email: true, phone: true } } } },
        course: true
      },
      orderBy: { createdAt: "desc" }
    });

    const mapped = batches.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      course: b.courseName || b.course?.title || "Kathak Foundations",
      courseName: b.courseName || b.course?.title || "Kathak Foundations",
      teacher: b.teacherName || "Guru Meenakshi",
      teacherName: b.teacherName || "Guru Meenakshi",
      schedule: b.schedule || "Mon, Wed, Fri (6:00 PM)",
      level: b.level || "ADVANCED",
      totalStudents: b.totalStudents || b.students.length || 0,
      status: b.status === "ACTIVE" ? "Active" : b.status === "COMPLETED" ? "Completed" : "Upcoming"
    }));

    res.json({
      status: "success",
      data: {
        batches: mapped,
        metrics: {
          totalBatches: batches.length,
          activeBatches: batches.filter((b) => b.status === "ACTIVE").length,
          totalStudents: batches.reduce((acc, b) => acc + (b.totalStudents || b.students.length || 0), 0),
          completedBatches: batches.filter((b) => b.status === "COMPLETED").length,
          batchesA: batches.length,
          batchesB: 0,
          batchesC: 0
        }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch batches." });
  }
};

export const createBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, code, courseId, courseName, teacherName, schedule, level } = req.body;
    const newBatch = await prisma.batch.create({
      data: {
        name,
        code: code || `KTH-${Date.now().toString().slice(-4)}`,
        courseId: courseId || undefined,
        courseName: courseName || "Kathak Foundations",
        teacherName: teacherName || "Guru Meenakshi",
        schedule: schedule || "Mon, Wed, Fri (6:00 PM)",
        level: level || "ADVANCED"
      }
    });
    res.status(201).json({ status: "success", message: "Batch created successfully.", data: newBatch });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to create batch." });
  }
};

export const updateBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, code, teacherName, schedule, level, status } = req.body;

    const updated = await prisma.batch.update({
      where: { id },
      data: {
        name: name ?? undefined,
        code: code ?? undefined,
        teacherName: teacherName ?? undefined,
        schedule: schedule ?? undefined,
        level: level ?? undefined,
        status: status ?? undefined
      }
    });
    res.json({ status: "success", message: "Batch updated successfully.", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to update batch." });
  }
};

export const deleteBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.batch.delete({ where: { id } });
    res.json({ status: "success", message: "Batch deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to delete batch." });
  }
};

// ================= 6. ATTENDANCE MANAGEMENT =================

export const getAttendanceRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const records = await prisma.attendance.findMany({
      include: { student: { select: { id: true, fullName: true, email: true } }, batch: true },
      orderBy: { date: "desc" }
    });

    res.json({
      status: "success",
      data: {
        attendanceRecords: records,
        records
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch attendance records." });
  }
};

export const saveAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    const { studentId, studentName, batchId, batchName, date, status, session, remarks } = req.body;

    const record = await prisma.attendance.create({
      data: {
        studentId,
        studentName: studentName || "Student",
        batchId: batchId || undefined,
        batchName: batchName || "General Batch",
        date: date ? new Date(date) : new Date(),
        status: status || "PRESENT",
        session: session || "General",
        remarks: remarks || undefined
      }
    });

    res.status(201).json({ status: "success", message: "Attendance saved successfully.", data: record });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to save attendance record." });
  }
};

// ================= 7. PAYMENTS & FINANCE =================

export const getPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const payments = await prisma.payment.findMany({
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        enrollment: { include: { course: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    const revenueResult = await prisma.payment.aggregate({
      where: { status: PaymentStatus.SUCCESS },
      _sum: { amount: true }
    });

    res.json({
      status: "success",
      data: {
        totalRevenue: revenueResult._sum.amount || 0,
        payments
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: "Failed to fetch payments." });
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

    res.json({ status: "success", data: user });
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

    res.json({ status: "success", message: "Admin profile updated.", data: updated });
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