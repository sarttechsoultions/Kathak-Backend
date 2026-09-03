import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import nodemailer from "nodemailer";
import { env } from "../../config/env";

/**
 * Escape HTML characters before putting user input into email HTML.
 */
const escapeHtml = (value: unknown): string => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * Create SMTP transporter using centralized env config.
 */
const createTransporter = () => {
  return nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
  });
};

/**
 * Create Support Ticket
 *
 * GENERAL issue:
 *   User -> Admin Support
 *
 * TECHNICAL issue:
 *   User -> Admin Support
 *   User -> Developer Team
 */
export const createSupportTicket = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;

    if (!user) {
      res.status(401).json({
        status: "error",
        message: "Unauthorized",
      });
      return;
    }

    const {
      subject,
      message,
      classMode,
      issueType,
    } = req.body;

    // --------------------------------------------------
    // Validation
    // --------------------------------------------------

    if (!subject || !String(subject).trim()) {
      res.status(400).json({
        status: "error",
        message: "Subject is required.",
      });
      return;
    }

    if (!message || !String(message).trim()) {
      res.status(400).json({
        status: "error",
        message: "Message is required.",
      });
      return;
    }

    const normalizedIssueType =
      String(issueType || "GENERAL").toUpperCase() === "TECHNICAL"
        ? "TECHNICAL"
        : "GENERAL";

    // --------------------------------------------------
    // Get user details
    // --------------------------------------------------

    const userDetails = await prisma.user.findUnique({
      where: {
        id: user.id,
      },
      select: {
        fullName: true,
        email: true,
        phone: true,
      },
    });

    if (!userDetails) {
      res.status(404).json({
        status: "error",
        message: "User not found.",
      });
      return;
    }

    // --------------------------------------------------
    // Create ticket in DB
    // --------------------------------------------------

    const inquiry = await prisma.inquiry.create({
      data: {
        userId: user.id,
        fullName: userDetails.fullName,
        contactInfo: userDetails.email,
        classMode: classMode || "ONLINE",
        source: "SUPPORT",
        subject: String(subject).trim(),
        message: String(message).trim(),
        status: "NEW",
      },
    });

    // --------------------------------------------------
    // Email configuration
    // --------------------------------------------------

    const adminSupportEmail =
      process.env.ADMIN_SUPPORT_EMAIL || env.smtp.user;

    const developerEmail =
      process.env.DEV_TEAM_EMAIL;

    const transporter = createTransporter();

    const safeName = escapeHtml(userDetails.fullName);
    const safeEmail = escapeHtml(userDetails.email);
    const safePhone = escapeHtml(userDetails.phone || "Not provided");
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);
    const safeIssueType = escapeHtml(normalizedIssueType);
    const safeClassMode = escapeHtml(classMode || "ONLINE");
    const safeTicketId = escapeHtml(inquiry.id);

    // --------------------------------------------------
    // Common email HTML
    // --------------------------------------------------

    const emailHtml = `
      <div
        style="
          font-family: Arial, Helvetica, sans-serif;
          background:#f6f6f6;
          padding:30px;
        "
      >
        <div
          style="
            max-width:700px;
            margin:0 auto;
            background:#ffffff;
            border:1px solid #e5e5e5;
            border-radius:14px;
            overflow:hidden;
          "
        >

          <div
            style="
              background:#9E0C25;
              color:#ffffff;
              padding:22px 25px;
            "
          >
            <h2 style="margin:0;font-size:21px;">
              Kathak Support Ticket
            </h2>

            <p
              style="
                margin:6px 0 0;
                font-size:13px;
                opacity:.9;
              "
            >
              New support request received from the platform.
            </p>
          </div>

          <div style="padding:25px;">

            <div
              style="
                display:inline-block;
                padding:7px 12px;
                border-radius:20px;
                background:${
                  normalizedIssueType === "TECHNICAL"
                    ? "#fff1f2"
                    : "#f3f4f6"
                };
                color:${
                  normalizedIssueType === "TECHNICAL"
                    ? "#be123c"
                    : "#374151"
                };
                font-size:12px;
                font-weight:bold;
                margin-bottom:18px;
              "
            >
              ${safeIssueType} SUPPORT
            </div>

            <table
              style="
                width:100%;
                border-collapse:collapse;
                font-size:13px;
              "
            >
              <tr>
                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                    font-weight:bold;
                    width:140px;
                  "
                >
                  Ticket ID
                </td>

                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                  "
                >
                  ${safeTicketId}
                </td>
              </tr>

              <tr>
                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                    font-weight:bold;
                  "
                >
                  User Name
                </td>

                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                  "
                >
                  ${safeName}
                </td>
              </tr>

              <tr>
                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                    font-weight:bold;
                  "
                >
                  Email
                </td>

                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                  "
                >
                  ${safeEmail}
                </td>
              </tr>

              <tr>
                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                    font-weight:bold;
                  "
                >
                  Phone
                </td>

                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                  "
                >
                  ${safePhone}
                </td>
              </tr>

              <tr>
                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                    font-weight:bold;
                  "
                >
                  Issue Type
                </td>

                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                  "
                >
                  ${safeIssueType}
                </td>
              </tr>

              <tr>
                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                    font-weight:bold;
                  "
                >
                  Class Mode
                </td>

                <td
                  style="
                    padding:10px;
                    border:1px solid #e5e7eb;
                  "
                >
                  ${safeClassMode}
                </td>
              </tr>
            </table>

            <div
              style="
                margin-top:22px;
                padding:18px;
                background:#fafafa;
                border-left:4px solid #9E0C25;
                border-radius:6px;
              "
            >
              <h3
                style="
                  margin:0 0 10px;
                  font-size:16px;
                  color:#111827;
                "
              >
                ${safeSubject}
              </h3>

              <p
                style="
                  margin:0;
                  color:#374151;
                  font-size:13px;
                  line-height:1.7;
                  white-space:pre-wrap;
                "
              >
                ${safeMessage}
              </p>
            </div>

            ${
              normalizedIssueType === "TECHNICAL"
                ? `
                  <div
                    style="
                      margin-top:20px;
                      padding:14px 16px;
                      background:#fff7ed;
                      border:1px solid #fed7aa;
                      border-radius:8px;
                      color:#9a3412;
                      font-size:12px;
                      font-weight:bold;
                    "
                  >
                    ⚠️ Technical issue detected.
                    This ticket has also been forwarded to the
                    Developer Team for technical investigation.
                  </div>
                `
                : ""
            }

            <p
              style="
                color:#9ca3af;
                font-size:11px;
                margin-top:25px;
              "
            >
              This is an automated message from the
              Kathak Management System.
            </p>

          </div>
        </div>
      </div>
    `;

    // --------------------------------------------------
    // 1. ALWAYS SEND TO ADMIN SUPPORT
    // --------------------------------------------------

    await transporter.sendMail({
      from: `"Kathak Support System" <${env.smtp.from || env.smtp.user}>`,
      to: adminSupportEmail,
      replyTo: userDetails.email,
      subject: `🎫 Support Ticket #${inquiry.id} - ${String(subject).trim()}`,
      html: emailHtml,
    });

    // --------------------------------------------------
    // 2. IF TECHNICAL -> ALSO SEND TO DEVELOPER
    // --------------------------------------------------

    let developerForwarded = false;

   if (normalizedIssueType === "TECHNICAL") {
  if (!developerEmail) {
    console.error(
      `❌ DEV_TEAM_EMAIL is not configured. Ticket ${inquiry.id} cannot be forwarded to developer.`
    );
  } else {
    try {
      console.log(
        `📧 Sending technical ticket ${inquiry.id} to developer: ${developerEmail}`
      );

      const developerMailResult = await transporter.sendMail({
        from: `"Kathak Support System" <${env.smtp.from || env.smtp.user}>`,
        to: developerEmail,
        replyTo: userDetails.email,
        subject: `🚨 TECHNICAL ISSUE #${inquiry.id}: ${String(subject).trim()}`,
        html: emailHtml,
      });

      console.log(
        `✅ Developer email sent successfully. Ticket: ${inquiry.id}, Message ID: ${developerMailResult.messageId}`
      );

      developerForwarded = true;
    } catch (developerError) {
      console.error(
        `❌ Failed to send developer email for ticket ${inquiry.id}:`,
        developerError
      );

      // IMPORTANT:
      // Do not fail the complete support ticket just because
      // developer email failed.
    }
  }
}

    // --------------------------------------------------
    // 3. Update ticket status if developer received it
    // --------------------------------------------------

    if (developerForwarded) {
      await prisma.inquiry.update({
        where: {
          id: inquiry.id,
        },
        data: {
          status: "ESCALATED",
        },
      });
    }

    // --------------------------------------------------
    // Response
    // --------------------------------------------------

    res.status(201).json({
      status: "success",
      message:
        normalizedIssueType === "TECHNICAL" && developerForwarded
          ? "Support ticket created and forwarded to Admin Support and Developer Team."
          : "Support ticket created successfully and sent to Admin Support.",
      data: {
        ...inquiry,
        issueType: normalizedIssueType,
        developerForwarded,
      },
    });
  } catch (error) {
    console.error("Create Support Ticket Error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to create support ticket.",
    });
  }
};

