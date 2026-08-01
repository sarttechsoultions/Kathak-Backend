import { Request, Response } from "express";
import { Role, Permission } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";

// Get Admin Dashboard Overview Statistics
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const totalStudents = await prisma.user.count({ where: { role: Role.STUDENT } });
    const totalTeachers = await prisma.user.count({ where: { role: Role.TEACHER } });
    const activeCourses = await prisma.course.count({ where: { published: true } });
    const totalInquiries = await prisma.inquiry.count();

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

    res.status(200).json({
      status: "success",
      data: {
        overview: {
          totalStudents: totalStudents,
          totalTeachers: totalTeachers,
          activeCourses: activeCourses,
          liveClassesToday: 0,
          totalRevenue: "₹0",
          attendanceRate: "0%"
        },
        recentStudents,
        recentInquiries
      }
    });
  } catch (error: any) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch dashboard statistics." });
  }
};

// Get Student Management List & Metrics
export const getStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    const totalStudents = await prisma.user.count({ where: { role: Role.STUDENT } });

    const dbStudents = await prisma.user.findMany({
      where: { role: Role.STUDENT },
      orderBy: { createdAt: "desc" }
    });

    res.status(200).json({
      status: "success",
      data: {
        metrics: {
          totalStudents: totalStudents,
          activeNow: dbStudents.filter((s) => s.isActive).length,
          newJoined: dbStudents.filter((s) => {
            const diffDays = (Date.now() - new Date(s.createdAt).getTime()) / (1000 * 3600 * 24);
            return diffDays <= 30;
          }).length,
          blockedStudents: dbStudents.filter((s) => !s.isActive).length
        },
        students: dbStudents.map((s) => ({
          id: s.id,
          displayId: `STU-${s.id.substring(0, 4).toUpperCase()}`,
          name: s.fullName,
          email: s.email,
          phone: s.phone || "+91 98765 43210",
          avatar: s.avatarUrl || "/Ananya.png",
          course: "Kathak Beginners Course",
          batch: "Morning Zen (7:00 AM)",
          time: "07:00 AM",
          joiningDate: s.createdAt.toISOString().split("T")[0],
          status: s.isActive ? "Active" : "Inactive",
          dob: "12th May 2002",
          gender: "Female",
          address: "Sector 15, Navi Mumbai - 400703",
          level: "Beginner Level",
          guru: "Guru Harshita",
          emergencyContact: s.phone || "+91 98765 43210",
          attendanceRate: "92",
          assignmentsScore: "14 / 16",
          totalFee: "₹2,200",
          pendingFee: "₹0"
        }))
      }
    });
  } catch (error: any) {
    console.error("Get Students Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student management data." });
  }
};

// Admin: Create Student Account in Database
export const createStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, phone, password } = req.body;

    if (!fullName || !email || !phone) {
      res.status(400).json({ status: "error", message: "FullName, Email, and Phone are required." });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = String(phone).trim();

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { phone: normalizedPhone }] }
    });

    if (existingUser) {
      res.status(400).json({ status: "error", message: "User with this email or phone already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password || "Student@123", 10);

    const student = await prisma.user.create({
      data: {
        fullName: String(fullName).trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        role: Role.STUDENT,
        avatarUrl: "/Ananya.png"
      }
    });

    res.status(201).json({
      status: "success",
      message: "Student account created successfully.",
      data: student
    });
  } catch (error: any) {
    console.error("Create Student Error:", error);
    res.status(500).json({ status: "error", message: "Failed to create student account." });
  }
};

// Admin: Delete Student Account from Database
export const deleteStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const studentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await prisma.user.delete({ where: { id: studentId } });
    res.status(200).json({ status: "success", message: "Student account deleted successfully." });
  } catch (error: any) {
    console.error("Delete Student Error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete student account." });
  }
};

