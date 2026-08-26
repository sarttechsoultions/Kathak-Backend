import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

const INQUIRY_SOURCES = new Set(["GET_IN_TOUCH", "CONTACT", "INVITATION", "POPUP"]);

function asString(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export const createPublicInquiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const sourceRaw = asString(req.body?.source, 40).toUpperCase() || "GET_IN_TOUCH";
    const source = INQUIRY_SOURCES.has(sourceRaw) ? sourceRaw : "GET_IN_TOUCH";

    if (source === "INVITATION") {
      const fullName = asString(req.body?.fullName, 120);
      const organization = asString(req.body?.organization, 180);
      const email = asString(req.body?.email, 180);
      const phone = asString(req.body?.phone, 40);
      const engagementType = asString(req.body?.engagementType, 120);
      const eventDate = asString(req.body?.eventDate, 40);
      const eventCity = asString(req.body?.eventCity, 180);
      const eventScale = asString(req.body?.eventScale, 120);
      const message = asString(req.body?.message, 4000);

      if (!fullName || !organization || !email || !phone || !engagementType || !eventDate || !eventCity) {
        res.status(400).json({
          status: "error",
          message: "Organizer name, organization, email, phone, engagement type, date, and city are required.",
        });
        return;
      }

      const created = await prisma.inquiry.create({
        data: {
          source,
          fullName,
          contactInfo: email,
          classMode: engagementType,
          subject: `Invitation: ${organization}`,
          message: message || "No additional event description provided.",
          details: {
            organization,
            email,
            phone,
            engagementType,
            eventDate,
            eventCity,
            eventScale,
          },
          status: "NEW",
        },
      });

      res.status(201).json({
        status: "success",
        message: "Invitation received. We will get in touch shortly.",
        data: { id: created.id },
      });
      return;
    }

    const fullName = asString(req.body?.fullName, 120);
    const contactInfo = asString(req.body?.contactInfo, 180);
    const classMode = asString(req.body?.classMode, 40);
    const subject = asString(req.body?.subject, 220);
    const message = asString(req.body?.message, 4000);

    if (!fullName || !contactInfo || !classMode || !subject) {
      res.status(400).json({
        status: "error",
        message: "Full name, contact, class mode, and course are required.",
      });
      return;
    }

    const created = await prisma.inquiry.create({
      data: {
        source,
        fullName,
        contactInfo,
        classMode,
        subject,
        message,
        status: "NEW",
      },
    });

    res.status(201).json({
      status: "success",
      message: "Thank you for reaching out. We will get in touch with you shortly.",
      data: { id: created.id },
    });
  } catch (error) {
    console.error("Error creating public inquiry:", error);
    res.status(500).json({ status: "error", message: "Failed to submit form. Please try again." });
  }
};
