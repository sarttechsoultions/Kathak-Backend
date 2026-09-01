import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

function detectVideoMedia(raw: string, mediaType?: string | null): boolean {
  if (mediaType === "video") return true;
  const lower = raw.toLowerCase();
  return (
    lower.startsWith("data:video/") ||
    lower.includes("/video/upload/") ||
    /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(lower)
  );
}

function normalizeExamQuestions(questions: unknown): unknown[] {
  if (!Array.isArray(questions)) return [];

  return questions.map((question: any, index: number) => {
    const rawMedia = question?.mediaUrl || question?.imageUrl || null;
    if (!rawMedia) {
      return {
        ...question,
        id: question?.id || `q-${index + 1}`,
        questionText: question?.questionText || question?.text || "",
        mediaUrl: null,
        imageUrl: null,
        mediaType: null,
      };
    }

    const isVideo = detectVideoMedia(String(rawMedia), question?.mediaType);

    return {
      ...question,
      id: question?.id || `q-${index + 1}`,
      questionText: question?.questionText || question?.text || "",
      mediaType: isVideo ? "video" : "image",
      mediaUrl: rawMedia,
      imageUrl: isVideo ? null : rawMedia,
    };
  });
}

// Helper Function: To get assigned batches for a Teacher
const getTeacherBatchIds = async (userId: string): Promise<string[]> => {
  const [byTeacherId, teacherData] = await Promise.all([
    prisma.batch.findMany({
      where: { teacherId: userId },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { batchesAsTeacher: { select: { id: true } } },
    }),
  ]);

  const ids = new Set<string>();
  byTeacherId.forEach((b) => ids.add(b.id));
  teacherData?.batchesAsTeacher?.forEach((b) => ids.add(b.id));
  return Array.from(ids);
};

