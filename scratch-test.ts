import { PrismaClient } from '@prisma/client';
import { sanitizeUser } from './src/lib/authHelpers';

const prisma = new PrismaClient();

async function main() {
  try {
    const id = '06eb932a-3077-4a6d-8ff0-bf19c4b4f728';
    const student = await prisma.user.findFirst({
      where: { id, role: "STUDENT" },
      include: {
        batchMemberships: { include: { batch: true } },
        enrollments: { include: { course: true } },
        attendances: { orderBy: { date: "desc" }, take: 20 },
        payments: { orderBy: { createdAt: "desc" } },
        assignmentSubmissions: {
          include: { assignment: true },
          orderBy: { submittedAt: "desc" }
        }
      }
    });

    if (!student) {
      console.log("Student not found");
      return;
    }

    const sanitized = sanitizeUser(student);
    const assignmentSubmissions = (student as any).assignmentSubmissions || [];

    const attendances = (student as any).attendances || [];
    const totalAttendances = attendances.length;
    const presentCount = attendances.filter(
      (a: any) => a.status === "PRESENT" || a.status === "present" || a.status === true
    ).length;
    const attendanceRate = totalAttendances > 0 ? `${Math.round((presentCount / totalAttendances) * 100)}%` : "0%";

    const totalSubmissions = assignmentSubmissions.length;
    const gradedCount = assignmentSubmissions.filter(
      (s: any) => s.status === "GRADED" || s.grade
    ).length;
    const assignmentsScore = `${gradedCount} / ${totalSubmissions || 10}`;

    const responseData = {
      status: "success",
      data: {
        ...sanitized,
        batchMemberships: (student as any).batchMemberships,
        enrollments: (student as any).enrollments,
        attendances,
        payments: (student as any).payments || [],
        submissions: assignmentSubmissions,
        attendanceRate,
        assignmentsScore
      }
    };

    console.log("About to stringify responseData");
    const jsonStr = JSON.stringify(responseData);
    console.log("Successfully stringified!");
    
  } catch (error) {
    console.error("Query Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
