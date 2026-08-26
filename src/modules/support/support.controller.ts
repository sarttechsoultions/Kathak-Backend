import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import nodemailer from "nodemailer";
import { env } from "../../config/env";

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
        source: "SUPPORT",
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


export const forwardToDeveloper = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // 1. Ticket details database se fetch karein
    const inquiry = await prisma.inquiry.findUnique({
      where: { id: id as string },
    });

    if (!inquiry) {
      res.status(404).json({ status: "error", message: "Inquiry not found" });
      return;
    }

    // 2. Nodemailer Transporter Setup (Using centralized env config)
    const transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: {
        user: env.smtp.user, // ✅ Fixed to use env.ts mapping
        pass: env.smtp.pass, // ✅ Fixed to use env.ts mapping
      },
    });

    // 3. Email ka Content (HTML Format)
    const mailOptions = {
      from: `"Kathak Support System" <${env.smtp.from || env.smtp.user}>`,
      to: process.env.DEV_TEAM_EMAIL || "developer@aapkidomain.com",
      subject: `🚨 SYSTEM BUG ESCALATION: ${inquiry.subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #9E0C25;">New System Bug / Issue Escalated</h2>
          <p>Admin has escalated a support ticket that requires technical investigation.</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; width: 120px;">Ticket ID</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${inquiry.id}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">User Name</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${inquiry.fullName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">User Contact</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${inquiry.contactInfo}</td>
            </tr>
          </table>

          <div style="margin-top: 20px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid #9E0C25;">
            <h4 style="margin-top: 0;">Subject: ${inquiry.subject}</h4>
            <p style="white-space: pre-wrap;">${inquiry.message}</p>
          </div>
          
          <p style="color: #666; font-size: 12px; margin-top: 20px;">This is an automated message from the Kathak Management System.</p>
        </div>
      `,
    };

    // 4. Email Send Karein
    await transporter.sendMail(mailOptions);

    // 5. Database mein Status Update Karein
    await prisma.inquiry.update({
      where: { id: id as string },
      data: { status: "ESCALATED" },
    });

    res.status(200).json({ status: "success", message: "Bug escalated to developers successfully" });
  } catch (error) {
    console.error("Escalation Error:", error);
    res.status(500).json({ status: "error", message: "Failed to escalate ticket" });
  }
};