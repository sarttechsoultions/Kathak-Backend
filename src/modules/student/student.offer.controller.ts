import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

// ==========================================================
// Get Active Promotional Offer (Masterclass Pass banner)
// ==========================================================
export const getActiveOffer = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const prismaClient = prisma as any;

    const offer = await prismaClient.offer.findFirst({
      where: {
        isActive: true,
        OR: [{ startDate: null }, { startDate: { lte: now } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: now } }] }],
      },
      orderBy: { createdAt: "desc" },
    });

    // Koi active offer nahi hai to data: null bhejo, frontend banner hide kar dega
    return res.status(200).json({ success: true, data: offer || null });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};