import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { getStudentAccessState } from "../modules/student/access.service";

export async function requireActiveStudentAccess(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Lock enforcement is strictly for STUDENT role
    if (user.role !== Role.STUDENT) {
      return next();
    }

    const access = await getStudentAccessState(user.id);

    if (access.isLocked) {
      return res.status(403).json({
        error: "Access locked due to overdue payment",
        accessState: access.accessState,
        isLocked: true,
        amountDue: access.amountDue,
        currency: access.currency,
        dueMonth: access.dueMonth,
        dueDate: access.dueDate,
        daysOverdue: access.daysOverdue,
        message:
          "Your learning access is temporarily locked due to overdue fees. Please pay your dues to restore access.",
      });
    }

    return next();
  } catch (error) {
    console.error("Failed to verify student access state:", error);
    return next(error);
  }
}
