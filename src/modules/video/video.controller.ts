import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  buildStudentBatchTargetWhere,
  getStudentBatchMembershipRows,
  getStudentBatchName,
  getTeacherBatchNames,
  getUserDisplayName,
  resolveStudentBatchForAssignment,
} from "../../lib/batchHelpers";

// ─────────────────────────────────────────────
// GET /video/directory
// ─────────────────────────────────────────────
export async function getDirectory(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const skip = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();

    let whereClause: any = {};

    if (user.role === "ADMIN") {
      whereClause = {};
    } else if (user.role === "TEACHER") {
      const teacherName = await getUserDisplayName(user.id, user.email);
      const assignedBatches = await getTeacherBatchNames(user.id, teacherName);

      if (assignedBatches.length === 0) {
        res.json({
          status: "success",
          count: 0,
          total: 0,
          page,
          totalPages: 0,
          data: [],
          message: "No batches assigned to you yet.",
        });
        return;
      }

      whereClause.OR = [
        { studentBatch: { in: assignedBatches } },
        { courseAndBatch: { in: assignedBatches } },
        ...assignedBatches.map((b) => ({ courseAndBatch: { contains: b } })),
      ];
    } else if (user.role === "STUDENT") {
      const studentBatch = await getStudentBatchName(user.id);
      whereClause.OR = [
        { studentId: user.id },
        ...(studentBatch ? [{ studentBatch }] : []),
      ];
    } else {
      res.status(403).json({ status: "error", message: "Access denied for this role." });
      return;
    }

    if (status && status !== "ALL") {
      whereClause.status = status as any;
    }

    if (search) {
      const searchClause = {
        OR: [
          { studentName: { contains: search, mode: "insensitive" as const } },
          { videoTitle: { contains: search, mode: "insensitive" as const } },
          { courseAndBatch: { contains: search, mode: "insensitive" as const } },
        ],
      };

      if (whereClause.OR) {
        whereClause = {
          AND: [{ OR: whereClause.OR }, searchClause],
        };
      } else {
        whereClause.AND = [searchClause];
      }
    }

    const [total, list] = await Promise.all([
      prisma.videoSubmission.count({ where: whereClause as any }),
      prisma.videoSubmission.findMany({
        where: whereClause as any,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      status: "success",
      count: list.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: list,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch video directory.",
    });
  }
}

// ─────────────────────────────────────────────
// GET /video/student/:studentId/history
// ─────────────────────────────────────────────
export async function getStudentHistory(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    const { studentId } = req.params;
    const safeStudentId = String(studentId);

    if (user.role === "STUDENT" && user.id !== safeStudentId) {
      res.status(403).json({
        status: "error",
        message: "You can only view your own submission history.",
      });
      return;
    }

    if (user.role === "TEACHER") {
      const teacherName = await getUserDisplayName(user.id, user.email);
      const assignedBatches = await getTeacherBatchNames(user.id, teacherName);

      if (assignedBatches.length === 0) {
        res.status(403).json({
          status: "error",
          message: "You have no assigned batches yet.",
        });
        return;
      }

      const studentBatch = await getStudentBatchName(safeStudentId);
      const allowed = assignedBatches.some(
        (b) => b.toLowerCase() === studentBatch.toLowerCase()
      );

      if (!allowed) {
        res.status(403).json({
          status: "error",
          message: "You can only view students in your assigned batches.",
        });
        return;
      }
    }

    const list = await prisma.videoSubmission.findMany({
      where: { studentId: safeStudentId },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            course: true,
            batchName: true,
            detailedInstructions: true,
            referenceFileUrl: true,
            createdByName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const mapped = list.map((submission) => ({
      ...submission,
      referenceFileUrl: submission.task?.referenceFileUrl || null,
      detailedInstructions: submission.task?.detailedInstructions || null,
      taskTitle: submission.task?.title || null,
      taskCourse: submission.task?.course || null,
      taskBatchName: submission.task?.batchName || null,
      taskCreatedByName: submission.task?.createdByName || null,
    }));

    res.json({ status: "success", count: mapped.length, data: mapped });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch student video history.",
    });
  }
}

