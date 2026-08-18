import cron from "node-cron";
import { prisma } from "../../lib/prisma";
import { getIO } from "../../lib/socket";

const serialise = (liveClass: any) => ({
  ...liveClass,
  batchName: liveClass.batch.name,
  batchCode: liveClass.batch.code,
  courseName: liveClass.batch.courseName,
});

export function startClassExpiryJob() {
  cron.schedule("* * * * *", async () => { // ✅ har 1 min pe check — real-time feel ke liye
    const now = new Date();

    const expiring = await prisma.liveClass.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE"] },
        scheduledEnd: { lt: now },
      },
      include: { batch: { select: { name: true, code: true, courseName: true } } },
    });

    if (expiring.length === 0) return;

    await prisma.liveClass.updateMany({
      where: { id: { in: expiring.map((c) => c.id) } },
      data: { status: "COMPLETED" },
    });

    const io = getIO();
    for (const cls of expiring) {
      io.emit("liveclass:class-updated", serialise({ ...cls, status: "COMPLETED" }));
    }

    console.log(`⏰ Auto-expired ${expiring.length} live class(es).`);
  });

  console.log("✅ Live class expiry cron job started (runs every minute).");
}