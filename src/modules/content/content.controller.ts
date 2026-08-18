import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

// Get all content for Admin
export const getAllContentAdmin = async (req: Request, res: Response) => {
  try {
    const content = await prisma.contentResource.findMany({
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
    const batchStudent = await prisma.batchStudent.findFirst({
      where: { studentId }
    });

    const whereClause: any = {
      OR: [{ isGlobal: true }]
    };

    if (batchStudent) {
      whereClause.OR.push({ batchId: batchStudent.batchId });
    }

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
    const adminId = req.user!.id;
    const { title, description, type, fileUrl, category, isGlobal, batchId } = req.body;

    if (!title || !type || !fileUrl) {
      return res.status(400).json({ status: "error", message: "Title, Type, and File URL are required" });
    }

    const newResource = await prisma.contentResource.create({
      data: {
        title,
        description,
        type,
        fileUrl,
        category: category || "General",
        isGlobal: isGlobal === true || isGlobal === "true",
        batchId: isGlobal ? null : batchId,
        uploadedById: adminId
      }
    });

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

    await prisma.contentResource.delete({
      where: { id }
    });

    res.status(200).json({ status: "success", message: "Resource deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting content:", error);
    res.status(500).json({ status: "error", message: "Failed to delete content resource" });
  }
};