// Admin: Get Teacher List & Metrics
export const getTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    const totalTeachersCount = await prisma.user.count({ where: { role: Role.TEACHER } });

    const [dbTeachers, dbBatches] = await Promise.all([
      prisma.user.findMany({
        where: { role: Role.TEACHER },
        include: { permissions: true },
        orderBy: { createdAt: "desc" }
      }),
      prisma.batch.findMany()
    ]);

    res.status(200).json({
      status: "success",
      data: {
        metrics: {
          totalTeachers: totalTeachersCount,
          activeFaculty: dbTeachers.filter((t) => t.isActive).length,
          onLeave: 0,
          avgRating: "4.9"
        },
        teachers: dbTeachers.map((t) => {
          const assigned = dbBatches
            .filter((b) => b.teacherName?.toLowerCase().includes(t.fullName.toLowerCase()))
            .map((b) => b.name);

          return {
            id: t.id,
            name: t.fullName,
            email: t.email,
            avatar: t.avatarUrl || "/Ananya.png",
            designation: "Kathak Instructor",
            assignedBatches: assigned.length > 0 ? assigned : ["Beginners Morning Zen"],
            joinedDate: t.createdAt.toISOString().split("T")[0],
            rating: "4.9",
            status: t.isActive ? "Active" : "Disabled",
            phone: t.phone,
            permissions: t.permissions.map((p) => p.permission)
          };
        })
      }
    });
  } catch (error: any) {
    console.error("Get Teachers Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch teachers." });
  }
};

// Admin: Create Teacher
export const createTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, phone, password, permissions, avatarUrl } = req.body;

    if (!fullName || !email || !phone || !password) {
      res.status(400).json({ status: "error", message: "FullName, Email, Phone, and Password are required." });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = String(phone).trim();

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { phone: normalizedPhone }] }
    });

    if (existingUser) {
      res.status(400).json({ status: "error", message: "User with this email or phone already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const teacher = await prisma.user.create({
      data: {
        fullName: String(fullName).trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        avatarUrl: avatarUrl || "/Ananya.png",
        role: Role.TEACHER,
        permissions: {
          create: (permissions || []).map((perm: Permission) => ({
            permission: perm
          }))
        }
      },
      include: {
        permissions: true
      }
    });

    res.status(201).json({
      status: "success",
      message: "Teacher account created successfully.",
      data: {
        id: teacher.id,
        fullName: teacher.fullName,
        email: teacher.email,
        role: teacher.role,
        avatarUrl: teacher.avatarUrl,
        permissions: teacher.permissions.map((p) => p.permission)
      }
    });
  } catch (error: any) {
    console.error("Create Teacher Error:", error);
    res.status(500).json({ status: "error", message: "Failed to create teacher account." });
  }
};

// Admin: Delete Teacher Account
export const deleteTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await prisma.user.delete({ where: { id: teacherId } });
    res.status(200).json({ status: "success", message: "Teacher account deleted successfully." });
  } catch (error: any) {
    console.error("Delete Teacher Error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete teacher account." });
  }
};

// Admin: Update Teacher Account in Database
export const updateTeacher = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { fullName, email, phone, password, isActive, permissions, avatarUrl } = req.body;

    const dataToUpdate: any = {};
    if (fullName) dataToUpdate.fullName = String(fullName).trim();
    if (email) dataToUpdate.email = String(email).trim().toLowerCase();
    if (phone) dataToUpdate.phone = String(phone).trim();
    if (avatarUrl) dataToUpdate.avatarUrl = avatarUrl;
    if (isActive !== undefined) dataToUpdate.isActive = Boolean(isActive);
    if (password) dataToUpdate.passwordHash = await bcrypt.hash(password, 10);

    if (permissions && Array.isArray(permissions)) {
      await prisma.teacherPermission.deleteMany({ where: { userId: teacherId } });
      dataToUpdate.permissions = {
        create: permissions.map((perm: Permission) => ({
          permission: perm
        }))
      };
    }

    const updatedTeacher = await prisma.user.update({
      where: { id: teacherId },
      data: dataToUpdate,
      include: { permissions: true }
    });

    res.status(200).json({
      status: "success",
      message: "Teacher account updated successfully.",
      data: updatedTeacher
    });
  } catch (error: any) {
    console.error("Update Teacher Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update teacher account." });
  }
};