// ─────────────────────────────────────────────
// GET /video/tasks
// ─────────────────────────────────────────────
export async function getVideoTasks(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const skip = (page - 1) * limit;
    const search = String(req.query.search || "").trim();

    let whereClause: any = {};

    if (user.role === "ADMIN") {
      whereClause = {};
    } else if (user.role === "TEACHER") {
      const teacherName = await getUserDisplayName(user.id, user.email);
      const assignedBatches = await getTeacherBatchNames(user.id, teacherName);
      whereClause = {
        OR: [
          { createdById: user.id },
          { batchName: { in: assignedBatches } },
          { batchName: { equals: "all batches", mode: "insensitive" } },
          { batchName: { equals: "All Batches", mode: "insensitive" } },
          { batchName: "" },
        ]
      };
    } else {
      const memberships = await getStudentBatchMembershipRows(user.id);
      whereClause = buildStudentBatchTargetWhere(memberships);
    }

    if (search) {
      whereClause.AND = [
        {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { course: { contains: search, mode: "insensitive" as const } },
            { batchName: { contains: search, mode: "insensitive" as const } },
          ],
        },
      ];
    }

    const [total, list] = await Promise.all([
      prisma.videoTask.count({ where: whereClause as any }),
      prisma.videoTask.findMany({
        where: whereClause as any,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      status: "success",
      count: list.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: list,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch practice tasks.",
    });
  }
}

// ─────────────────────────────────────────────
// POST /video/tasks
// ─────────────────────────────────────────────
export async function createVideoTask(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    if (user.role !== "ADMIN" && user.role !== "TEACHER") {
      res.status(403).json({
        status: "error",
        message: "Only admins and teachers can assign tasks.",
      });
      return;
    }

    const {
      title,
      category,
      course,
      batchId,
      batchName,
      priority,
      submissionDate,
      cutOffTime,
      strictDeadline,
      detailedInstructions,
      referenceFileUrl,
    } = req.body;

    if (!title || !submissionDate) {
      res.status(400).json({
        status: "error",
        message: "Task Title and Submission Date are required.",
      });
      return;
    }

    const targetBatch = batchName || "Unassigned";
    const creatorName = await getUserDisplayName(user.id, user.email);

    if (user.role === "TEACHER") {
      const assignedBatches = await getTeacherBatchNames(user.id, creatorName);

      if (assignedBatches.length === 0) {
        res.status(403).json({
          status: "error",
          message: "You have no assigned batches yet, so you cannot assign tasks.",
        });
        return;
      }

      const isAllowed = assignedBatches.some(
        (b) =>
          b.toLowerCase() === targetBatch.toLowerCase() ||
          targetBatch.toLowerCase().includes(b.toLowerCase())
      );

      if (!isAllowed) {
        res.status(403).json({
          status: "error",
          message: `Permission Denied: You can only assign tasks to your batches (${assignedBatches.join(", ")}).`,
        });
        return;
      }
    }

    const newTask = await prisma.videoTask.create({
      data: {
        title,
        category: category || "Kathak",
        course: course || "Kathak Advanced",
        batchId: batchId || null,
        batchName: targetBatch,
        priority: priority || "Low",
        submissionDate: new Date(submissionDate),
        cutOffTime: cutOffTime || "18:00",
        strictDeadline: Boolean(strictDeadline),
        detailedInstructions: detailedInstructions || null,
        referenceFileUrl: referenceFileUrl || null,
        creatorRole: user.role === "ADMIN" ? "ADMIN" : "TEACHER",
        createdById: user.id,
        createdByName: creatorName,
      },
    });

    res.status(201).json({
      status: "success",
      message: `Practice Task "${newTask.title}" created successfully!`,
      data: newTask,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to create practice task.",
    });
  }
}

