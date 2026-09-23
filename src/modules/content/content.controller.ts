import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotifications } from "../notification/notification.controller";

// Get all content for Admin
export const getAllContentAdmin = async (req: Request, res: Response) => {
  try {
    const isTeacher = req.user?.role === "TEACHER";
    const teacherBatches = isTeacher
      ? await prisma.batch.findMany({ where: { teacherId: req.user!.id }, select: { id: true } })
      : [];
    const batchIds = teacherBatches.map((batch) => batch.id);
    const content = await prisma.contentResource.findMany({
      where: isTeacher ? { OR: [{ uploadedById: req.user!.id }, { batchId: { in: batchIds } }] } : undefined,
      include: {
        batch: { select: { id: true, name: true } },
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