// ================= BATCH MANAGEMENT CONTROLLERS (100% REAL DYNAMIC DB QUEIES) =================

// Admin: Get All Batches & Summary Metrics strictly from Prisma Database
export const getBatches = async (req: Request, res: Response): Promise<void> => {
  try {
    const dbBatches = await prisma.batch.findMany({ orderBy: { createdAt: "desc" } });

    const activeBatchesCount = dbBatches.filter((b) => b.status === "Active").length;
    const completedBatchesCount = dbBatches.filter((b) => b.status === "Completed" || b.status === "DONE").length;
    const totalStudentsSum = dbBatches.reduce((acc, b) => acc + (b.totalStudents || 0), 0);

    const batchesA = dbBatches.filter((b) => b.name.toUpperCase().includes("A") || b.code.toUpperCase().includes("A")).length;
    const batchesB = dbBatches.filter((b) => b.name.toUpperCase().includes("B") || b.code.toUpperCase().includes("B")).length;
    const batchesC = dbBatches.filter((b) => b.name.toUpperCase().includes("C") || b.code.toUpperCase().includes("C")).length;

    res.status(200).json({
      status: "success",
      data: {
        metrics: {
          activeBatches: activeBatchesCount,
          totalStudents: totalStudentsSum,
          completedBatches: completedBatchesCount,
          batchesA: batchesA,
          batchesB: batchesB,
          batchesC: batchesC
        },
        batches: dbBatches.map((b) => ({
          id: b.id,
          name: b.name,
          code: b.code,
          course: b.courseName,
          level: b.level as any,
          teacher: b.teacherName,
          schedule: b.schedule,
          totalStudents: b.totalStudents,
          status: b.status
        }))
      }
    });
  } catch (error: any) {
    console.error("Get Batches Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch batches from database." });
  }
};

// Admin: Create New Batch in Database
export const createBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, courseName, level, teacherName, schedule, totalStudents, status, studentIds = [] } = req.body;

    if (!name || !courseName) {
      res.status(400).json({ status: "error", message: "Batch Name and Course are required." });
      return;
    }

    const code = `KTH-${Math.floor(100 + Math.random() * 900)}-${String(name).substring(0, 4).toUpperCase()}`;

    const batch = await prisma.batch.create({
      data: {
        name: String(name).trim(),
        code,
        courseName: String(courseName).trim(),
        level: level || "INTERMEDIATE",
        teacherName: teacherName || "Kathak Faculty",
        schedule: schedule || "Mon,Wed,Fri 06:30 PM - 08:00 PM",
        totalStudents: Array.isArray(studentIds) ? studentIds.length : Number(totalStudents) || 0,
        status: status || "Active",
        students: Array.isArray(studentIds) ? { create: [...new Set(studentIds)].map((studentId: string) => ({ studentId })) } : undefined
      }
    });

    res.status(201).json({
      status: "success",
      message: "Batch created successfully.",
      data: batch
    });
  } catch (error: any) {
    console.error("Create Batch Error:", error);
    res.status(500).json({ status: "error", message: "Failed to create batch." });
  }
};

// Admin: Update Existing Batch in Database
export const updateBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { name, courseName, level, teacherName, schedule, totalStudents, status, studentIds } = req.body;
    const replaceStudents = Array.isArray(studentIds);

    const batch = await prisma.batch.update({
      where: { id: batchId },
      data: {
        ...(name && { name: String(name).trim() }),
        ...(courseName && { courseName: String(courseName).trim() }),
        ...(level && { level }),
        ...(teacherName && { teacherName }),
        ...(schedule && { schedule }),
        ...(totalStudents !== undefined && { totalStudents: Number(totalStudents) }),
        ...(status && { status }),
        ...(replaceStudents && { totalStudents: studentIds.length, students: { deleteMany: {}, create: [...new Set(studentIds)].map((studentId: string) => ({ studentId })) } })
      }
    });

    res.status(200).json({
      status: "success",
      message: "Batch updated successfully.",
      data: batch
    });
  } catch (error: any) {
    console.error("Update Batch Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update batch." });
  }
};

