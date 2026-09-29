
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const studentId = "some-id"; // Just to compile
  try {
    const student = await prisma.user.findFirst({ where: { role: "STUDENT" } });
    if (!student) return console.log("No student");
    
    const attendanceLogs = await prisma.attendance.findMany({
      where: { studentId: student.id },
      orderBy: { date: "desc" }
    });

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: { userId: student.id },
      orderBy: { startDate: "desc" }
    });

    const logs = [
      ...attendanceLogs.map((a) => ({
        id: a.id,
        date: a.date,
        startDate: a.date,
        endDate: a.date,
        type: "attendance",
        className: a.session || a.batchName || "Class Session",
        time: a.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        status: a.status,
      })),
      ...leaveRequests.map((l) => ({
        id: l.id,
        date: l.startDate,
        startDate: l.startDate,
        endDate: l.endDate,
        type: "leave",
        className: l.leaveType,
        status: l.status === "APPROVED" ? "LEAVE" : (l.status === "PENDING" ? "PENDING" : "REJECTED"),
        leaveStatus: l.status,
        reason: l.reason,
        reviewReason: l.reviewReason,
        attachment: l.attachment,
      }))
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    console.log("Success", logs.length);
  } catch (err) {
    console.error("Error:", err);
  }
  await prisma.$disconnect();
}
main();