// ==========================================
// 1. Get all exams
// ==========================================
export const getExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const userRole = (req as any).user?.role; 

    let whereClause: any = {}; 

    if (userRole === "TEACHER") {
      const myBatchIds = await getTeacherBatchIds(userId);
      whereClause = {
        OR: [
          { createdById: userId }, 
          { batchId: { in: myBatchIds } } 
        ]
      };
    }

    const exams = await prisma.exam.findMany({
      where: whereClause,
      include: {
        batch: { select: { name: true } },
        course: { select: { title: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { results: true } }
      },
      orderBy: [{ createdAt: "desc" }, { date: "desc" }]
    });

    const now = new Date();

    const mapped = exams.map((ex) => {
      let currentStatus: string = ex.status;      
      if (currentStatus === "SCHEDULED") {
        const examStart = new Date(ex.date);
        const examEnd = new Date(examStart.getTime() + (ex.durationMins * 60 * 1000));

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
        createdAt: ex.createdAt,
        durationMins: ex.durationMins,
        totalMarks: ex.totalMarks,
        passingMarks: ex.passingMarks,
        status: currentStatus,
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

// ==========================================
// 2. Schedule a new exam (STRICT BATCH CHECK)
// ==========================================
export const createExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      title, description, examCode, type, date, 
      durationMins, totalMarks, passingMarks, batchId, batchIds, courseId, questions,
      autoGrading, randomizeQuestions
    } = req.body;

    const createdById = (req as any).user?.id;
    const userRole = (req as any).user?.role;

    if (!title || !date) {
      res.status(400).json({ status: "error", message: "Exam title and date are required." });
      return;
    }

    const targetBatchIds: (string | null)[] = Array.isArray(batchIds) && batchIds.length > 0
      ? batchIds
      : [batchId || null];

    // ðŸ”¥ SECURITY: Teacher can only create exams for their assigned batches
    if (userRole === "TEACHER") {
      const myBatchIds = await getTeacherBatchIds(createdById);
      const invalidBatches = targetBatchIds.filter(bId => bId && !myBatchIds.includes(bId));
      
      if (invalidBatches.length > 0) {
        res.status(403).json({ 
          status: "error", 
          message: "Access Denied: You can only assign exams to batches assigned to you." 
        });
        return;
      }
    }

    const baseCode = examCode || `EX-${Math.floor(1000 + Math.random() * 9000)}`;
    const examSettings =
      autoGrading !== undefined || randomizeQuestions !== undefined
        ? JSON.stringify({
            autoGrading: autoGrading !== false,
            randomizeQuestions: randomizeQuestions === true,
          })
        : description || null;

    const createdExams = await prisma.$transaction(
      targetBatchIds.map((bId, idx) =>
        prisma.exam.create({
          data: {
            title: title.trim(),
            description: examSettings,
            examCode: targetBatchIds.length > 1 ? `${baseCode}-${idx + 1}` : baseCode,
            type: type || "THEORY",
            date: new Date(date),
            durationMins: durationMins ? parseInt(durationMins) : 120,
            totalMarks: totalMarks ? parseFloat(totalMarks) : 100,
            passingMarks: passingMarks ? parseFloat(passingMarks) : 40,
            batchId: bId,
            courseId: courseId || null,
            createdById: createdById || null,
            status: "SCHEDULED",
            questionsData: questions ? normalizeExamQuestions(questions) : []
          }
        })
      )
    );

    res.status(201).json({ 
      status: "success", 
      message: `Exam scheduled successfully for ${createdExams.length} batch(es).`, 
      data: createdExams 
    });
  } catch (error) {
    console.error("Create Exam Error:", error);
    res.status(500).json({ status: "error", message: "Failed to schedule exam. Ensure code is unique." });
  }
};

// ==========================================
// 3. Get all exam results (FILTERED FOR TEACHER)
// ==========================================
export const getExamResults = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const userRole = (req as any).user?.role;

    let whereClause: any = {};

    // ðŸ”¥ SECURITY: Teacher only sees results for their own exams or their assigned batches
    if (userRole === "TEACHER") {
      const myBatchIds = await getTeacherBatchIds(userId);
      whereClause = {
        exam: {
          OR: [
            { createdById: userId },
            { batchId: { in: myBatchIds } }
          ]
        }
      };
    }

    const results = await prisma.examResult.findMany({
      where: whereClause,
      include: {
        exam: { 
          select: { title: true, totalMarks: true, passingMarks: true, type: true, questionsData: true } 
        },
        student: { 
          select: { 
            id: true, fullName: true, email: true, avatarUrl: true,
            batchMemberships: {
              include: { batch: { select: { name: true } } },
              take: 1
            }
          } 
        }
      },
      orderBy: { submittedAt: "desc" }
    });

    const examIds = Array.from(new Set(results.map((r) => r.examId)));
    const allResultsByExam = await prisma.examResult.findMany({
      where: { examId: { in: examIds } },
      select: { examId: true, marksObtained: true }
    });

    const percentileMap: Record<string, number> = {};
    results.forEach((r) => {
      const sameExamResults = allResultsByExam.filter((x) => x.examId === r.examId);
      const total = sameExamResults.length;
      const belowOrEqual = sameExamResults.filter(x => (x.marksObtained ?? 0) <= (r.marksObtained ?? 0)).length;
      percentileMap[r.id] = total > 1 ? parseFloat(((belowOrEqual / total) * 100).toFixed(1)) : 100;
    });

    const mapped = results.map((r) => {
      const studentUser = r.student as any;
      const batchName = studentUser?.batchMemberships?.[0]?.batch?.name || "All Batches";

      return {
        id: r.id,
        examId: r.examId,
        studentName: studentUser?.fullName || "Unknown Student",
        studentEmail: studentUser?.email || "No Email",
        studentAvatar: studentUser?.avatarUrl || "/placeholder.png",
        studentIdCode: `STU-${studentUser?.id ? studentUser.id.substring(0, 4).toUpperCase() : "0000"}`,
        batchName: batchName,
        score: `${r.marksObtained}/${r.exam?.totalMarks || 100}`,
        marksObtained: r.marksObtained || 0,
        totalMarks: r.exam?.totalMarks || 100,
        passingMarks: r.exam?.passingMarks || 40,
        percentile: percentileMap[r.id] ?? null,
        status: r.status === "PASS" || r.status === "GRADED" ? "Passed" : (r.status === "FAIL" ? "Failed" : "Pending"),
        submittedAt: r.submittedAt,
        answersData: r.answersData || {},
        feedback: r.feedback || "",
        grade: r.grade || "",
        flagged: (r as any).flagged || false,
        exam: r.exam
      };
    });

    res.json({ status: "success", data: { results: mapped } });
  } catch (error) {
    console.error("Get Exam Results Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch exam results." });
  }
};

