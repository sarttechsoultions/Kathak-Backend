import { Request, Response } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BUNNY_CONFIG } from "../../config/bunny.config";
import { env } from "../../config/env";
import * as UAParser from "ua-parser-js";
import geoip from "geoip-lite";
import {
  dedupeRecordedClassesForStudent,
  findLinkedRecordedClassIds,
  mergeViewHistoryByUser,
} from "../../lib/recordedClassHelpers";

function normalizeResources(resources: unknown): string[] {
  if (!Array.isArray(resources)) return [];
  return resources
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const record = item as { name?: string; url?: string };
        if (record.name && record.url) return `${record.name}|${record.url}`;
        if (record.name) return record.name;
      }
      return "";
    })
    .filter(Boolean);
}

type DistributionMode = "single" | "course_batches" | "all_batches";

type BatchTarget = { batchId: string; courseId: string | null };

async function resolveBatchTargets(
  mode: DistributionMode,
  courseId?: string | null,
  batchId?: string | null
): Promise<BatchTarget[]> {
  if (mode === "all_batches") {
    const batches = await prisma.batch.findMany({
      where: { status: "Active" },
      select: { id: true, courseId: true },
      orderBy: { createdAt: "asc" },
    });
    return batches.map((batch) => ({ batchId: batch.id, courseId: batch.courseId }));
  }

  if (mode === "course_batches") {
    if (!courseId) return [];
    const batches = await prisma.batch.findMany({
      where: { courseId: String(courseId), status: "Active" },
      select: { id: true, courseId: true },
      orderBy: { createdAt: "asc" },
    });
    return batches.map((batch) => ({ batchId: batch.id, courseId: batch.courseId }));
  }

  if (batchId) {
    const batch = await prisma.batch.findUnique({
      where: { id: String(batchId) },
      select: { id: true, courseId: true },
    });
    if (!batch) return [];
    return [{ batchId: batch.id, courseId: batch.courseId }];
  }

  return [{ batchId: "", courseId: courseId ? String(courseId) : null }];
}

async function notifyBatchStudents(
  batchId: string,
  title: string,
  classId: string,
  notifiedUserIds: Set<string>
): Promise<void> {
  const studentsInBatch = await prisma.batchStudent.findMany({
    where: { batchId },
    select: { studentId: true },
  });

  const pending = studentsInBatch.filter((student) => !notifiedUserIds.has(student.studentId));
  if (pending.length === 0) return;

  await prisma.notification.createMany({
    data: pending.map((student) => ({
      userId: student.studentId,
      type: "CLASS",
      title: `New Recorded Class: ${title}`,
      message: `A new video "${title}" has been uploaded for your batch.`,
      link: `/student/recorded-classes/${classId}`,
    })),
  });

  pending.forEach((student) => notifiedUserIds.add(student.studentId));
}

async function studentCanAccessRecordedClass(
  userId: string,
  recordedClass: { courseId: string | null; batchId: string | null; isPublic: boolean }
): Promise<boolean> {
  const [enrollments, batchMemberships] = await Promise.all([
    prisma.enrollment.findMany({ where: { userId, active: true }, select: { courseId: true } }),
    prisma.batchStudent.findMany({ where: { studentId: userId }, select: { batchId: true } }),
  ]);

  const courseIds = enrollments.map((entry) => entry.courseId);
  const batchIds = batchMemberships.map((entry) => entry.batchId);

  const inBatch = recordedClass.batchId ? batchIds.includes(recordedClass.batchId) : false;
  const isGeneral = !recordedClass.courseId && !recordedClass.batchId;

  if (isGeneral) return true;
  if (recordedClass.batchId) return inBatch;
  if (recordedClass.courseId) {
    return courseIds.includes(recordedClass.courseId);
  }
  if (!recordedClass.isPublic) return false;
  return false;
}

export const getAdminRecordedClasses = async (_req: Request, res: Response): Promise<void> => {
  try {
    const classes = await prisma.recordedClass.findMany({
      include: {
        course: true,
        batch: true,
        viewHistory: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
          orderBy: { viewedAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalPlatformViews = classes.reduce((sum, item) => sum + (item.viewsCount || 0), 0);
    res.json({ status: "success", data: { classes, totalPlatformViews } });
  } catch (error) {
    console.error("Get Recorded Classes Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch recorded classes." });
  }
};

export const getAdminRecordedClassById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const recordedClass = await prisma.recordedClass.findUnique({
      where: { id },
      include: {
        course: true,
        batch: true,
        viewHistory: {
          include: { user: { select: { id: true, fullName: true, email: true } } },
          orderBy: { viewedAt: "desc" },
        },
      },
    });

    if (!recordedClass) {
      res.status(404).json({ status: "error", message: "Recorded class not found." });
      return;
    }

    const linkedIds = await findLinkedRecordedClassIds(recordedClass);
    const linkedViews = await prisma.recordedClassView.findMany({
      where: { recordedClassId: { in: linkedIds } },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { viewedAt: "desc" },
    });

    const mergedViewHistory = mergeViewHistoryByUser(linkedViews);

    res.json({
      status: "success",
      data: {
        recordedClass: {
          ...recordedClass,
          viewHistory: mergedViewHistory,
          viewsCount: mergedViewHistory.length,
          linkedIds,
        },
      },
    });
  } catch (error) {
    console.error("Get Recorded Class Detail Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch recorded class." });
  }
};

