import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

export const getCourseForEnrollmentBySlug = async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) {
      return res.status(400).json({ status: "error", message: "Course slug is required." });
    }

    // Fetch all published courses with their active batches (RAW data)
    const courses = await prisma.course.findMany({
      where: { published: true },
      include: {
        batches: {
          where: { status: "Active" },
          orderBy: { createdAt: "asc" },
        },
      }
    });

    // Find by slug
    const matched = courses.find(
      (course: any) =>
        course.slug.toLowerCase() === slug ||
        (course.aliases || []).some((alias: string) => alias.toLowerCase() === slug)
    );

    if (!matched) {
      return res.status(404).json({ status: "error", message: "Course not found." });
    }

    // Return a clean, mobile-specific response exposing only the fields
    // required for the mobile enrollment UI.
    const cleanCourse = {
      id: matched.id,
      slug: matched.slug,
      title: matched.title,
      thumbnail: matched.thumbnail || "/courses-page/hero-layer.png",
      groupFeeINR: matched.groupFeeINR,
      groupFeeUSD: matched.groupFeeUSD,
      oneToOneFeeINR: matched.oneToOneFeeINR,
      oneToOneFeeUSD: matched.oneToOneFeeUSD,
      joiningFeeINR: matched.joiningFeeINR,
      batches: matched.batches.map((batch: any) => ({
        id: batch.id,
        name: batch.name,
        schedule: batch.schedule,
        status: batch.status
      }))
    };

    res.json({
      status: "success",
      data: cleanCourse,
    });
  } catch (error) {
    console.error("Mobile enroll course error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch course details for enrollment" });
  }
};
