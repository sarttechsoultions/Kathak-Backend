import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { sendEmail } from "../../lib/mailer";
import { notifyAdmins } from "../notification/notification.controller";
import { env } from "../../config/env";

const INQUIRY_SOURCES = new Set(["GET_IN_TOUCH", "CONTACT", "INVITATION", "PERFORMANCE_BOOKING", "POPUP"]);

function asString(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}

async function alertAdminsAboutInquiry(input: {
  source: string;
  fullName: string;
  contact: string;
  subject: string;
  message: string;
}) {
  const sourceLabel = input.source === "PERFORMANCE_BOOKING"
    ? "Performance Booking"
    : input.source.replace(/_/g, " ");
  const title = `New ${sourceLabel} request`;
  const dashboardLink = `${env.frontendUrl.replace(/\/$/, "")}/admin/inquiries`;

  // Notification center + live/Firebase push notification for every active admin.
  await notifyAdmins(
    "INQUIRY_RECEIVED",
    title,
    `${input.fullName} submitted: ${input.subject}`,
    dashboardLink
  );

  // Email failure must never prevent a visitor's request from being saved.
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { email: true },
  });
  const safeName = escapeHtml(input.fullName);
  const safeContact = escapeHtml(input.contact);
  const safeSubject = escapeHtml(input.subject);
  const safeMessage = escapeHtml(input.message);

  await Promise.allSettled(
    admins.map((admin) => sendEmail({
      to: admin.email,
      subject: `${title} — ${input.fullName}`,
      html: `<h2>${title}</h2><p>A new website enquiry needs your attention.</p><p><strong>Name:</strong> ${safeName}<br /><strong>Contact:</strong> ${safeContact}<br /><strong>Subject:</strong> ${safeSubject}</p><p><strong>Message:</strong><br />${safeMessage.replace(/\n/g, "<br />")}</p><p><a href="${dashboardLink}">Open Get in Touch</a></p>`,
    }))
  );
}

export const createPublicInquiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const sourceRaw = asString(req.body?.source, 40).toUpperCase() || "GET_IN_TOUCH";
    const source = INQUIRY_SOURCES.has(sourceRaw) ? sourceRaw : "GET_IN_TOUCH";

    if (source === "INVITATION" || source === "PERFORMANCE_BOOKING") {
      const fullName = asString(req.body?.fullName, 120);
      const organization = asString(req.body?.organization, 180);
      const email = asString(req.body?.email, 180);
      const phone = asString(req.body?.phone, 40);
      const engagementType = asString(req.body?.engagementType, 120);
      const eventType = asString(req.body?.eventType, 120);
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
          subject: `${source === "PERFORMANCE_BOOKING" ? "Performance booking" : "Invitation"}: ${organization}`,
          message: message || "No additional event description provided.",
          details: {
            organization,
            email,
            phone,
            engagementType,
            eventType,
            eventDate,
            eventCity,
            eventScale,
          },
          status: "NEW",
        },
      });

      void alertAdminsAboutInquiry({
        source,
        fullName,
        contact: `${email} · ${phone}`,
        subject: created.subject,
        message: created.message,
      }).catch((notificationError) => {
        console.error("Failed to alert admins about a public inquiry:", notificationError);
      });

      res.status(201).json({
        status: "success",
        message: source === "PERFORMANCE_BOOKING"
          ? "Performance booking request received. We will get in touch shortly."
          : "Invitation received. We will get in touch shortly.",
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

    void alertAdminsAboutInquiry({
      source,
      fullName,
      contact: contactInfo,
      subject,
      message: message || "No additional message provided.",
    }).catch((notificationError) => {
      console.error("Failed to alert admins about a public inquiry:", notificationError);
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