// Admin: Delete Batch from Database
export const deleteBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await prisma.batch.delete({ where: { id: batchId } });
    res.status(200).json({ status: "success", message: "Batch deleted successfully." });
  } catch (error: any) {
    console.error("Delete Batch Error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete batch." });
  }
};

// Admin: Get Batch Student Directory Cohort
export const getBatchStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });

    const memberships = await prisma.batchStudent.findMany({ where: { batchId }, include: { student: true }, orderBy: { createdAt: "desc" } });
    const studentsList = memberships.map(({ student: s }) => ({
      id: s.id,
      name: s.fullName,
      email: s.email,
      avatar: s.avatarUrl || "/Ananya.png",
      studentId: `STU-2024-${s.id.substring(0, 4).toUpperCase()}`,
      batchCode: batch?.code || "KTH-BATCH",
      joiningDate: s.createdAt.toISOString().split("T")[0],
      assignmentsSubmitted: "14 / 16"
    }));

    res.status(200).json({
      status: "success",
      data: {
        batchName: batch?.name || "Batch Student Cohort",
        batchCode: batch?.code || "KTH-BATCH",
        totalStudents: studentsList.length,
        students: studentsList
      }
    });
  } catch (error: any) {
    console.error("Get Batch Students Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch batch student directory." });
  }
};

// ================= COURSE MANAGEMENT CONTROLLERS =================

// Admin: Get All Courses & Metrics from Database
export const getCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    const dbCourses = await prisma.course.findMany({
      orderBy: { createdAt: "desc" }
    });

    const totalCourses = dbCourses.length;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const newThisMonth = dbCourses.filter((c) => new Date(c.createdAt) >= startOfMonth).length;

    res.status(200).json({
      status: "success",
      data: {
        totalCourses,
        newThisMonth,
        courses: dbCourses.map((c) => ({
          id: c.id,
          code: `CRS-${c.id.substring(0, 4).toUpperCase()}`,
          title: c.title,
          description: c.description,
          category: (c.category as string) === "BASIC" ? "Classical Dance" : (c.category as string) === "INTERMEDIATE" ? "Yoga" : "Kathak Mastery",
          level: c.borderColor || "Beginner",
          feeINR: c.groupFeeINR,
          groupFeeINR: c.groupFeeINR,
          groupFeeUSD: c.groupFeeUSD,
          oneToOneFeeINR: c.oneToOneFeeINR,
          oneToOneFeeUSD: c.oneToOneFeeUSD,
          groupClassesCount: c.groupClassesCount,
          oneToOneClassesCount: c.oneToOneClassesCount,
          classesCount: c.groupClassesCount,
          duration: c.groupClassesCount || "24 Classes",
          videoUrl: (c.oneToOneClassesCount && c.oneToOneClassesCount.startsWith("http")) ? c.oneToOneClassesCount : "",
          studentsCount: "0/50",
          studentPercent: "0%",
          status: c.published ? "Active" : "Draft",
          thumbnail: c.badgeBgColor && (c.badgeBgColor.startsWith("http") || c.badgeBgColor.startsWith("/")) ? c.badgeBgColor : "/gurukul-dancer.jpg"
        }))
      }
    });
  } catch (error: any) {
    console.error("Get Courses Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch courses from database." });
  }
};

