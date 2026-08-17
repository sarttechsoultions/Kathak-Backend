import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

export const createSupportTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const { subject, message, classMode } = req.body;

    if (!subject || !message) {
      res.status(400).json({ status: "error", message: "Subject and message are required." });
      return;
    }

    // Fetch user details to populate Inquiry
    const userDetails = await prisma.user.findUnique({
      where: { id: user.id },
      select: { fullName: true, email: true, phone: true }
    });

    if (!userDetails) {
      res.status(404).json({ status: "error", message: "User not found" });
      return;
    }

    const inquiry = await prisma.inquiry.create({
      data: {
        userId: user.id,
        fullName: userDetails.fullName,
        contactInfo: userDetails.email,
        classMode: classMode || "ONLINE",
        subject,
        message,
        status: "NEW"
      }
    });

    res.json({ status: "success", message: "Support ticket created successfully", data: inquiry });
  } catch (error) {
    console.error("Create Support Ticket Error:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
};
