import { Request, Response } from "express";
import { Role, Permission, PaymentStatus, CourseCategory, AttendanceStatus } from "@prisma/client";
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

    res.json({
      status: "success",
      data: students.map((bs) => ({
        id: bs.student.id,
        fullName: bs.student.fullName,
        email: bs.student.email,
        phone: bs.student.phone,
        avatar: bs.student.avatarUrl || "/Ananya.png",
        studentId: `#KL-2024-${bs.student.id.slice(0, 4).toUpperCase()}`,
        batchName: bs.batch.code || bs.batch.name,
        batchId: bs.batch.id,
        joiningDate: new Date(bs.student.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        assignmentsSubmitted: "0/0 Submitted"
      }))
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

    const computeBatchStatus = (schedule?: string, dbStatus?: string) => {
      if (schedule && schedule.includes("|")) {
        const parts = schedule.split("|");
        const startDateStr = parts[2];
        const endDateStr = parts[3];

        if (startDateStr) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);

          const start = new Date(startDateStr);
          start.setHours(0, 0, 0, 0);

          if (!isNaN(start.getTime()) && start > now) {
            return "Upcoming";
          }

          if (endDateStr) {
            const end = new Date(endDateStr);
            end.setHours(23, 59, 59, 999);
            if (!isNaN(end.getTime()) && now > end) {
              return "Completed";
            }
          }

          return "Active";
        }
      }

      if (!dbStatus) return "Active";
      const s = dbStatus.toUpperCase();
      return s === "ACTIVE" || s === "ACTIVE" ? "Active" : s === "UPCOMING" ? "Upcoming" : "Completed";
    };

    const mapped = batches.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      courseId: b.courseId || b.course?.id,
      course: b.courseName || b.course?.title || "Kathak Foundations",
      courseName: b.courseName || b.course?.title || "Kathak Foundations",
      teacher: b.teacherName || "Guru Meenakshi",
      teacherName: b.teacherName || "Guru Meenakshi",
      schedule: b.schedule || "Mon, Wed, Fri (6:00 PM)",
      level: b.level || "ADVANCED",
      totalStudents: b.totalStudents || b.students.length || 0,
      status: computeBatchStatus(b.schedule, b.status)
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
          totalStudents: batches.reduce((acc, b) => acc + (b.totalStudents || b.students.length || 0), 0),
          completedBatches: completedCount,
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
    const { name, code, courseId, courseName, teacherName, schedule, level, studentIds } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ status: "error", message: "Batch name is required." });
      return;
    }

    const batchCode = code || `KTH-${Date.now().toString().slice(-4)}`;

    const newBatch = await prisma.$transaction(async (tx) => {
      const created = await tx.batch.create({
        data: {
          name: name.trim(),
          code: batchCode,
          courseId: courseId || undefined,
          courseName: courseName || "Kathak Foundations",
          teacherName: teacherName || "Guru Meenakshi",
          schedule: schedule || "Mon, Wed, Fri (6:00 PM)",
          level: level || "ADVANCED",
          totalStudents: Array.isArray(studentIds) ? studentIds.length : 0
        }
      });

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
    const { name, code, courseName, teacherName, schedule, level, status, studentIds } = req.body;

    const existingBatch = await prisma.batch.findUnique({ where: { id } });
    if (!existingBatch) {
      res.status(404).json({ status: "error", message: "Batch not found." });
      return;
    }

    let targetStatus: string | undefined = undefined;
    if (status) {
      const s = String(status).toUpperCase();
      targetStatus = s === "ACTIVE" || s === "ACTIVE" ? "Active" : s === "UPCOMING" ? "Upcoming" : "Completed";
    }

    const updated = await prisma.$transaction(async (tx) => {
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

      const totalCount = Array.isArray(studentIds)
        ? studentIds.length
        : await tx.batchStudent.count({ where: { batchId: id } });

      return await tx.batch.update({
        where: { id },
        data: {
          name: name ?? undefined,
          code: code ?? undefined,
          courseName: courseName ?? undefined,
          teacherName: teacherName ?? undefined,
          schedule: schedule ?? undefined,
          level: level ?? undefined,
          status: targetStatus ?? status ?? undefined,
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
      batchId,
      targetBatch,
      dueDate,
      typeTag,
      totalPoints,
      referenceFileUrl,
      status,
    } = req.body;

    if (!title || !title.trim()) {
      res.status(400).json({ status: "error", message: "Assignment title is required." });
      return;
    }

// Logged-in user (teacher / admin)
const teacherId = req.user?.id || null;
const teacherName =
  (req.user as any)?.fullName ||
  (req.user as any)?.name ||
  "Teacher";

const data: any = {
  title: title.trim(),
  description: description || "Complete Tatkar practice video.",
  typeTag: typeTag || "Practical Assessment",
  batchName: targetBatch || "All Batches",
  dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  totalPoints: totalPoints ? Number(totalPoints) : 100,
  referenceFileUrl: referenceFileUrl || null,
  teacherId,
  teacherName,
};

    if (batchId) {
      const targetB = await (prisma as any).batch.findUnique({ where: { id: batchId } });
      if (
        targetB &&
        targetB.status &&
        targetB.status.toLowerCase() !== "active" &&
        targetB.status.toLowerCase() !== "started"
      ) {
        res.status(400).json({
          status: "error",
          message: `Cannot assign assignment. Batch "${targetB.name}" has not started yet (Status: ${targetB.status}).`,
        });
        return;
      }
      data.batch = { connect: { id: batchId } };
    }

    // Agar teacher relation Prisma mein defined hai to connect bhi kar sakte ho:
    // if (teacherId) {
    //   data.teacher = { connect: { id: teacherId } };
    // }

    const assignment = await (prisma as any).assignment.create({ data });

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
    const { grade, feedback } = req.body;

    const updated = await (prisma as any).assignmentSubmission.update({
      where: { id },
      data: {
        grade: String(grade),
        feedback,
        status: "GRADED"
      }
    });

    res.json({ status: "success", message: "Submission graded successfully.", data: updated });
  } catch (error) {
    console.error("Grade Submission Error:", error);
    res.status(500).json({ status: "error", message: "Failed to grade submission." });
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

    res.json({
      status: "success",
      data: assignment,
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
    const submissions = await prisma.assignmentSubmission.findMany({
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
    });

    res.json({
      status: "success",
      data: {
        submissions,
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
          where: { batchId: b.id, status: { in: ["PRESENT", "LATE"] } }
        });
        const rate = total > 0 ? Math.round((presentCount / total) * 100) : 85;
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
    const targetDate = date ? new Date(date) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    for (const r of records) {
      const studentId = r.rawStudentId || r.studentId;
      if (!studentId || r.status === "U") continue;

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
    const payments = await prisma.payment.findMany({
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        enrollment: { include: { course: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    const students = await prisma.user.findMany({
      where: { role: Role.STUDENT },
      include: {
        enrollments: { include: { course: true } },
        payments: { where: { status: PaymentStatus.SUCCESS } },
        batchMemberships: { include: { batch: true } }
      }
    });

    let totalFeeAmount = 0;
    let amountReceived = 0;
    let paidStudentsCount = 0;
    let pendingStudentsCount = 0;

    const studentFinanceRecords = students.map((s) => {
      const course = s.enrollments[0]?.course;
      const courseName = course?.title || "Kathak Dance Basic";
      const totalFee = course ? (course.groupFeeINR || 12000) : 12000;
      const paid = s.payments.reduce((acc, p) => acc + p.amount, 0);
      const pending = Math.max(0, totalFee - paid);

      totalFeeAmount += totalFee;
      amountReceived += paid;

      if (pending === 0 && totalFee > 0) {
        paidStudentsCount++;
      } else {
        pendingStudentsCount++;
      }

      const batchName = s.batchMemberships[0]?.batch?.name || s.batchMemberships[0]?.batch?.code || "General Batch";

      return {
        id: s.id,
        studentIdCode: `STU-${s.id.substring(0, 4).toUpperCase()}`,
        studentName: s.fullName,
        studentAvatar: s.avatarUrl || "/Ananya.png",
        course: courseName,
        batch: batchName,
        totalFees: `₹${totalFee.toLocaleString("en-IN")}`,
        paidAmount: `₹${paid.toLocaleString("en-IN")}`,
        pendingAmount: `₹${pending.toLocaleString("en-IN")}`,
        rawTotal: totalFee,
        rawPaid: paid,
        rawPending: pending
      };
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todaysPayments = payments.filter((p) => new Date(p.createdAt) >= todayStart);

    res.json({
      status: "success",
      data: {
        totalRevenue: amountReceived,
        payments,
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
          partialAmount: studentFinanceRecords.reduce((acc, r) => acc + (r.rawPaid > 0 ? r.rawPending : 0), 0)
        },
        todaysPayments
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

// ================= EXAM MANAGEMENT =================

export const getExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const exams = await (prisma as any).assignment.findMany({
      where: {
        OR: [
          { typeTag: { startsWith: "EXAM" } },
          { typeTag: { startsWith: "Exam" } },
          { typeTag: "Practical Assessment" }
        ]
      },
      orderBy: { createdAt: "desc" }
    });

    const mapped = exams.map((ex: any) => {
      let extraData: any = {};
      if (ex.description && ex.description.startsWith("{")) {
        try {
          extraData = JSON.parse(ex.description);
        } catch {
          // ignore
        }
      }

      const formattedDate = new Date(ex.dueDate).toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric"
      });

      return {
        id: ex.id,
        examCode: extraData.examCode || `EX-${ex.id.substring(0, 6).toUpperCase()}`,
        title: ex.title,
        batchCourse: ex.batchName || "All Batches",
        dateTime: extraData.dateTime || `${formattedDate} • 10:00 AM`,
        duration: extraData.durationMins ? `${extraData.durationMins} Mins` : "120 Mins",
        status: extraData.status || "SCHEDULED",
        passingMark: extraData.passingMark || 60,
        questions: extraData.questions || []
      };
    });

    res.json({ status: "success", data: { exams: mapped } });
  } catch (error) {
    console.error("Get Exams Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch exams." });
  }
};

export const createExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, examCode, batchCourse, examDate, startTime, durationMins, passingMark, autoGrading, randomizeQuestions, questions, status } = req.body;

    if (!title || !title.trim()) {
      res.status(400).json({ status: "error", message: "Exam title is required." });
      return;
    }

    const payload = JSON.stringify({
      examCode: examCode || `EX-2024-${Math.floor(100 + Math.random() * 900)}`,
      durationMins: durationMins || "120",
      passingMark: passingMark || 60,
      autoGrading: autoGrading ?? true,
      randomizeQuestions: randomizeQuestions ?? true,
      questions: questions || [],
      dateTime: `${examDate || "Upcoming"} • ${startTime || "10:00 AM"}`,
      status: status || "SCHEDULED"
    });

    const created = await (prisma as any).assignment.create({
      data: {
        title: title.trim(),
        description: payload,
        typeTag: "EXAM",
        batchName: batchCourse || "All Batches",
        dueDate: examDate ? new Date(examDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        totalPoints: 100
      }
    });

    res.status(201).json({ status: "success", message: "Exam created successfully.", data: created });
  } catch (error) {
    console.error("Create Exam Error:", error);
    res.status(500).json({ status: "error", message: "Failed to create exam." });
  }
};

export const getExamResults = async (req: Request, res: Response): Promise<void> => {
  try {
    const submissions = await (prisma as any).assignmentSubmission.findMany({
      include: {
        assignment: true,
        student: { select: { id: true, fullName: true, email: true, avatarUrl: true } }
      },
      orderBy: { submittedAt: "desc" }
    });

    const mapped = submissions.map((s: any) => {
      let scoreStr = s.grade ? `${s.grade}/100` : "--";
      let statusStr = "Passed";
      const numericGrade = parseInt(s.grade || "0", 10);
      if (!s.grade || s.grade === "0") {
        statusStr = s.notes === "Absent" ? "Absent" : "Failed";
      } else if (numericGrade < 40) {
        statusStr = "Failed";
      } else {
        statusStr = "Passed";
      }

      return {
        id: s.id,
        examId: s.assignment?.id,
        studentName: s.studentName || s.student?.fullName || "Student",
        studentEmail: s.student?.email || "student@institution.edu",
        studentAvatar: s.student?.avatarUrl || "/Ananya.png",
        studentIdCode: `#STU-${s.studentId.substring(0, 4).toUpperCase()}`,
        batchName: s.assignment?.batchName || "Kathak Batch",
        examTitle: s.assignment?.title || "Kathak Exam",
        score: scoreStr,
        status: statusStr,
        feedback: s.feedback,
        notes: s.notes,
        fileUrl: s.fileUrl,
        submittedAt: new Date(s.submittedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
      };
    });

    res.json({ status: "success", data: { results: mapped } });
  } catch (error) {
    console.error("Get Exam Results Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch exam results." });
  }
};

export const evaluateExamResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { grade, feedback, status } = req.body;

    const updated = await (prisma as any).assignmentSubmission.update({
      where: { id },
      data: {
        grade: String(grade),
        feedback,
        status: status || "GRADED"
      }
    });

    res.json({ status: "success", message: "Exam evaluation saved successfully.", data: updated });
  } catch (error) {
    console.error("Evaluate Exam Result Error:", error);
    res.status(500).json({ status: "error", message: "Failed to save exam evaluation." });
  }
};  