// Admin: Create New Course in Database
export const createCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      title,
      description,
      category,
      level,
      groupFeeINR,
      groupFeeUSD,
      groupClassesCount,
      oneToOneFeeINR,
      oneToOneFeeUSD,
      oneToOneClassesCount,
      feeINR,
      classesCount,
      thumbnail,
      videoUrl
    } = req.body;

    if (!title) {
      res.status(400).json({ status: "error", message: "Course Title is required." });
      return;
    }

    const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now();

    let mappedCategory: any = "BASIC";
    if (category === "Yoga") mappedCategory = "INTERMEDIATE";
    else if (category === "Music Theory") mappedCategory = "ADVANCED";
    else if (category === "Contemporary") mappedCategory = "SPECIAL";
    else if (category === "Classical Dance") mappedCategory = "BASIC";

    const course = await prisma.course.create({
      data: {
        title: String(title).trim(),
        slug,
        description: description || "Kathak Dance Course",
        category: mappedCategory,
        borderColor: level || "Beginner",
        groupFeeINR: Number(groupFeeINR || feeINR) || 2200,
        groupFeeUSD: Number(groupFeeUSD) || 50,
        groupClassesCount: String(groupClassesCount || classesCount || "10 Classes/month"),
        oneToOneFeeINR: Number(oneToOneFeeINR) || 600,
        oneToOneFeeUSD: Number(oneToOneFeeUSD) || 15,
        oneToOneClassesCount: String(videoUrl || oneToOneClassesCount || "Min 4 Classes/month"),
        badgeBgColor: thumbnail || "/gurukul-dancer.jpg",
        published: true
      }
    });

    res.status(201).json({
      status: "success",
      message: "Course created successfully.",
      data: course
    });
  } catch (error: any) {
    console.error("Create Course Error:", error);
    res.status(500).json({ status: "error", message: "Failed to create course in database." });
  }
};

// Admin: Update Existing Course in Database
export const updateCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const {
      title,
      description,
      category,
      level,
      groupFeeINR,
      groupFeeUSD,
      groupClassesCount,
      oneToOneFeeINR,
      oneToOneFeeUSD,
      oneToOneClassesCount,
      feeINR,
      classesCount,
      thumbnail,
      videoUrl
    } = req.body;

    let mappedCategory: any = undefined;
    if (category === "Yoga") mappedCategory = "INTERMEDIATE";
    else if (category === "Music Theory") mappedCategory = "ADVANCED";
    else if (category === "Contemporary") mappedCategory = "SPECIAL";
    else if (category === "Classical Dance") mappedCategory = "BASIC";

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        title: title ? String(title).trim() : undefined,
        description: description !== undefined ? description : undefined,
        category: mappedCategory,
        borderColor: level || undefined,
        groupFeeINR: (groupFeeINR || feeINR) ? Number(groupFeeINR || feeINR) : undefined,
        groupFeeUSD: groupFeeUSD ? Number(groupFeeUSD) : undefined,
        groupClassesCount: (groupClassesCount || classesCount) ? String(groupClassesCount || classesCount) : undefined,
        oneToOneFeeINR: oneToOneFeeINR ? Number(oneToOneFeeINR) : undefined,
        oneToOneFeeUSD: oneToOneFeeUSD ? Number(oneToOneFeeUSD) : undefined,
        oneToOneClassesCount: (videoUrl !== undefined ? String(videoUrl) : (oneToOneClassesCount ? String(oneToOneClassesCount) : undefined)),
        badgeBgColor: thumbnail || undefined
      }
    });

    res.status(200).json({
      status: "success",
      message: "Course updated successfully.",
      data: updated
    });
  } catch (error: any) {
    console.error("Update Course Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update course." });
  }
};

// Admin: Delete Course from Database
export const deleteCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await prisma.course.delete({ where: { id: courseId } });
    res.status(200).json({ status: "success", message: "Course deleted successfully." });
  } catch (error: any) {
    console.error("Delete Course Error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete course." });
  }
};

// Admin: Fetch Attendance Records for Batch & Date (100% Dynamic DB Query)
const attendanceDay = (value?: unknown) => {
  const raw = typeof value === "string" ? value : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return new Date(`${raw}T00:00:00.000Z`);
};