// ==========================================
// 4. Grade / Evaluate an Exam (STRICT OWNERSHIP CHECK)
// ==========================================
export const evaluateExamResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { marksObtained, grade, feedback, flagged, status, questionEvaluations } = req.body;
    
    const userId = (req as any).user?.id;
    const userRole = (req as any).user?.role;

    const resultRecord = await prisma.examResult.findUnique({
      where: { id },
      include: { exam: true }
    });

    if (!resultRecord) {
      res.status(404).json({ status: "error", message: "Exam result record not found." });
      return;
    }

    // ðŸ”¥ SECURITY: Check if teacher is allowed to grade this
    if (userRole === "TEACHER") {
      const myBatchIds = await getTeacherBatchIds(userId);
      const isCreator = resultRecord.exam.createdById === userId;
      const isMyBatch = resultRecord.exam.batchId && myBatchIds.includes(resultRecord.exam.batchId);

      if (!isCreator && !isMyBatch) {
        res.status(403).json({ status: "error", message: "Access Denied: You cannot evaluate exams not assigned to you." });
        return;
      }
    }

    const calculatedStatus = status || ((marksObtained !== null && marksObtained !== undefined && marksObtained >= resultRecord.exam.passingMarks) ? "PASS" : "FAIL");

    const updated = await prisma.examResult.update({
      where: { id },
      data: {
        marksObtained: marksObtained !== undefined ? parseFloat(marksObtained) : resultRecord.marksObtained,
        grade: grade || resultRecord.grade,
        feedback: feedback !== undefined ? feedback : resultRecord.feedback,
        questionEvaluations: questionEvaluations !== undefined ? questionEvaluations : resultRecord.questionEvaluations,
        status: calculatedStatus,
        flagged: typeof flagged === "boolean" ? flagged : (resultRecord as any).flagged
      } as any
    });

    res.json({ status: "success", message: "Exam evaluation saved successfully.", data: updated });
  } catch (error) {
    console.error("Evaluate Exam Result Error:", error);
    res.status(500).json({ status: "error", message: "Failed to save exam evaluation." });
  }
};

// ==========================================
// 5. Get Students for a Specific Exam
// ==========================================
export const getExamStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    const examId = req.params.id as string;
    const userId = (req as any).user?.id;
    const userRole = (req as any).user?.role;
    
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { batch: true }
    });

    if (!exam) {
      res.status(404).json({ status: "error", message: "Exam not found." });
      return;
    }

    // ðŸ”¥ SECURITY: Prevent viewing students of unassigned exams
    if (userRole === "TEACHER") {
      const myBatchIds = await getTeacherBatchIds(userId);
      const isCreator = exam.createdById === userId;
      const isMyBatch = exam.batchId && myBatchIds.includes(exam.batchId);

      if (!isCreator && !isMyBatch) {
        res.status(403).json({ status: "error", message: "Access Denied: You cannot view participants for this exam." });
        return;
      }
    }

    let expectedStudents: any[] = [];
    if (exam.batchId) {
      const batchMemberships = await prisma.batchStudent.findMany({
        where: { batchId: exam.batchId },
        include: { student: true }
      });
      expectedStudents = batchMemberships.map(m => m.student);
    } else {
      expectedStudents = await prisma.user.findMany({ where: { role: "STUDENT" } });
    }

    const examResults = await prisma.examResult.findMany({
      where: { examId: examId }
    });

    const mappedStudents = expectedStudents.map(student => {
      const result = examResults.find(r => r.studentId === student.id);
      return {
        id: student.id,
        studentName: student.fullName,
        studentEmail: student.email,
        studentAvatar: student.avatarUrl || "/placeholder.png",
        studentIdCode: `STU-${student.id ? student.id.substring(0, 4).toUpperCase() : "0000"}`,
        batchName: exam.batch?.name || "All Batches",
        resultId: result ? result.id : null,
        marksObtained: result ? result.marksObtained : null,
        totalMarks: exam.totalMarks,
        score: result ? `${result.marksObtained}/${exam.totalMarks}` : `0/${exam.totalMarks}`,
        status: result ? (result.status === "PASS" || result.status === "GRADED" ? "Passed" : (result.status === "FAIL" ? "Failed" : "Pending")) : "Absent",
        submittedAt: result ? result.submittedAt : null
      };
    });

    res.json({ status: "success", data: { exam, students: mappedStudents } });
  } catch (error) {
    console.error("Get Exam Students Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch exam students." });
  }
};