// ─────────────────────────────────────────────
// POST /video/evaluate/:submissionId
// ─────────────────────────────────────────────
export async function evaluateVideoSubmission(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    if (user.role !== "ADMIN" && user.role !== "TEACHER") {
      res.status(403).json({
        status: "error",
        message: "Only admins and teachers can evaluate submissions.",
      });
      return;
    }

    const { submissionId } = req.params;
    const safeSubmissionId = String(submissionId);

    const { score, status, correctionNotes, overallReview, rubric, scoreBreakdown } = req.body;
    const evaluationRubric = rubric || scoreBreakdown || [];

    const numericScore = parseFloat(score);
    if (isNaN(numericScore) || numericScore < 0 || numericScore > 100) {
      res.status(400).json({
        status: "error",
        message: "Performance score must be a number between 0 and 100.",
      });
      return;
    }

    if (!status || (status !== "REVIEWED" && status !== "NEEDS_IMPROVEMENT")) {
      res.status(400).json({
        status: "error",
        message: "Status must be 'REVIEWED' or 'NEEDS_IMPROVEMENT'.",
      });
      return;
    }

    const submission = await prisma.videoSubmission.findUnique({
      where: { id: safeSubmissionId },
    });

    if (!submission) {
      res.status(404).json({
        status: "error",
        message: `Video submission "${safeSubmissionId}" not found.`,
      });
      return;
    }

    if (user.role === "TEACHER") {
      const teacherName = await getUserDisplayName(user.id, user.email);
      const assignedBatches = await getTeacherBatchNames(user.id, teacherName);

      if (assignedBatches.length === 0) {
        res.status(403).json({
          status: "error",
          message: "You have no assigned batches yet, so you cannot evaluate submissions.",
        });
        return;
      }

      const subBatch = (submission.studentBatch || "").toLowerCase();
      const subCourseBatch = (submission.courseAndBatch || "").toLowerCase();

      const allowed = assignedBatches.some((b) => {
        const bl = b.toLowerCase();
        return (
          subBatch === bl ||
          subCourseBatch === bl ||
          subCourseBatch.includes(bl) ||
          subBatch.includes(bl)
        );
      });

      if (!allowed) {
        res.status(403).json({
          status: "error",
          message: "Permission Denied: You can only evaluate submissions from your assigned batches.",
        });
        return;
      }
    }

    const updated = await prisma.videoSubmission.update({
      where: { id: safeSubmissionId },
      data: {
        status,
        marks: numericScore,
        feedbackNotes: overallReview || null,
        correctionNotes: Array.isArray(correctionNotes) ? correctionNotes : [],
        evaluationRubric: Array.isArray(evaluationRubric) ? evaluationRubric : [],
      },
    });

    res.json({
      status: "success",
      message: `Video evaluation saved with score ${numericScore}/100!`,
      data: updated,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to evaluate video submission.",
    });
  }
}

// ─────────────────────────────────────────────
// POST /video/student/submit
// ─────────────────────────────────────────────
export async function submitStudentVideo(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    const { taskId, videoTitle, fileUrl, courseAndBatch } = req.body;

    if (!videoTitle || !fileUrl) {
      res.status(400).json({
        status: "error",
        message: "Video Title and File URL are required.",
      });
      return;
    }

    if (String(fileUrl).startsWith("blob:")) {
      res.status(400).json({
        status: "error",
        message: "A valid uploaded video URL is required. Please wait for upload to finish.",
      });
      return;
    }

    const memberships = await getStudentBatchMembershipRows(user.id);
    if (memberships.length === 0) {
      res.status(403).json({
        status: "error",
        message: "You are not enrolled in any batch yet.",
      });
      return;
    }

    let matchedBatch = memberships[0].batch;
    if (taskId) {
      const task = await prisma.videoTask.findUnique({ where: { id: String(taskId) } });
      if (!task) {
        res.status(404).json({ status: "error", message: "Practice task not found." });
        return;
      }

      const resolvedBatch = resolveStudentBatchForAssignment(task, memberships);
      if (!resolvedBatch) {
        res.status(403).json({
          status: "error",
          message: "Access denied: this practice task is not assigned to your batch.",
        });
        return;
      }
      matchedBatch = resolvedBatch;
    }

    const studentUser: any = await prisma.user.findUnique({
      where: { id: user.id },
      select: { fullName: true, avatarUrl: true },
    });

    const studentBatch = matchedBatch.name || (await getStudentBatchName(user.id));

    const newSubmission = await prisma.videoSubmission.create({
      data: {
        taskId: taskId || null,
        studentId: user.id,
        studentName: studentUser?.fullName || user.email || "Student",
        studentAvatar: studentUser?.avatarUrl || null,
        studentBatch: studentBatch || "Unassigned",
        submissionDate: new Date(),
        courseAndBatch:
          courseAndBatch ||
          [matchedBatch.courseName, matchedBatch.name].filter(Boolean).join(" • ") ||
          studentBatch ||
          "Unassigned",
        videoTitle,
        fileUrl,
        status: "PENDING",
        marks: null,
      },
    });

    res.status(201).json({
      status: "success",
      message: "Practice video submitted successfully!",
      data: newSubmission,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to submit practice video.",
    });
  }
}

