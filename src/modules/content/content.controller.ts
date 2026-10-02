import { Request, Response } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { prisma } from "../../lib/prisma";
import { createNotifications } from "../notification/notification.controller";
import { parseCloudinaryUrl, resolveCloudinaryDownloadCandidates } from "../../lib/cloudinaryUrl";

async function canAccessContentResource(userId: string, role: string, resource: { isGlobal: boolean; batchId: string | null; courseId: string | null; uploadedById: string }): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "TEACHER") {
    if (resource.uploadedById === userId) return true;
    return Boolean(await prisma.batch.findFirst({
      where: { teacherId: userId, OR: [{ id: resource.batchId || "" }, { courseId: resource.courseId || "" }] },
      select: { id: true },
    }));
  }

  const [memberships, enrollments] = await Promise.all([
    prisma.batchStudent.findMany({ where: { studentId: userId }, select: { batchId: true, batch: { select: { courseId: true } } } }),
    prisma.enrollment.findMany({ where: { userId, active: true }, select: { courseId: true } }),
  ]);
  const batchIds = new Set(memberships.map((membership) => membership.batchId));
  const courseIds = new Set([...enrollments.map((enrollment) => enrollment.courseId), ...memberships.map((membership) => membership.batch.courseId).filter(Boolean)]);
  return resource.isGlobal || (resource.batchId !== null && batchIds.has(resource.batchId)) || (resource.courseId !== null && courseIds.has(resource.courseId));
}

/** Streams a resource through our authenticated API so protected Cloudinary PDFs
 * never need to be opened with a public Cloudinary URL. */
