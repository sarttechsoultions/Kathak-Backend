import { prisma } from "./prisma";

const DEFAULT_TEMPLATE_IMAGE = "/letterhead/official-letterhead.png";

const DEFAULT_LETTER_HTML = `Date: ${new Date().toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
})}<br><br>To,<br>The Principal<br>XYZ School<br>City, State – PIN Code<br><br>Subject: Invitation for Kathak Dance Workshop<br><br>Respected Sir/Madam,<br><br>We are pleased to invite your esteemed institution to participate in our upcoming Kathak Dance Workshop organized by Kathak by Harshita Academy. The workshop aims to promote Indian classical dance among students and provide them with an opportunity to learn from experienced artists.<br><br>We look forward to your positive response and the opportunity to collaborate.<br><br>Warm regards,<br><br>Harshita Sharma<br>(Kathak Dance Artist & Founder)<br>Kathak by Harshita Academy`;

export async function ensureLetterheadDefaults(): Promise<void> {
  const templateCount = await prisma.letterheadTemplate.count();
  if (templateCount > 0) return;

  const official = await prisma.letterheadTemplate.create({
    data: {
      name: "Official Letterhead",
      imageUrl: DEFAULT_TEMPLATE_IMAGE,
      isActive: true,
    },
  });

  const now = new Date();
  const samples = [
    { title: "Official Letterhead 2025", isDefault: true, usageCount: 0 },
    { title: "Workshop Letterhead", isDefault: false, usageCount: 0 },
    { title: "Event Letterhead", isDefault: false, usageCount: 0 },
    { title: "Performance Letterhead", isDefault: false, usageCount: 0 },
  ];

  for (const sample of samples) {
    await prisma.letterhead.create({
      data: {
        title: sample.title,
        contentHtml: DEFAULT_LETTER_HTML,
        pagesJson: [{ contentHtml: DEFAULT_LETTER_HTML }],
        fontFamily: "Georgia, serif",
        isDefault: sample.isDefault,
        usageCount: sample.usageCount,
        templateId: official.id,
      },
    });
  }
}
