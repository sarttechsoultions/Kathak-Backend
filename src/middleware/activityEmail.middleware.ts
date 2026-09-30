import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { sendEmail } from "../lib/mailer";
import { prisma } from "../lib/prisma";

const ADMIN_ACTIVITY_EMAIL = "kathakbyharshita@gmail.com";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function describeActivity(req: Request, portal: "Student" | "Teacher"): string {
  const path = `${req.baseUrl}${req.path}`.toLowerCase();
  const verb = req.method === "DELETE" ? "removed" : req.method === "POST" ? "submitted" : "updated";

  if (path.includes("/profile")) return `${verb} their profile`;
  if (path.includes("/settings")) return `${verb} account settings`;
  if (path.includes("/reset-password") || path.includes("/password")) return "changed their password";
  if (path.includes("/attendance")) return `${verb} attendance`;
  if (path.includes("/leave")) return `${verb} a leave request`;
  if (path.includes("/reschedule")) return `${verb} a reschedule request`;
  if (path.includes("/assignment")) return `${verb} an assignment`;
  if (path.includes("/exam")) return `${verb} an exam response`;
  if (path.includes("/competition")) return `${verb} a competition entry`;
  if (path.includes("/event")) return `${verb} an event registration`;
  if (path.includes("/payment") || path.includes("/enroll")) return `${verb} an enrollment or payment request`;
  if (path.includes("/upload") || path.includes("/media")) return "uploaded a file";
  if (path.includes("/class") || path.includes("/live")) return `${verb} class-related information`;
  if (path.includes("/video")) return `${verb} a video submission`;

  return `${verb} information in the ${portal.toLowerCase()} portal`;
}

/**
 * Emails the academy administrator after a successful, authenticated action
 * performed by a student or teacher. Reads are deliberately excluded: opening
 * a dashboard or refreshing a page must not create a flood of email.
 */
export function notifyAdminOfPortalActivity(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    const user = req.user;
    const activityPath = `${req.baseUrl}${req.path}`.replace(/\/+$/, "").toLowerCase();
    if (
      !user ||
      !MUTATING_METHODS.has(req.method) ||
      res.statusCode < 200 ||
      res.statusCode >= 300 ||
      // New reschedule requests send a detailed, awaited academy email from
      // the controller. Skip the generic background email to avoid duplicates.
      (req.method === "POST" && activityPath === "/api/v1/reschedule") ||
      (user.role !== Role.STUDENT && user.role !== Role.TEACHER)
    ) {
      return;
    }

    const portal = user.role === Role.STUDENT ? "Student" : "Teacher";
    const description = describeActivity(req, portal);
    void (async () => {
      const profile = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          fullName: true,
          batchMemberships: { select: { batch: { select: { name: true, courseName: true } } } },
          batchesAsTeacher: { select: { name: true, courseName: true } },
          enrollments: { where: { active: true }, select: { course: { select: { title: true } } } },
        },
      });

      const batches = user.role === Role.STUDENT
        ? profile?.batchMemberships.map((entry) => entry.batch) ?? []
        : profile?.batchesAsTeacher ?? [];
      const courses = new Set([
        ...batches.map((batch) => batch.courseName),
        ...(user.role === Role.STUDENT ? profile?.enrollments.map((entry) => entry.course.title) ?? [] : []),
      ].filter(Boolean));
      const batchNames = batches.map((batch) => batch.name).filter(Boolean);
      const name = profile?.fullName || user.email;

      await sendEmail({
        to: ADMIN_ACTIVITY_EMAIL,
        subject: `${portal}: ${description.charAt(0).toUpperCase()}${description.slice(1)}`,
        html: `
          <h2 style="margin:0 0 12px; color:#900C27;">${portal} activity recorded</h2>
          <p><strong>${name}</strong> (${user.email}) ${description}.</p>
          <p><strong>Activity:</strong> ${description.charAt(0).toUpperCase()}${description.slice(1)}</p>
          <p><strong>Course${courses.size === 1 ? "" : "s"}:</strong> ${courses.size ? [...courses].join(", ") : "Not assigned"}</p>
          <p><strong>Batch${batchNames.length === 1 ? "" : "es"}:</strong> ${batchNames.length ? batchNames.join(", ") : "Not assigned"}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
          <p style="color:#6d5a5e;">No private form values or passwords are included in this notification.</p>
        `,
      });
    })().catch((error) => console.error("Activity email lookup failed:", error));
  });

  next();
}
