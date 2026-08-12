import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 1. Get all exams
// 1. Get all exams
export const getExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const exams = await prisma.exam.findMany({
      include: {
        batch: { select: { name: true } },
        course: { select: { title: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { results: true } }
      },
      orderBy: { date: "desc" }
    });

    const now = new Date(); // Aaj ka Current Time

    const mapped = exams.map((ex) => {
      let currentStatus: string = ex.status;      
      if (currentStatus === "SCHEDULED") {
        const examStart = new Date(ex.date);
        const examEnd = new Date(examStart.getTime() + (ex.durationMins * 60 * 1000)); // Start Time + Duration

        if (now >= examStart && now <= examEnd) {
          currentStatus = "LIVE"; 
        } else if (now > examEnd) {
          currentStatus = "COMPLETED";
        }
      }

      return {
        id: ex.id,
        examCode: ex.examCode,
        title: ex.title,
        type: ex.type,
        batchName: ex.batch?.name || "All Batches", 
        courseName: ex.course?.title || "All Courses",
        date: ex.date,
        durationMins: ex.durationMins,
        totalMarks: ex.totalMarks,
        passingMarks: ex.passingMarks,
        status: currentStatus, // Updated Status
        creatorName: ex.createdBy?.fullName || "Admin",
        submissionsCount: ex._count.results
      };
    });

    res.json({ status: "success", data: { exams: mapped } });
  } catch (error) {
    console.error("Get Exams Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch exams." });
  }
};

// 2. Schedule a new exam
export const createExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      title, description, examCode, type, date, 
      durationMins, totalMarks, passingMarks, batchId, courseId 
    } = req.body;

    const createdById = (req as any).user?.id; // Using auth middleware user

    if (!title || !date) {
      res.status(400).json({ status: "error", message: "Exam title and date are required." });
      return;
    }

    const created = await prisma.exam.create({
      data: {
        title: title.trim(),
        description: description || null,
        examCode: examCode || `EX-${Math.floor(1000 + Math.random() * 9000)}`,
        type: type || "THEORY",
        date: new Date(date),
        durationMins: durationMins ? parseInt(durationMins) : 120,
        totalMarks: totalMarks ? parseFloat(totalMarks) : 100,
        passingMarks: passingMarks ? parseFloat(passingMarks) : 40,
        batchId: batchId || null,
        courseId: courseId || null,
        createdById: createdById || null,
        status: "SCHEDULED"
      }
    });

    res.status(201).json({ status: "success", message: "Exam scheduled successfully.", data: created });
  } catch (error) {
    console.error("Create Exam Error:", error);
    res.status(500).json({ status: "error", message: "Failed to schedule exam. Ensure code is unique." });
  }
};

// 3. Get all exam results (Submissions)
export const getExamResults = async (req: Request, res: Response): Promise<void> => {
  try {
    const results = await prisma.examResult.findMany({
      include: {
        exam: { select: { title: true, totalMarks: true, passingMarks: true, type: true } },
        student: { select: { id: true, fullName: true, email: true, avatarUrl: true } }
      },
      orderBy: { submittedAt: "desc" }
    });

    const mapped = results.map((r) => ({
      id: r.id,
      examId: r.examId,
      examTitle: r.exam?.title,
      examType: r.exam?.type,
      studentName: r.student?.fullName,
      studentEmail: r.student?.email,
      studentAvatar: r.student?.avatarUrl || "/placeholder.png",
      marksObtained: r.marksObtained,
      totalMarks: r.exam?.totalMarks,
      grade: r.grade,
      status: r.status,
      feedback: r.feedback,
      fileUrl: r.fileUrl,
      submittedAt: r.submittedAt
    }));

    res.json({ status: "success", data: { results: mapped } });
  } catch (error) {
    console.error("Get Exam Results Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch exam results." });
  }
};

// 4. Grade / Evaluate an Exam
export const evaluateExamResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { marksObtained, grade, feedback } = req.body;

    const resultRecord = await prisma.examResult.findUnique({
      where: { id },
      include: { exam: true }
    });

    if (!resultRecord) {
      res.status(404).json({ status: "error", message: "Exam result record not found." });
      return;
    }

    // Auto-calculate Pass/Fail status
    const isPassed = (marksObtained !== null && marksObtained >= resultRecord.exam.passingMarks);

    const updated = await prisma.examResult.update({
      where: { id },
      data: {
        marksObtained: marksObtained !== undefined ? parseFloat(marksObtained) : resultRecord.marksObtained,
        grade: grade || resultRecord.grade,
        feedback: feedback || resultRecord.feedback,
        status: isPassed ? "PASS" : "FAIL"
      }
    });

    res.json({ status: "success", message: "Exam evaluation saved successfully.", data: updated });
  } catch (error) {
    console.error("Evaluate Exam Result Error:", error);
    res.status(500).json({ status: "error", message: "Failed to save exam evaluation." });
  }
};