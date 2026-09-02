import cron from "node-cron";
import { prisma } from "../../lib/prisma";
import { getIO } from "../../lib/socket";

const serialise = (liveClass: any) => ({
  ...liveClass,
  batchName: liveClass.batch.name,
  batchCode: liveClass.batch.code,
  courseName: liveClass.batch.courseName,
});

let isRunning = false;

export function startClassExpiryJob() {
  cron.schedule("* * * * *", async () => {
    // Prevent overlapping cron executions
    if (isRunning) {
      console.log("⏭️ Live class expiry job skipped — previous run still active.");
      return;
    }

    isRunning = true;

    try {
      const now = new Date();

      const expiring = await prisma.liveClass.findMany({
        where: {
          status: {
            in: ["SCHEDULED", "LIVE"],
          },
          scheduledEnd: {
            lt: now,
          },
        },
        include: {
          batch: {
            select: {
              name: true,
              code: true,
              courseName: true,
            },
          },
        },
      });

      if (expiring.length === 0) {
        return;
      }

      const ids = expiring.map((cls) => cls.id);

      await prisma.liveClass.updateMany({
        where: {
          id: {
            in: ids,
          },
          status: {
            in: ["SCHEDULED", "LIVE"],
          },
          scheduledEnd: {
            lt: now,
          },
        },
        data: {
          status: "COMPLETED",
        },
      });

      const io = getIO();

      for (const cls of expiring) {
        io.emit(
          "liveclass:class-updated",
          serialise({
            ...cls,
            status: "COMPLETED",
          })
        );
      }

      console.log(
        `⏰ Auto-expired ${expiring.length} live class(es).`
      );
    } catch (error) {
      console.error("❌ Live class expiry job failed:", error);
    } finally {
      isRunning = false;
    }
  });

  console.log(
    "✅ Live class expiry cron job started (runs every minute)."
  );
}