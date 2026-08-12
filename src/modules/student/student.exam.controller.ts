import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const normalizeParam = (param: string | string[] | undefined): string | undefined =>
  Array.isArray(param) ? param[0] : param;

// 1. Get All Exams for the logged-in Student
// 1. Get All Exams for the logged-in Student
export const getMyExams = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Get Logged-in User ID
    const userId = (req as any).user?.id;
    let myBatchIds: string[] = [];

    // 2. Fetch Student Profile to get direct batchId
    // Hum OR use kar rahe hain in case aapki foreign key `userId` ho
    const student = await (prisma as any).student.findFirst({
      where: {
        OR: [{ id: userId }, { userId: userId }]
      }
    });

    if (student?.batchId) {
      myBatchIds.push(student.batchId); // Direct relation se batch mil gaya!
    }

    // 3. Agar aapke paas batchStudent ki alag table hai toh use bhi check kar lete hain (Safe side ke liye)
    try {
      const memberships = await prisma.batchStudent.findMany({
        where: { studentId: student?.id || userId },
        select: { batchId: true }
      });
      memberships.forEach(m => myBatchIds.push(m.batchId));
    } catch (e) {
      // Ignore if table doesn't exist in your schema
    }

    // Remove duplicates
    myBatchIds = [...new Set(myBatchIds)];

    // 4. Fetch Exams
    const exams = await prisma.exam.findMany({
      where: {
        OR: [
          { batchId: { in: myBatchIds } },
          { batchId: null } // Global exams ke liye
        ]
      },
      include: {
        course: { select: { title: true } },
        batch: { select: { name: true } },
        results: {
          where: { studentId: student?.id || userId },
          select: { status: true, marksObtained: true, id: true }
        }
      },
      orderBy: { date: "desc" }
    });

    const now = new Date();

    const mappedExams = exams.map(ex => {
      const result = ex.results[0];
      let studentStatus = "Upcoming";

      const examStart = new Date(ex.date);
      const examEnd = new Date(examStart.getTime() + (ex.durationMins * 60 * 1000));

      if (result) {
        studentStatus = result.status === "PENDING" ? "In Progress" : "Completed";
      } else {
        // 👇 LIVE aur MISSED ka logic 👇
        if (now >= examStart && now <= examEnd) {
          studentStatus = "LIVE"; 
        } else if (now > examEnd) {
          studentStatus = "Missed";
        }
      }

      return {
        id: ex.id,
        examCode: ex.examCode,
        title: ex.title,
        category: ex.type || "THEORY",
        date: ex.date,
        durationMins: ex.durationMins,
        totalMarks: ex.totalMarks,
        score: result && result.marksObtained !== null ? `${result.marksObtained}/${ex.totalMarks}` : "--",
        status: studentStatus,
        resultId: result?.id || null
      };
    });

    res.json({ status: "success", data: { exams: mappedExams } });
  } catch (error) {
    console.error("Get My Exams Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch your exams." });
  }
};

// 2. Get Single Exam Data to Attempt (Take Exam)
export const getExamToAttempt = async (req: Request, res: Response): Promise<void> => {
  try {
    const examId = normalizeParam(req.params.id);
    const studentId = (req as any).user?.id;

    // Check if already submitted
    const existingResult = await prisma.examResult.findFirst({
      where: { examId, studentId }
    });

    if (existingResult) {
      res.status(400).json({ status: "error", message: "You have already submitted this exam." });
      return;
    }

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        title: true,
        examCode: true,
        date: true,
        durationMins: true,
        totalMarks: true,
        questionsData: true // Contains the actual questions Array
      }
    });

    if (!exam) {
      res.status(404).json({ status: "error", message: "Exam not found." });
      return;
    }

    // Security: Remove 'isCorrect' flag from options before sending to student!
    let secureQuestions = [];
    if (exam.questionsData && Array.isArray(exam.questionsData)) {
      secureQuestions = (exam.questionsData as any[]).map((q: any) => ({
        ...q,
        options: q.options?.map((opt: any) => ({ id: opt.id, text: opt.text })) // isCorrect hata diya
      }));
    }

    res.json({ 
      status: "success", 
      data: { exam: { ...exam, questionsData: secureQuestions } } 
    });
  } catch (error) {
    console.error("Get Exam To Attempt Error:", error);
    res.status(500).json({ status: "error", message: "Failed to load exam." });
  }
};

// 3. Submit Exam Answers & Auto-Grade
export const submitExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const examId = normalizeParam(req.params.id);
    const studentId = (req as any).user?.id;
    const { answers } = req.body;

    const exam = await prisma.exam.findUnique({
      where: { id: examId }
    });

    if (!exam) {
      res.status(404).json({ status: "error", message: "Exam not found." });
      return;
    }

    if (!examId) {
      res.status(400).json({ status: "error", message: "Invalid exam ID." });
      return;
    }

    const existing = await prisma.examResult.findUnique({
      where: { examId_studentId: { examId, studentId } }
    });
    if (existing) {
      res.status(400).json({ status: "error", message: "Exam already submitted." });
      return;
    }

    // AUTO-GRADING LOGIC
    let marksObtained = 0;
    const questions = Array.isArray(exam.questionsData) ? exam.questionsData : [];

    (questions as any[]).forEach(q => {
      const studentSelectedOptionId = answers[q.id];
      const correctOption = q.options?.find((opt: any) => opt.isCorrect === true);
      
      if (q.questionType === "Multiple Choice" && correctOption && studentSelectedOptionId === correctOption.id) {
        marksObtained += (q.marks || 1);
      }
    });

    const hasSubjectiveQuestions = (questions as any[]).some(
      (q) => q.questionType === "Long Text"
    );

    const isPassed = marksObtained >= exam.passingMarks;

    const result = await prisma.examResult.create({
      data: {
        examId,
        studentId,
        answersData: answers,
        marksObtained,
        status: hasSubjectiveQuestions ? "PENDING" : (isPassed ? "PASS" : "FAIL"),   
      }
    });

    res.status(201).json({ status: "success", message: "Exam submitted successfully.", data: result });
  } catch (error) {
    console.error("Submit Exam Error:", error);
    res.status(500).json({ status: "error", message: "Failed to submit exam." });
  }
};

// 4. Get Student's Individual Exam Result Details
export const getMyResultDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const resultId = normalizeParam(req.params.resultId);
    const studentId = (req as any).user?.id;

    const result = await prisma.examResult.findUnique({
      where: { id: resultId },
      include: {
        exam: {
          select: { title: true, type: true, totalMarks: true, questionsData: true, passingMarks: true, date: true }
        }
      }
    });

    if (!result || result.studentId !== studentId) {
      res.status(404).json({ status: "error", message: "Result not found or unauthorized." });
      return;
    }

    res.json({ status: "success", data: { result } });
  } catch (error) {
    console.error("Get Result Details Error:", error);
    res.status(500).json({ status: "error", message: "Failed to load result details." });
  }
};