export const createRecordedClass = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      title,
      description,
      videoUrl,
      thumbnail,
      courseId,
      batchId,
      duration,
      videoId,
      resources = [],
      tags = [],
      isPublic = true,
      isDownloadable = true,
      notifyStudents = true,
      distributionMode = "single",
    } = req.body;

    if (!title || !videoUrl) {
      res.status(400).json({ status: "error", message: "Title and Video URL are required." });
      return;
    }

    const mode = String(distributionMode) as DistributionMode;
    if (!["single", "course_batches", "all_batches"].includes(mode)) {
      res.status(400).json({ status: "error", message: "Invalid distribution mode." });
      return;
    }

    const trimmedVideoUrl = String(videoUrl).trim();
    if (env.isProduction && trimmedVideoUrl.includes("/uploads/videos/")) {
      res.status(400).json({
        status: "error",
        message: "Video must be uploaded to cloud storage. Please re-upload the file and try again.",
      });
      return;
    }

    let finalThumbnail = thumbnail?.trim() || null;
    if (!finalThumbnail && videoId && BUNNY_CONFIG.libraryId && !String(videoId).startsWith("local-")) {
      finalThumbnail = `https://vz-${BUNNY_CONFIG.libraryId}.b-cdn.net/${videoId}/thumbnail.jpg`;
    }

    const normalizedResources = normalizeResources(resources);
    const normalizedTags = Array.isArray(tags) ? tags : [];
    const trimmedTitle = String(title).trim();

    const targets = await resolveBatchTargets(mode, courseId, batchId);

    if (mode !== "single" && targets.length === 0) {
      res.status(400).json({
        status: "error",
        message: "No active batches found for the selected distribution.",
      });
      return;
    }

    if (mode === "course_batches" && !courseId) {
      res.status(400).json({ status: "error", message: "Course is required when publishing to all batches in a course." });
      return;
    }

    const baseData = {
      title: trimmedTitle,
      description: description || null,
      videoUrl: trimmedVideoUrl,
      thumbnail: finalThumbnail,
      duration: duration || null,
      videoId: videoId || null,
      resources: normalizedResources,
      tags: normalizedTags,
      isPublic: Boolean(isPublic),
      isDownloadable: Boolean(isDownloadable),
    };

    const createdClasses = await prisma.$transaction(
      targets.map((target) =>
        prisma.recordedClass.create({
          data: {
            ...baseData,
            ...(target.courseId && { course: { connect: { id: target.courseId } } }),
            ...(target.batchId && { batch: { connect: { id: target.batchId } } }),
          },
          include: { course: true, batch: true },
        })
      )
    );

    if (notifyStudents !== false) {
      try {
        const notifiedUserIds = new Set<string>();

        for (const created of createdClasses) {
          if (created.batchId) {
            await notifyBatchStudents(created.batchId, created.title, created.id, notifiedUserIds);
          } else if (created.courseId) {
            const enrollments = await prisma.enrollment.findMany({
              where: { courseId: created.courseId, active: true },
              select: { userId: true },
            });

            const pending = enrollments.filter((entry) => !notifiedUserIds.has(entry.userId));
            if (pending.length > 0) {
              await prisma.notification.createMany({
                data: pending.map((entry) => ({
                  userId: entry.userId,
                  type: "CLASS",
                  title: `New Video: ${created.title}`,
                  message: `A new video "${created.title}" has been uploaded to your course.`,
                  link: `/student/recorded-classes/${created.id}`,
                })),
              });
              pending.forEach((entry) => notifiedUserIds.add(entry.userId));
            }
          }
        }
      } catch (notifErr) {
        console.error("Failed to send recorded class notifications:", notifErr);
      }
    }

    const createdCount = createdClasses.length;
    const primaryClass = createdClasses[0];

    res.status(201).json({
      status: "success",
      message:
        createdCount > 1
          ? `Recorded class published to ${createdCount} batches successfully.`
          : "Recorded class uploaded successfully.",
      data: primaryClass,
      meta: { createdCount, classes: createdClasses },
    });
  } catch (error) {
    console.error("Create Recorded Class Error:", error);
    res.status(500).json({ status: "error", message: "Failed to upload recorded class." });
  }
};

export const deleteRecordedClass = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.recordedClass.delete({ where: { id } });
    res.json({ status: "success", message: "Recorded class deleted successfully." });
  } catch (error) {
    console.error("Delete Recorded Class Error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete recorded class." });
  }
};

