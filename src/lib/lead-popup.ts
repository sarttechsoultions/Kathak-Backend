import { prisma } from "./prisma";

export const LEAD_POPUP_ID = "default";

export const LEAD_POPUP_DEFAULTS = {
  id: LEAD_POPUP_ID,
  isEnabled: true,
  delaySeconds: 300,
  title: "Get in Touch",
  subtitle: "Start Your Kathak Journey With Us",
  imageUrl: "/getintouch.jpeg",
  imageAlt: "Kathak dancers",
};

export async function ensureLeadPopup() {
  const existing = await prisma.leadPopup.findUnique({
    where: { id: LEAD_POPUP_ID },
  });

  if (existing) return existing;

  return prisma.leadPopup.create({
    data: LEAD_POPUP_DEFAULTS,
  });
}
