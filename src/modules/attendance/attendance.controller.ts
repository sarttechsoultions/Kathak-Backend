import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { AttendanceStatus } from "@prisma/client";

// 1. Get Student Attendance for a Specific Batch & Date
export const getBatchAttendance = async (req: Request, res: Response) => {
  try {
    const { batchId, date, session = "General" } = req.query;

    if (!batchId || !date) {
      return res.status(400).json({ status: "error", message: "batchId and date are required" });
    }

    const targetDate = new Date(date as string);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // Ek hi query mein enrolled students aur unki aaj ki attendance nikal lenge
    const enrolledStudents = await prisma.batchStudent.findMany({
      where: { batchId: String(batchId), createdAt: { lte: endOfDay } },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
      },
    });

    const todaysAttendance = await prisma.attendance.findMany({
      where: {
        batchId: String(batchId),
        session: String(session),
        date: { gte: startOfDay, lte: endOfDay },
      },
    });

    // Merge logic: UI ko har student ka record bhejo, chahe marked ho ya nahi
    const result = enrolledStudents.map((enrollment) => {
      const record = todaysAttendance.find((a) => a.studentId === enrollment.studentId);
      return {
        studentId: enrollment.student.id,
        studentName: enrollment.student.fullName,
        email: enrollment.student.email,
        attendanceId: record?.id || null,
        status: record?.status || null, // null means not marked yet
        remarks: record?.remarks || "",
      };
    });

    res.status(200).json({ status: "success", data: result });
  } catch (error: any) {
    console.error("Error fetching batch attendance:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch attendance" });
  }
};

// 2. Get Teacher Attendance for a Specific Date
export const getTeacherAttendance = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ status: "error", message: "date is required" });
    }

    const targetDate = new Date(date as string);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // Saare active teachers nikal lo
    const teachers = await prisma.user.findMany({
      where: { role: "TEACHER", createdAt: { lte: endOfDay } },
      select: { id: true, fullName: true, email: true },
    });

    // Unki aaj ki attendance nikal lo (yahan batchId null/optional hoga)
    const todaysAttendance = await prisma.attendance.findMany({
      where: {
        date: { gte: startOfDay, lte: endOfDay },
        studentId: { in: teachers.map(t => t.id) }, // Hum studentId field me hi save kar rahe hain
      },
    });

    const result = teachers.map((teacher) => {
      const record = todaysAttendance.find((a) => a.studentId === teacher.id);
      return {
        teacherId: teacher.id,
        teacherName: teacher.fullName,
        email: teacher.email,
        attendanceId: record?.id || null,
        status: record?.status || null,
        remarks: record?.remarks || "",
      };
    });

    res.status(200).json({ status: "success", data: result });
  } catch (error: any) {
    console.error("Error fetching teacher attendance:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch teacher attendance" });
  }
};

// 3. Mark or Update Attendance (Bulk Save)
export const saveBulkAttendance = async (req: Request, res: Response) => {
  try {
    const { records, date, session = "General", batchId, batchName } = req.body;
    // records format: [{ userId, userName, status, remarks }]

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ status: "error", message: "Records array is required" });
    }

    const targetDate = new Date(date || new Date());
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Loop through each record and upsert (Create if not exists, Update if exists)
    for (const record of records) {
      if (!record.status) continue; // Skip if no status selected

      // Pehle check karo ki kya is user ka aaj ka record already hai
      const existing = await prisma.attendance.findFirst({
        where: {
          studentId: record.userId,
          session: session,
          batchId: batchId || null,
          date: { gte: startOfDay, lte: endOfDay },
        },
      });

      if (existing) {
        // Agar pehle se hai toh update kar do
        await prisma.attendance.update({
          where: { id: existing.id },
          data: {
            status: record.status as AttendanceStatus,
            remarks: record.remarks || existing.remarks,
          },
        });
      } else {
        // Agar nahi hai toh naya create kar do
        await prisma.attendance.create({
          data: {
            studentId: record.userId,
            studentName: record.userName,
            batchId: batchId || null,
            batchName: batchName || "Teacher/Staff",
            session: session,
            date: targetDate,
            status: record.status as AttendanceStatus,
            remarks: record.remarks || "",
          },
        });
      }
    }

    res.status(200).json({ status: "success", message: "Attendance saved successfully" });
  } catch (error: any) {
    console.error("Error saving attendance:", error);
    res.status(500).json({ status: "error", message: "Failed to save attendance" });
  }
};


export const getAttendanceReport = async (req: Request, res: Response) => {
  try {
    const { batchId, startDate, endDate, type } = req.query;

    if (!startDate || !endDate || !type) {
      return res.status(400).json({ status: "error", message: "startDate, endDate, and type are required" });
    }

    const start = new Date(startDate as string);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate as string);
    end.setHours(23, 59, 59, 999);

    // Filter logic based on STUDENT or TEACHER
    const whereClause: any = {
      date: { gte: start, lte: end },
    };

    if (type === "STUDENT") {
      if (batchId) whereClause.batchId = String(batchId);
      whereClause.batchName = { not: "Teacher/Staff" };
    } else if (type === "TEACHER") {
      whereClause.batchName = "Teacher/Staff";
    }

    const attendanceData = await prisma.attendance.findMany({
      where: whereClause,
      orderBy: { date: 'desc' },
      select: {
        studentId: true,
        studentName: true,
        batchName: true,
        session: true,
        date: true,
        status: true,
        remarks: true,
      }
    });

    res.status(200).json({ status: "success", data: attendanceData });
  } catch (error: any) {
    console.error("Error generating report:", error);
    res.status(500).json({ status: "error", message: "Failed to generate report" });
  }
};