export const serveContentResource = async (req: Request, res: Response): Promise<void> => {
  try {
    const resource = await prisma.contentResource.findUnique({ where: { id: String(req.params.id) } });
    if (!resource) {
      res.status(404).json({ status: "error", message: "Study material not found." });
      return;
    }
    if (!await canAccessContentResource(req.user!.id, req.user!.role, resource)) {
      res.status(403).json({ status: "error", message: "You do not have access to this study material." });
      return;
    }

    const isDownload = req.path.endsWith("/download");
    const isPdf = resource.type.toUpperCase() === "PDF" || /\.pdf(?:$|\?)/i.test(resource.fileUrl);
    const safeTitle = resource.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "study-material";
    const extension = isPdf ? "pdf" : /\.([a-z0-9]{1,8})(?:$|\?)/i.exec(resource.fileUrl)?.[1] || "file";

    // Development fallback uploads live in backend/uploads. Their URL can still
    // contain PUBLIC_BACKEND_URL (for example the production hostname), which
    // makes a local preview incorrectly try the remote server. If the matching
    // local file exists, serve it directly through this authenticated endpoint.
    try {
      const pathname = new URL(resource.fileUrl).pathname;
      if (pathname.startsWith("/uploads/")) {
        const uploadsRoot = path.resolve(process.cwd(), "uploads");
        const localFile = path.resolve(process.cwd(), `.${pathname}`);
        if (localFile.startsWith(`${uploadsRoot}${path.sep}`) && fs.existsSync(localFile)) {
          const data = fs.readFileSync(localFile);
          const contentType = isPdf ? "application/pdf" : resource.type.toUpperCase() === "IMAGE" ? "image/*" : "application/octet-stream";
          res.status(200).set({
            "Content-Type": contentType,
            "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${safeTitle}.${extension}"`,
            "Content-Length": String(data.byteLength), "Cache-Control": "private, no-store",
          }).send(data);
          return;
        }
      }
    } catch {
      // Not a valid URL or not a local fallback upload; use the normal source below.
    }

    const candidates = parseCloudinaryUrl(resource.fileUrl)
      ? await resolveCloudinaryDownloadCandidates(resource.fileUrl)
      : [resource.fileUrl];
    let file: Awaited<ReturnType<typeof axios.get<ArrayBuffer>>> | null = null;
    for (const candidate of candidates) {
      try {
        file = await axios.get<ArrayBuffer>(candidate, {
          responseType: "arraybuffer", timeout: 45_000, maxContentLength: 100 * 1024 * 1024, maxBodyLength: 100 * 1024 * 1024,
          validateStatus: (status) => status >= 200 && status < 400,
        });
        break;
      } catch {
        // Try the next correctly signed Cloudinary candidate.
      }
    }
    if (!file) {
      res.status(502).json({ status: "error", message: "Could not load this study material. Please try again." });
      return;
    }
    const responseType = String(file.headers["content-type"] || "application/octet-stream").split(";")[0];
    res.status(200).set({
      "Content-Type": isPdf ? "application/pdf" : responseType,
      "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${safeTitle}.${extension}"`,
      "Content-Length": String(file.data.byteLength), "Cache-Control": "private, no-store",
    }).send(Buffer.from(file.data));
  } catch (error) {
    console.error("Content preview error:", error);
    if (!res.headersSent) res.status(502).json({ status: "error", message: "Could not load this study material. Please try again." });
  }
};

// Get all content for Admin
export const getAllContentAdmin = async (req: Request, res: Response) => {
  try {
    const isTeacher = req.user?.role === "TEACHER";
    const teacherBatches = isTeacher
      ? await prisma.batch.findMany({ where: { teacherId: req.user!.id }, select: { id: true, courseId: true } })
      : [];
    const batchIds = teacherBatches.map((batch) => batch.id);
    const courseIds = [...new Set(teacherBatches.map((batch) => batch.courseId).filter(Boolean))] as string[];
    const content = await prisma.contentResource.findMany({
      where: isTeacher ? { OR: [{ uploadedById: req.user!.id }, { batchId: { in: batchIds } }, { courseId: { in: courseIds } }] } : undefined,
      include: {
        batch: { select: { id: true, name: true } },
        course: { select: { id: true, title: true } },
        uploadedBy: { select: { id: true, fullName: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    res.status(200).json({ status: "success", data: content });
  } catch (error: any) {
    console.error("Error fetching content admin:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch content" });
  }
};

// Get content for Student (Global + Batch specific)
export const getStudentContent = async (req: Request, res: Response) => {
  try {
    const studentId = req.user!.id;
    
    // Find the student's batch
    const [batchStudents, enrollments] = await Promise.all([
      prisma.batchStudent.findMany({ where: { studentId }, select: { batchId: true, batch: { select: { courseId: true } } } }),
      prisma.enrollment.findMany({ where: { userId: studentId, active: true }, select: { courseId: true } }),
    ]);

    const whereClause: any = {
      OR: [{ isGlobal: true }]
    };

    const batchIds = batchStudents.map((membership) => membership.batchId);
    const courseIds = [...new Set([...enrollments.map((enrollment) => enrollment.courseId), ...batchStudents.map((membership) => membership.batch.courseId).filter(Boolean)])];
    if (batchIds.length) whereClause.OR.push({ batchId: { in: batchIds } });
    if (courseIds.length) whereClause.OR.push({ courseId: { in: courseIds } });

    const content = await prisma.contentResource.findMany({
      where: whereClause,
      include: {
        uploadedBy: { select: { id: true, fullName: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    res.status(200).json({ status: "success", data: content });
  } catch (error: any) {
    console.error("Error fetching student content:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch content" });
  }
};

// Download one resource only after applying the same global, batch, and course
// visibility rules that the student content library uses.
export const downloadStudentContent = async (req: Request, res: Response): Promise<void> => {
  try {
    const studentId = req.user!.id;
    const resourceId = String(req.params.id);
    const [resource, batchStudents, enrollments] = await Promise.all([
      prisma.contentResource.findUnique({ where: { id: resourceId } }),
      prisma.batchStudent.findMany({
        where: { studentId },
        select: { batchId: true, batch: { select: { courseId: true } } },
      }),
      prisma.enrollment.findMany({
        where: { userId: studentId, active: true },
        select: { courseId: true },
      }),
    ]);

    if (!resource) {
      res.status(404).json({ status: "error", message: "Study material not found." });
      return;
    }

    const batchIds = new Set(batchStudents.map((membership) => membership.batchId));
    const courseIds = new Set([
      ...enrollments.map((enrollment) => enrollment.courseId),
      ...batchStudents.map((membership) => membership.batch.courseId).filter(Boolean),
    ]);
    const canAccess = resource.isGlobal ||
      (resource.batchId !== null && batchIds.has(resource.batchId)) ||
      (resource.courseId !== null && courseIds.has(resource.courseId));

    if (!canAccess) {
      res.status(403).json({ status: "error", message: "You do not have access to download this study material." });
      return;
    }

    let source: URL;
    try {
      source = new URL(resource.fileUrl);
      if (source.protocol !== "https:" && source.protocol !== "http:") throw new Error("Invalid protocol");
    } catch {
      res.status(422).json({ status: "error", message: "The study material file URL is invalid." });
      return;
    }

    const file = await axios.get<ArrayBuffer>(source.toString(), {
      responseType: "arraybuffer",
      timeout: 30_000,
      maxContentLength: 100 * 1024 * 1024,
      maxBodyLength: 100 * 1024 * 1024,
    });
    const extension = /\.([a-z0-9]{1,8})(?:$|\?)/i.exec(source.pathname)?.[1] || "file";
    const safeTitle = resource.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "study-material";
    const contentType = String(file.headers["content-type"] || "application/octet-stream").split(";")[0];

    res.status(200).set({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeTitle}.${extension}"`,
      "Content-Length": String(file.data.byteLength),
      "Cache-Control": "private, no-store",
    }).send(Buffer.from(file.data));
  } catch (error) {
    console.error("Content download error:", error);
    res.status(502).json({ status: "error", message: "Could not download this study material. Please try again." });
  }
};

// Create a new content resource (Admin)
export const createContentResource = async (req: Request, res: Response) => {
  try {
    const uploaderId = req.user!.id;
    const isTeacher = req.user?.role === "TEACHER";
    const { title, description, type, fileUrl, category, isGlobal, batchId, courseId } = req.body;

    if (!title || !type || !fileUrl) {
      return res.status(400).json({ status: "error", message: "Title, Type, and File URL are required" });
    }
    const global = isGlobal === true || isGlobal === "true";
    if (isTeacher && (global || (!batchId && !courseId))) {
      return res.status(400).json({ status: "error", message: "Teachers must select one of their batches or courses." });
    }
    if (isTeacher) {
      const teacher = await prisma.user.findUnique({ where: { id: uploaderId }, select: { canUploadStudyMaterial: true } });
      if (!teacher?.canUploadStudyMaterial) {
        return res.status(403).json({ status: "error", message: "Study-material uploads are locked. Please ask an administrator to enable this access." });
      }
      const ownedBatch = await prisma.batch.findFirst({ where: { teacherId: uploaderId, OR: [{ id: String(batchId || "") }, { courseId: String(courseId || "") }] }, select: { id: true } });
      if (!ownedBatch) {
        return res.status(403).json({ status: "error", message: "You can upload material only for your own batches or courses." });
      }
    }

    const newResource = await prisma.contentResource.create({
      data: {
        title,
        description,
        type,
        fileUrl,
        category: category || "Syllabus",
        isGlobal: global,
        batchId: global || courseId ? null : batchId,
        courseId: global ? null : courseId || null,
        uploadedById: uploaderId
      }
    });

    // Deliver a resource notification to exactly the students who can see it.
    // This mirrors getStudentContent's visibility rules (global, batch, course)
    // so the bell never advertises material a student cannot open.
    const recipientIds = new Set<string>();
    if (global) {
      const students = await prisma.user.findMany({
        where: { role: "STUDENT", isActive: true },
        select: { id: true },
      });
      students.forEach((student) => recipientIds.add(student.id));
    } else {
      if (batchId) {
        const students = await prisma.batchStudent.findMany({
          where: { batchId: String(batchId) },
          select: { studentId: true },
        });
        students.forEach((student) => recipientIds.add(student.studentId));
      }
      if (courseId) {
        const students = await prisma.enrollment.findMany({
          where: { courseId: String(courseId), active: true },
          select: { userId: true },
        });
        students.forEach((student) => recipientIds.add(student.userId));
      }
    }

    await createNotifications(
      [...recipientIds].map((userId) => ({
        userId,
        type: "SYLLABUS_AVAILABLE",
        title: "New syllabus available",
        message: `“${newResource.title}” has been added to your study material.`,
        link: "/student/content",
      }))
    );

    // Admin uploads for a batch/course are also sent to the teachers assigned
    // to those batches, so they can act on the same syllabus or notes.
    if (!isTeacher && !global && (batchId || courseId)) {
      const teacherBatches = await prisma.batch.findMany({
        where: {
          teacherId: { not: null },
          OR: [
            ...(batchId ? [{ id: String(batchId) }] : []),
            ...(courseId ? [{ courseId: String(courseId) }] : []),
          ],
        },
        select: { teacherId: true },
      });
      const teacherIds = [...new Set(teacherBatches.map((batch) => batch.teacherId).filter(Boolean))] as string[];
      await createNotifications(teacherIds.map((userId) => ({
        userId,
        type: "SYLLABUS_AVAILABLE",
        title: "New syllabus or note posted",
        message: `“${newResource.title}” has been added for one of your batches.`,
        link: "/teacher/syllabus",
      })));
    }

    res.status(201).json({ status: "success", data: newResource });
  } catch (error: any) {
    console.error("Error creating content:", error);
    res.status(500).json({ status: "error", message: "Failed to create content resource" });
  }
};

// Delete a content resource
export const deleteContentResource = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!id) {
      return res.status(400).json({ status: "error", message: "Content ID is required" });
    }

    const resource = await prisma.contentResource.findUnique({ where: { id }, select: { uploadedById: true } });
    if (!resource) {
      return res.status(404).json({ status: "error", message: "Resource not found" });
    }
    if (req.user?.role === "TEACHER" && resource.uploadedById !== req.user.id) {
      return res.status(403).json({ status: "error", message: "You can delete only material you uploaded." });
    }
    await prisma.contentResource.delete({
      where: { id }
    });

    res.status(200).json({ status: "success", message: "Resource deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting content:", error);
    res.status(500).json({ status: "error", message: "Failed to delete content resource" });
  }
};