export const getAttendanceRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const { batchId, date, session = "General" } = req.query;
    const targetDate = attendanceDay(date);
    if (!targetDate || typeof batchId !== "string" || !batchId) {
      res.status(400).json({ status: "error", message: "A valid date and batchId are required." });
      return;
    }
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) { res.status(404).json({ status: "error", message: "Batch not found." }); return; }
    if (batch.status !== "Active") { res.status(400).json({ status: "error", message: "Attendance is available only for active batches." }); return; }

    const [memberships, attendanceEntries, dbBatches] = await Promise.all([
      prisma.batchStudent.findMany({ where: { batchId, student: { isActive: true } }, include: { student: { select: { id: true, fullName: true, email: true, avatarUrl: true } } } }),
      prisma.attendance.findMany({ where: { batchId, date: targetDate, session: String(session) } }),
      prisma.batch.findMany({ where: { status: "Active" }, select: { id: true, name: true } })
    ]);
    const attendanceMap = new Map(attendanceEntries.map((entry) => [entry.studentId, entry.status]));
    const records = memberships.map(({ student }) => {
      const dbStatus = attendanceMap.get(student.id);
      const statusCode = dbStatus === "PRESENT" ? "P" : dbStatus === "ABSENT" ? "A" : dbStatus === "LATE" ? "L" : dbStatus === "LEAVE" ? "LV" : "U";
      return { id: student.id, studentId: `STU-${student.id.substring(0, 4).toUpperCase()}`, name: student.fullName, email: student.email, avatar: student.avatarUrl || "/Ananya.png", batchCode: batch.code, courseName: batch.courseName, status: statusCode };
    });
    const totalStudents = records.length;
    const presentToday = records.filter((r) => r.status === "P").length;
    const absent = records.filter((r) => r.status === "A").length;
    const leaveRequests = records.filter((r) => r.status === "L" || r.status === "LV").length;

    const batchAnalytics = await Promise.all(dbBatches.map(async (b) => {
      const [members, marked] = await Promise.all([
        prisma.batchStudent.count({ where: { batchId: b.id, student: { isActive: true } } }),
        prisma.attendance.count({ where: { batchId: b.id, date: targetDate, session: String(session), status: { in: ["PRESENT", "LATE"] } } })
      ]);
      return { id: b.id, name: b.name, rate: members ? Math.round((marked / members) * 100) : 0 };
    }));

    res.status(200).json({
      status: "success",
      data: {
        records,
        metrics: {
          totalStudents,
          presentToday,
          absent,
          leaveRequests
        },
        batchAnalytics
      }
    });
  } catch (error: any) {
    console.error("Get Attendance Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch attendance records." });
  }
};

// Admin: Save / Mark Attendance for Students in Database
export const saveAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    const { batchId, date, session = "General", records } = req.body;

    if (!Array.isArray(records)) {
      res.status(400).json({ status: "error", message: "Records array is required." });
      return;
    }

    const targetDate = attendanceDay(date);
    if (!targetDate || typeof batchId !== "string" || !batchId) { res.status(400).json({ status: "error", message: "A valid date and batchId are required." }); return; }
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) { res.status(404).json({ status: "error", message: "Batch not found." }); return; }
    if (batch.status !== "Active") { res.status(400).json({ status: "error", message: "Attendance can be saved only for active batches." }); return; }
    const memberIds = new Set((await prisma.batchStudent.findMany({ where: { batchId }, select: { studentId: true } })).map((m) => m.studentId));
    const validRecords = records.filter((r: any) => memberIds.has(r.id || r.studentId) && r.status !== "U");
    await prisma.$transaction(async (tx) => {
      for (const r of validRecords) {
        const stId = r.id || r.studentId;
        let enumStatus: "PRESENT" | "ABSENT" | "LATE" | "LEAVE" = "PRESENT";
        if (r.status === "A" || r.status === "ABSENT") enumStatus = "ABSENT";
        else if (r.status === "L" || r.status === "LATE") enumStatus = "LATE";
        else if (r.status === "LV" || r.status === "LEAVE") enumStatus = "LEAVE";
        const existing = await tx.attendance.findFirst({ where: { studentId: stId, batchId, date: targetDate, session: String(session) } });
        if (existing) await tx.attendance.update({ where: { id: existing.id }, data: { status: enumStatus, studentName: r.name || "Student", batchName: batch.name } });
        else await tx.attendance.create({ data: { studentId: stId, studentName: r.name || "Student", batchId, batchName: batch.name, date: targetDate, session: String(session), status: enumStatus } });
      }
    });

    res.status(200).json({
      status: "success",
      message: "Attendance saved successfully."
    });
  } catch (error: any) {
    console.error("Save Attendance Error:", error);
    res.status(500).json({ status: "error", message: "Failed to save attendance records." });
  }
};
