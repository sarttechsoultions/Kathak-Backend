import { createMediaRecordOnce } from "../upload/direct-video-record";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  buildStudentBatchTargetWhere,
  getStudentBatchMembershipRows,
  getTeacherBatchIds,
  getStudentBatchName,
  getTeacherBatchNames,
  getUserDisplayName,
  resolveStudentBatchForAssignment,
} from "../../lib/batchHelpers";
import { createNotification, createNotifications, notifyAdmins } from "../notification/notification.controller";
import { sendEmail } from "../../lib/mailer";

// The academy schedule is set in India time, regardless of where a student
// opens the portal. Store the date separately, then calculate the precise IST
// cut-off as UTC for reliable server-side comparison.
const ACADEMY_TIME_ZONE = "Asia/Kolkata";
const getTaskDeadline = (submissionDate: Date, cutOffTime?: string | null) => {
  const date = submissionDate.toISOString().slice(0, 10);
  const [year, month, day] = date.split("-").map(Number);
  const [hour = 23, minute = 59] = String(cutOffTime || "23:59").split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0, 0));
};

const serialiseTask = (task: any) => ({
  ...task,
  deadlineAt: getTaskDeadline(task.submissionDate, task.cutOffTime).toISOString(),
  deadlineTimeZone: ACADEMY_TIME_ZONE,
});

