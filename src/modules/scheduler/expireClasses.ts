import cron from "node-cron";
import { prisma } from "../../lib/prisma";
import { getIO } from "../../lib/socket";
import { broadcastLiveClassEvent } from "../liveclass/liveclass.events";

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

      // A class must become LIVE even when nobody has opened its room yet.
      // Without this, student dashboards can drop a scheduled class at its
      // start time until somebody manually triggers the join-token endpoint.
      const starting = await prisma.liveClass.findMany({
        where: {
          status: "SCHEDULED",
          scheduledStart: { lte: now },
          scheduledEnd: { gt: now },
        },
        include: {
          batch: { select: { name: true, code: true, courseName: true } },
        },
      });

      if (starting.length > 0) {
        await prisma.liveClass.updateMany({
          where: { id: { in: starting.map((cls) => cls.id) }, status: "SCHEDULED" },
          data: { status: "LIVE" },
        });
        const io = getIO();
        for (const cls of starting) {
          broadcastLiveClassEvent(io, "liveclass:class-updated", serialise({ ...cls, status: "LIVE" }));
        }
      }

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
        broadcastLiveClassEvent(
          io,
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
