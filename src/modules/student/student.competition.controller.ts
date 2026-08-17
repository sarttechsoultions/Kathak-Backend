import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

type CompetitionTrackItem = {
  id: string;
  title: string;
  description: string;
  timeLabel: string | null;
  isPersonal: boolean;
};

const indiaDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});

const indiaTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const indiaDueDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

// ==========================================================
// Get Competition Track Timeline (personalized + generic items)
// ==========================================================
// NOTE: `studentId` yahan Event/EventRegistration ki tarah User.id hai (Student model
// alag se exist nahi karta — tumhare schema mein User hi student role rakhta hai).
export const getCompetitionTrack = async (req: Request, res: Response): Promise<void> => {
  try {
    const studentId = req.user?.id;

    if (!studentId) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    // Student jis active competition mein participant hai wo dhundo
    const participant = await prisma.competitionParticipant.findFirst({
      where: {
        studentId,
        competition: { status: "ACTIVE" },
      },
      orderBy: [{ performanceSlot: "asc" }, { createdAt: "asc" }],
      include: {
        competition: {
          include: {
            updates: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
          },
        },
      },
    });

    if (!participant) {
      // Student kisi active competition mein registered nahi hai
      res.status(200).json({ success: true, data: { competitionId: null, title: null, items: [] } });
      return;
    }

    const items: CompetitionTrackItem[] = [];

    // 1. Personalized item — performance slot (agar assign hua hai)
    if (participant.performanceSlot) {
      const timeStr = indiaTimeFormatter.format(participant.performanceSlot);
      const dateStr = indiaDateFormatter.format(participant.performanceSlot);

      items.push({
        id: `slot-${participant.id}`,
        title: "Semi-finals Schedule",
        description: `Your performance slot is at ${timeStr} on ${dateStr}.${
          participant.stageLocation ? ` ${participant.stageLocation}` : ""
        }`,
        timeLabel: null,
        isPersonal: true,
      });
    }

    // 2. Generic updates visible to everyone in the competition
    for (const update of participant.competition.updates) {
      let timeLabel = update.timeLabel;
      if (!timeLabel && update.dueDate) {
        timeLabel = `Due: ${indiaDueDateFormatter.format(update.dueDate)}`;
      }

      items.push({
        id: update.id,
        title: update.title,
        description: update.description,
        timeLabel,
        isPersonal: false,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        competitionId: participant.competition.id,
        title: participant.competition.title,
        items,
      },
    });
  } catch (error) {
    console.error("Get Competition Track Error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch competition track." });
  }
};