const serialiseSubmission = (submission: any) => ({
  ...submission,
  files: Array.isArray(submission?.files)
    ? submission.files
    : (submission?.fileUrl ? [{ url: submission.fileUrl, name: "Submitted video" }] : []),
});

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
      // A submission belongs to its author, not to every student in the same
      // batch.  Student pages use the history endpoint, but keeping this list
      // owner-scoped prevents an API caller from browsing classmates' videos.
      whereClause = { studentId: user.id };
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
      data: list.map(serialiseSubmission),
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
      const teacherBatchIds = await getTeacherBatchIds(user.id);
      if (teacherBatchIds.length === 0) {
        res.status(403).json({
          status: "error",
          message: "You have no assigned batches yet.",
        });
        return;
      }

      const allowed = await prisma.batchStudent.count({
        where: { studentId: safeStudentId, batchId: { in: teacherBatchIds } },
      });

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
      files: Array.isArray((submission as any).files) ? (submission as any).files : ((submission as any).fileUrl ? [{ url: (submission as any).fileUrl, name: "Submitted video" }] : []),
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
      data: list.map(serialiseTask),
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
      referenceFiles,
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

    const newTask = await (prisma.videoTask as any).create({
      data: {
        title,
        category: category || "Kathak",
        course: course || "Kathak Advanced",
        batchId: batchId || null,
        batchName: targetBatch,
        priority: priority || "Low",
        submissionDate: new Date(`${String(submissionDate).slice(0, 10)}T00:00:00.000Z`),
        cutOffTime: cutOffTime || "18:00",
        strictDeadline: Boolean(strictDeadline),
        detailedInstructions: detailedInstructions || null,
        referenceFileUrl: referenceFileUrl || null,
        referenceFiles: Array.isArray(referenceFiles)
          ? referenceFiles.filter((file: any) => typeof file?.url === "string" && file.url.trim())
          : null,
        creatorRole: user.role === "ADMIN" ? "ADMIN" : "TEACHER",
        createdById: user.id,
        createdByName: creatorName,
      },
    });

    // Notify the exact students who can see this task. Previously video tasks
    // appeared only after a student opened the practice page, unlike regular
    // assignments which already send an in-app notification.
    try {
      let recipientIds: string[] = [];
      if (batchId) {
        const memberships = await prisma.batchStudent.findMany({
          where: { batchId: String(batchId) },
          select: { studentId: true },
        });
        recipientIds = memberships.map((membership) => membership.studentId);
      } else if (["all", "all batches", "all batches & courses"].includes(targetBatch.trim().toLowerCase())) {
        const students = await prisma.user.findMany({
          where: { role: "STUDENT", isActive: true },
          select: { id: true },
        });
        recipientIds = students.map((student) => student.id);
      } else {
        const names = targetBatch.split(",").map((name: string) => name.trim()).filter(Boolean);
        const batches = await prisma.batch.findMany({
          where: { OR: [{ name: { in: names } }, { code: { in: names } }] },
          select: { id: true },
        });
        if (batches.length) {
          const memberships = await prisma.batchStudent.findMany({
            where: { batchId: { in: batches.map((batch) => batch.id) } },
            select: { studentId: true },
          });
          recipientIds = memberships.map((membership) => membership.studentId);
        }
      }

      const uniqueStudentIds = [...new Set(recipientIds)];
      const deadlineLabel = getTaskDeadline(newTask.submissionDate, newTask.cutOffTime).toLocaleString("en-IN", {
        timeZone: ACADEMY_TIME_ZONE,
        dateStyle: "medium",
        timeStyle: "short",
      });
      await createNotifications(uniqueStudentIds.map((studentId) => ({
        userId: studentId,
        type: "VIDEO_TASK_ASSIGNED",
        title: "New practice video task",
        message: `“${newTask.title}” has been assigned. Submit it by ${deadlineLabel} IST.`,
        link: "/student/video-submission",
      })));

      // Email is a backup for students who are not signed in when the task is posted.
      void (async () => {
        const students = await prisma.user.findMany({
          where: { id: { in: uniqueStudentIds }, role: "STUDENT", isActive: true },
          select: { email: true, fullName: true },
        });
        await Promise.allSettled(students.map((student) => sendEmail({
          to: student.email,
          subject: `New practice video task — ${newTask.title}`,
          html: `<h2>New practice video task</h2><p>Namaste ${student.fullName || "Student"},</p><p>“<strong>${newTask.title}</strong>” has been assigned to you.</p><p><strong>Submission deadline:</strong> ${deadlineLabel} IST</p><p>Please sign in to your student portal to upload your practice video.</p>`,
        })));
      })().catch((emailError) => console.error("Video task student email failed:", emailError));
    } catch (notificationError) {
      // A temporary notification failure must not roll back a successfully
      // created task; students can still see it in their task list.
      console.error("Failed to notify students about video task:", notificationError);
    }

    res.status(201).json({
      status: "success",
      message: `Practice Task "${newTask.title}" created successfully!`,
      data: serialiseTask(newTask),
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

    const reviewerName = await getUserDisplayName(user.id, user.email);
    await createNotification(
      submission.studentId,
      "VIDEO_EVALUATED",
      "Practice video evaluated",
      `${reviewerName} reviewed “${submission.videoTitle}” and gave you ${numericScore}/100.`,
      `/student/video-submission/evaluation?submissionId=${submission.id}`
    );

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

    const { taskId, videoTitle, fileUrl, files, courseAndBatch } = req.body;
    const submittedFiles = (Array.isArray(files) ? files : [])
      .map((file: any) => ({ url: typeof file?.url === "string" ? file.url.trim() : "", name: typeof file?.name === "string" ? file.name.trim().slice(0, 255) : "Practice video" }))
      .filter((file: { url: string }) => file.url && !file.url.startsWith("blob:"));
    if (!submittedFiles.length && fileUrl && !String(fileUrl).startsWith("blob:")) submittedFiles.push({ url: String(fileUrl).trim(), name: "Practice video" });

    if (!videoTitle || !submittedFiles.length) {
      res.status(400).json({
        status: "error",
        message: "Video Title and File URL are required.",
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
    let task: any = null;
    if (taskId) {
      task = await prisma.videoTask.findUnique({ where: { id: String(taskId) } });
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

      const deadline = getTaskDeadline(task.submissionDate, task.cutOffTime);
      if (new Date() > deadline && task.strictDeadline) {
        res.status(403).json({
          status: "error",
          message: `The submission deadline was ${deadline.toLocaleString("en-IN", { timeZone: ACADEMY_TIME_ZONE, dateStyle: "medium", timeStyle: "short" })} IST.`,
        });
        return;
      }
    }

    const studentUser: any = await prisma.user.findUnique({
      where: { id: user.id },
      select: { fullName: true, avatarUrl: true },
    });

    const studentBatch = matchedBatch.name || (await getStudentBatchName(user.id));

    const deadline = task ? getTaskDeadline(task.submissionDate, task.cutOffTime) : null;
    const isLate = Boolean(deadline && new Date() > deadline);
    const newSubmission = await createMediaRecordOnce(submittedFiles[0].url, "PRACTICE", tx => tx.videoSubmission.create({
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
        fileUrl: submittedFiles[0].url,
        files: submittedFiles,
        status: "PENDING",
        isLate,
        marks: null,
      },
    }), (tx, id) => tx.videoSubmission.findUnique({ where: { id } }));

    const notificationTitle = "Practice video submitted";
    const notificationMessage = `${studentUser?.fullName || user.email || "A student"} submitted “${videoTitle}”${isLate ? " late" : ""}.`;
    await notifyAdmins("VIDEO_SUBMITTED", notificationTitle, notificationMessage, "/admin/video-review");
    await createNotification(user.id, "VIDEO_SUBMITTED", "Video submission received", `Your submission “${videoTitle}” has been received${isLate ? " and marked late" : ""}.`, "/student/video-submission");

    // Only the teacher responsible for this student's batch is notified.
    // A task creator is also included when that creator is a teacher.
    const batchOwner = await prisma.batch.findUnique({
      where: { id: matchedBatch.id },
      select: { teacherId: true },
    });
    const taskOwner = taskId
      ? await prisma.videoTask.findUnique({ where: { id: String(taskId) }, select: { createdById: true, creatorRole: true } })
      : null;
    const teacherIds = new Set<string>();
    if (batchOwner?.teacherId) teacherIds.add(batchOwner.teacherId);
    if (taskOwner?.creatorRole === "TEACHER" && taskOwner.createdById) teacherIds.add(taskOwner.createdById);
    await Promise.all([...teacherIds].map((teacherId) =>
      createNotification(teacherId, "VIDEO_SUBMITTED", notificationTitle, notificationMessage, "/teacher/video")
    ));

    // Email is an operational backup for reviewers who are not currently in the app.
    // It never blocks a student's successful submission.
    void (async () => {
      const reviewers = await prisma.user.findMany({
        where: { OR: [{ role: "ADMIN", isActive: true }, { id: { in: [...teacherIds] }, role: "TEACHER", isActive: true }] },
        select: { email: true, fullName: true, role: true },
      });
      await Promise.allSettled(reviewers.map((reviewer) => sendEmail({
        to: reviewer.email,
        subject: `Practice video submitted — ${studentUser?.fullName || "Student"}`,
        html: `<h2>Practice video submitted</h2><p><strong>${studentUser?.fullName || "A student"}</strong> submitted “${videoTitle}”${isLate ? " after the deadline" : ""}.</p><p><strong>Batch:</strong> ${studentBatch || "Unassigned"}</p><p>Please sign in to the ${reviewer.role === "ADMIN" ? "admin video review" : "teacher portal"} to review it.</p>`,
      })));
    })().catch((emailError) => console.error("Video submission reviewer email failed:", emailError));

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

    const taskSubmissionWhere: any = {
      OR: [{ taskId: task.id }, { videoTitle: task.title }],
    };
    let teacherStudentIds: string[] | null = null;
    if (user.role === "TEACHER") {
      const teacherBatchIds = await getTeacherBatchIds(user.id);
      const memberships = await prisma.batchStudent.findMany({
        where: { batchId: { in: teacherBatchIds } },
        select: { studentId: true },
      });
      teacherStudentIds = [...new Set(memberships.map((membership) => membership.studentId))];
      taskSubmissionWhere.AND = [{ studentId: { in: teacherStudentIds } }];
    }

    const submissions = await prisma.videoSubmission.findMany({
      where: taskSubmissionWhere,
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

    // Academy-wide tasks can be opened by each teacher, but their roster must
    // remain limited to students in that teacher's own assigned batches.
    if (teacherStudentIds) {
      const allowedStudentIds = new Set(teacherStudentIds);
      batchStudents = batchStudents.filter((membership: any) =>
        allowedStudentIds.has(membership.studentId)
      );
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
        submissions: submissions.map(serialiseSubmission),
        unsubmittedStudents,
      },
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message || "Failed to fetch task submissions detail." });
  }
}