export const getStudentRecordedClasses = async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.user!.role !== Role.STUDENT) {
      res.status(403).json({ status: "error", message: "Student access only." });
      return;
    }

    const userId = req.user!.id;
    const studentEnrollments = await prisma.enrollment.findMany({
      where: { userId, active: true },
      select: { courseId: true },
    });
    const courseIds = studentEnrollments.map((entry) => entry.courseId);

    const studentBatches = await prisma.batchStudent.findMany({
      where: { studentId: userId },
      select: { batchId: true },
    });
    const batchIds = studentBatches.map((entry) => entry.batchId);

    const classes = await prisma.recordedClass.findMany({
      where: {
        OR: [
          { batchId: { in: batchIds } },
          { courseId: { in: courseIds }, batchId: null },
          { courseId: null, batchId: null },
        ],
      },
      include: { course: true, batch: true },
      orderBy: { createdAt: "desc" },
    });

    const uniqueClasses = dedupeRecordedClassesForStudent(classes, batchIds);

    res.json({ status: "success", data: { classes: uniqueClasses } });
  } catch (error) {
    console.error("Get Student Recorded Classes Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch recorded classes." });
  }
};

export const getStudentSingleRecordedClass = async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.user!.role !== Role.STUDENT) {
      res.status(403).json({ status: "error", message: "Student access only." });
      return;
    }

    const id = String(req.params.id);
    const recordedClass = await prisma.recordedClass.findUnique({
      where: { id },
      include: { course: true, batch: true },
    });

    if (!recordedClass) {
      res.status(404).json({ status: "error", message: "Recorded class not found." });
      return;
    }

    const allowed = await studentCanAccessRecordedClass(req.user!.id, recordedClass);
    if (!allowed) {
      res.status(403).json({ status: "error", message: "You do not have access to this recorded class." });
      return;
    }

    res.json({ status: "success", data: { recordedClass } });
  } catch (error) {
    console.error("Get Student Single Recorded Class Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch recorded class." });
  }
};

export const recordClassView = async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.user!.role !== Role.STUDENT) {
      res.status(403).json({ status: "error", message: "Student access only." });
      return;
    }

    const recordedClassId = String(req.params.id);
    const userId = req.user!.id;

    const recordedClass = await prisma.recordedClass.findUnique({
      where: { id: recordedClassId },
      select: { id: true, courseId: true, batchId: true, isPublic: true },
    });

    if (!recordedClass) {
      res.status(404).json({ status: "error", message: "Recorded class not found." });
      return;
    }

    const allowed = await studentCanAccessRecordedClass(userId, recordedClass);
    if (!allowed) {
      res.status(403).json({ status: "error", message: "You do not have access to this recorded class." });
      return;
    }

    const parser = new UAParser.UAParser(req.headers["user-agent"] as string);
    const deviceType = (parser.getDevice().type || "Desktop") as string;
    const browser = (parser.getBrowser().name || "Unknown") as string;

    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) || req.socket.remoteAddress || "";

    let location = "Unknown";
    if (ipAddress) {
      const isLocal =
        ipAddress === "::1" ||
        ipAddress === "127.0.0.1" ||
        ipAddress.startsWith("192.168.") ||
        ipAddress.startsWith("10.") ||
        ipAddress.startsWith("::ffff:127.");

      if (isLocal) {
        location = "Local Network";
      } else {
        const geo = geoip.lookup(ipAddress as string);
        if (geo) {
          location = `${geo.city || "Unknown"}, ${geo.region || ""}, ${geo.country || ""}`.replace(/,\s*,/g, ",");
        }
      }
    }

    const existingView = await prisma.recordedClassView.findUnique({
      where: { recordedClassId_userId: { recordedClassId, userId } },
    });

    if (!existingView) {
      try {
        await prisma.$transaction([
          prisma.recordedClassView.create({
            data: {
              recordedClassId,
              userId,
              deviceType,
              browser,
              ipAddress: ipAddress as string,
              location,
            },
          }),
          prisma.recordedClass.update({
            where: { id: recordedClassId },
            data: { viewsCount: { increment: 1 } },
          }),
        ]);
      } catch (createError: unknown) {
        const err = createError as { code?: string };
        if (err.code === "P2002") {
          await prisma.recordedClassView.update({
            where: { recordedClassId_userId: { recordedClassId, userId } },
            data: { viewedAt: new Date(), deviceType, ipAddress: ipAddress as string, location },
          });
        } else {
          throw createError;
        }
      }
    } else {
      await prisma.recordedClassView.update({
        where: { id: existingView.id },
        data: { viewedAt: new Date(), deviceType, ipAddress: ipAddress as string, location },
      });
    }

    res.json({ status: "success", message: "Analytics recorded safely" });
  } catch (error) {
    console.error("Record View Error:", error);
    res.status(500).json({ status: "error", message: "Failed to record view." });
  }
};