/**
 * Manual Developer Escalation
 *
 * This can still be used by Admin from the
 * Admin Support/Ticket dashboard.
 */
export const forwardToDeveloper = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const inquiry = await prisma.inquiry.findUnique({
      where: {
        id: id as string,
      },
    });

    if (!inquiry) {
      res.status(404).json({
        status: "error",
        message: "Inquiry not found",
      });
      return;
    }

    const developerEmail = process.env.DEV_TEAM_EMAIL;

    if (!developerEmail) {
      res.status(500).json({
        status: "error",
        message: "Developer team email is not configured.",
      });
      return;
    }

    const transporter = createTransporter();

    const safeName = escapeHtml(inquiry.fullName);
    const safeContact = escapeHtml(inquiry.contactInfo);
    const safeSubject = escapeHtml(inquiry.subject);
    const safeMessage = escapeHtml(inquiry.message);
    const safeTicketId = escapeHtml(inquiry.id);

    const mailOptions = {
      from: `"Kathak Support System" <${env.smtp.from || env.smtp.user}>`,
      to: developerEmail,
      subject: `🚨 SYSTEM BUG ESCALATION #${inquiry.id}: ${inquiry.subject}`,
      html: `
        <div
          style="
            font-family:Arial,Helvetica,sans-serif;
            background:#f6f6f6;
            padding:30px;
          "
        >
          <div
            style="
              max-width:700px;
              margin:auto;
              background:#fff;
              border:1px solid #e5e5e5;
              border-radius:14px;
              padding:25px;
            "
          >

            <h2 style="color:#9E0C25;margin-top:0;">
              🚨 Technical Issue Escalation
            </h2>

            <p style="font-size:13px;color:#555;">
              Admin has escalated this support ticket to the
              Developer Team for technical investigation.
            </p>

            <table
              style="
                width:100%;
                border-collapse:collapse;
                margin-top:20px;
                font-size:13px;
              "
            >
              <tr>
                <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">
                  Ticket ID
                </td>
                <td style="padding:10px;border:1px solid #ddd;">
                  ${safeTicketId}
                </td>
              </tr>

              <tr>
                <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">
                  User Name
                </td>
                <td style="padding:10px;border:1px solid #ddd;">
                  ${safeName}
                </td>
              </tr>

              <tr>
                <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">
                  User Contact
                </td>
                <td style="padding:10px;border:1px solid #ddd;">
                  ${safeContact}
                </td>
              </tr>
            </table>

            <div
              style="
                margin-top:20px;
                padding:18px;
                background:#fafafa;
                border-left:4px solid #9E0C25;
              "
            >
              <h3 style="margin-top:0;">
                ${safeSubject}
              </h3>

              <p
                style="
                  white-space:pre-wrap;
                  line-height:1.7;
                  color:#374151;
                  font-size:13px;
                "
              >
                ${safeMessage}
              </p>
            </div>

            <p
              style="
                color:#999;
                font-size:11px;
                margin-top:25px;
              "
            >
              Automated escalation from Kathak Management System.
            </p>

          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    await prisma.inquiry.update({
      where: {
        id: inquiry.id,
      },
      data: {
        status: "ESCALATED",
      },
    });

    res.status(200).json({
      status: "success",
      message: "Ticket escalated to Developer Team successfully.",
    });
  } catch (error) {
    console.error("Escalation Error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to escalate ticket.",
    });
  }
};