// ─────────────────────────────────────────────
// GET /video/teacher/assigned-courses-batches
// ─────────────────────────────────────────────
export async function getTeacherAssignedCoursesAndBatches(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    const allBatches = await prisma.batch.findMany({
      include: { course: true },
      orderBy: { createdAt: "desc" }
    });

    let assignedBatches: any[] = [];

    if (user.role === "ADMIN") {
      assignedBatches = allBatches;
    } else if (user.role === "TEACHER") {
      const userObj: any = await prisma.user.findUnique({
        where: { id: user.id },
        select: { fullName: true }
      });
      const teacherFullName = (userObj?.fullName || user.email || "").toLowerCase().trim();

      assignedBatches = allBatches.filter((b: any) => {
        if (b.teacherId && b.teacherId === user.id) return true;
        const bTeacherName = (b.teacherName || b.teacher || "").toLowerCase().trim();
        if (bTeacherName && teacherFullName && bTeacherName === teacherFullName) return true;
        return false;
      });
    }

    const coursesResultMap = new Map<string, {
      id: string;
      title: string;
      category: string;
      batches: Array<{ id: string; name: string; code: string; courseId: string; courseName: string }>;
    }>();

    assignedBatches.forEach((b: any) => {
      const courseId = String(b.courseId || b.course?.id || `c-${b.id}`);
      const courseTitle = b.courseName || b.course?.title || b.course?.name || "Kathak Course";
      const courseCat = b.level || b.course?.category || b.course?.level || "BASIC";

      if (!coursesResultMap.has(courseId)) {
        coursesResultMap.set(courseId, {
          id: courseId,
          title: courseTitle,
          category: courseCat,
          batches: []
        });
      }

      const courseObj = coursesResultMap.get(courseId)!;
      if (!courseObj.batches.some((eb) => eb.id === String(b.id))) {
        courseObj.batches.push({
          id: String(b.id),
          name: b.name || b.code || "Kathak Batch",
          code: b.code || "",
          courseId: courseId,
          courseName: courseTitle
        });
      }
    });

    const coursesArray = Array.from(coursesResultMap.values());

    res.json({
      status: "success",
      data: {
        courses: coursesArray
      }
    });
  } catch (error: any) {
    console.error("Teacher Assigned Courses & Batches Error:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch assigned courses and batches."
    });
  }
}

// ─────────────────────────────────────────────
// GET /video/tasks/:taskId/submissions
// ─────────────────────────────────────────────
export async function getTaskSubmissionsDetail(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    const { taskId } = req.params;
    const safeTaskId = String(taskId);

    const task = await prisma.videoTask.findUnique({
      where: { id: safeTaskId },
    });

    if (!task) {
      res.status(404).json({ status: "error", message: "Task not found." });
      return;
    }

    if (user.role === "TEACHER") {
      const isCreator = task.createdById === user.id;
      const teacherName = await getUserDisplayName(user.id, user.email);
      const assignedBatches = await getTeacherBatchNames(user.id, teacherName);

      const taskBatch = (task.batchName || "").toLowerCase();
      const allowed = isCreator || 
                      taskBatch === "all batches" || 
                      assignedBatches.some((b) => b.toLowerCase() === taskBatch);

      if (!allowed) {
        res.status(403).json({
          status: "error",
          message: "Permission Denied: This task does not belong to your assigned batches.",
        });
        return;
      }
    }

    if (user.role === "STUDENT") {
      res.status(403).json({
        status: "error",
        message: "Students cannot view task submission rosters.",
      });
      return;
    }

    const submissions = await prisma.videoSubmission.findMany({
      where: {
        OR: [
          { taskId: task.id },
          { videoTitle: task.title }
        ]
      },
      orderBy: { createdAt: "desc" },
    });

    let batchStudents: any[] = [];
    if (task.batchId) {
      batchStudents = await prisma.batchStudent.findMany({
        where: { batchId: task.batchId },
        include: { student: true },
      });
    }

    if (batchStudents.length === 0 && task.batchName) {
      const targetBatch = await prisma.batch.findFirst({
        where: { name: task.batchName },
        include: { students: { include: { student: true } } },
      });
      if (targetBatch && targetBatch.students) {
        batchStudents = targetBatch.students;
      }
    }

    const submittedStudentIds = new Set(submissions.map((s: any) => s.studentId).filter(Boolean));
    const submittedStudentNames = new Set(submissions.map((s: any) => (s.studentName || "").toLowerCase().trim()).filter(Boolean));

    const unsubmittedStudents = batchStudents
      .map((bs: any) => bs.student)
      .filter((st: any) => st && !submittedStudentIds.has(st.id) && !submittedStudentNames.has((st.fullName || st.name || "").toLowerCase().trim()))
      .map((st: any) => ({
        id: `unsub-${st.id}`,
        studentId: st.id,
        studentName: st.fullName || st.name || "Student",
        studentAvatar: st.avatarUrl || null,
        courseAndBatch: `${task.course} • ${task.batchName}`,
        videoTitle: task.title,
        submissionDate: "—",
        status: "NOT_SUBMITTED",
      }));

    res.json({
      status: "success",
      data: {
        task,
        submissions,
        unsubmittedStudents,
      },
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message || "Failed to fetch task submissions detail." });
  }
}