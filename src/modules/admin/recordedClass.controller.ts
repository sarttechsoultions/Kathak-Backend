import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { BUNNY_CONFIG } from "../../config/bunny.config";
import * as UAParser from "ua-parser-js";
import geoip from "geoip-lite";


// 1. Admin: Get all recorded classes
// 1. Admin: Get all recorded classes
export const getAdminRecordedClasses = async (req: Request, res: Response): Promise<void> => {
  try {
    const classes = await prisma.recordedClass.findMany({
      include: { 
        course: true, 
        batch: true,
        viewHistory: {                    
          include: { user: true },
          orderBy: { viewedAt: 'desc' }
        }
      },
      orderBy: { createdAt: "desc" }

    });
        const totalPlatformViews = classes.reduce((sum, c) => sum + (c.viewsCount || 0), 0);

    res.json({ status: "success", data: { classes, totalPlatformViews    } });
  } catch (error) {
    console.error("Get Recorded Classes Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch recorded classes." });
  }
};

// 2. Admin: Upload / Create a recorded class
export const createRecordedClass = async (req: Request, res: Response): Promise<void> => {
  try {
   const { 
  title, 
  description, 
  videoUrl, 
  thumbnail, 
  courseId, 
  batchId, 
  duration,
  videoId,
  resources = [],
  tags = [],
  isPublic = true,
  isDownloadable = true,
} = req.body;

    if (!title || !videoUrl) {
      res.status(400).json({ status: "error", message: "Title and Video URL are required." });
      return;
    }

    // Bunny thumbnail auto generate (agar videoId mila)
    let finalThumbnail = thumbnail?.trim() || null;
    if (!finalThumbnail && videoId && BUNNY_CONFIG.libraryId) {
      // Bunny default thumbnail pattern
      finalThumbnail = `https://vz-${BUNNY_CONFIG.libraryId}.b-cdn.net/${videoId}/thumbnail.jpg`;
    }
const newClass = await prisma.recordedClass.create({
  data: {
    title,
    description: description || null,
    videoUrl,
    thumbnail: finalThumbnail,
    duration: duration || null,
    videoId: videoId || null,
    resources,
    tags,
    isPublic,
    isDownloadable,
    ...(courseId && {
      course: { connect: { id: courseId } },
    }),
    ...(batchId && {
      batch: { connect: { id: batchId } },
    }),
  },
  include: {
    course: true,
    batch: true,
  },
});

    res.status(201).json({ 
      status: "success", 
      message: "Recorded class uploaded successfully.", 
      data: newClass 
    });
  } catch (error) {
    console.error("Create Recorded Class Error:", error);
    res.status(500).json({ status: "error", message: "Failed to upload recorded class." });
  }
};

// 3. Admin: Delete recorded class
export const deleteRecordedClass = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.recordedClass.delete({ where: { id } });
    res.json({ status: "success", message: "Recorded class deleted successfully." });
  } catch (error) {
    console.error("Delete Recorded Class Error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete recorded class." });
  }
};

// 4. Student: Get recorded classes for enrolled course/batch
export const getStudentRecordedClasses = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Student ke enrollments aur batches nikalenge
    const studentEnrollments = await prisma.enrollment.findMany({
      where: { userId, active: true },
      select: { courseId: true }
    });
    const courseIds = studentEnrollments.map((e) => e.courseId);

    const studentBatches = await prisma.batchStudent.findMany({
      where: { studentId: userId },
      select: { batchId: true }
    });
    const batchIds = studentBatches.map((b) => b.batchId);

    // Sirf unhi classes ko fetch karenge jo student ke course ya batch se match karti hain
    const classes = await prisma.recordedClass.findMany({
      where: {
        OR: [
          { courseId: { in: courseIds } },
          { batchId: { in: batchIds } },
          { courseId: null, batchId: null } // General classes
        ]
      },
      include: { course: true, batch: true },
      orderBy: { createdAt: "desc" }
    });

    res.json({ status: "success", data: { classes } });
  } catch (error) {
    console.error("Get Student Recorded Classes Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch recorded classes." });
  }
};

// Student: Get single recorded class by ID
export const getStudentSingleRecordedClass = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const recordedClass = await prisma.recordedClass.findUnique({
      where: { id },
      include: { 
        course: true, 
        batch: true,
        viewHistory: {          
        include: { user: true },
        orderBy: { viewedAt: 'desc' }
    }
       }
    });

    if (!recordedClass) {
      res.status(404).json({ status: "error", message: "Recorded class not found." });
      return;
    }

    res.json({ status: "success", data: { recordedClass } });
  } catch (error) {
    console.error("Get Student Single Recorded Class Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch recorded class." });
  }
};

export const recordClassView = async (req: Request, res: Response): Promise<void> => {
  try {
    const recordedClassId = req.params.id as string;
    const userId = req.user!.id as string;
     console.log("RAW USER AGENT:", req.headers["user-agent"]);
    // 1. Get Device & Browser
    const parser = new UAParser.UAParser(req.headers["user-agent"] as string);
    const deviceType = (parser.getDevice().type || "Desktop") as string;

    console.log("PARSED DEVICE TYPE:", deviceType);
    const browser = (parser.getBrowser().name || "Unknown") as string;

    // 2. Get IP Address
    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) || req.socket.remoteAddress || "";
    
    // 3. Get Location
  let location = "Unknown";
if (ipAddress) {
  // Local/private IP check
  const isLocal = 
    ipAddress === "::1" || 
    ipAddress === "127.0.0.1" || 
    ipAddress.startsWith("192.168.") || 
    ipAddress.startsWith("10.") ||
    ipAddress.startsWith("::ffff:127.");

  if (isLocal) {
    location = "Local Network";
  } else {
    const geo = geoip.lookup(ipAddress as string);
    if (geo) {
      location = `${geo.city}, ${geo.region}, ${geo.country}`;
    }
  }
}

    const existingView = await prisma.recordedClassView.findUnique({
      where: { recordedClassId_userId: { recordedClassId, userId } }
    });

    if (!existingView) {
      try {
        // Try to create the new view and increment total views
        await prisma.$transaction([
          prisma.recordedClassView.create({
            data: { 
              recordedClassId, 
              userId,
              deviceType,
              browser,
              ipAddress: ipAddress as string,
              location
            }
          }),
          prisma.recordedClass.update({
            where: { id: recordedClassId },
            data: { viewsCount: { increment: 1 } }
          })
        ]);
      } catch (createError: any) {
        // RACE CONDITION FIX: 
        // Agar React ne do baar API call ki aur 'Unique Constraint (P2002)' error aaya,
        // Toh crash hone ki jagah bas use update kar do.
        if (createError.code === 'P2002') {
          await prisma.recordedClassView.update({
            where: { recordedClassId_userId: { recordedClassId, userId } },
            data: { 
              viewedAt: new Date(), 
              deviceType, 
              ipAddress: ipAddress as string, 
              location 
            }
          });
        } else {
          throw createError; // Agar koi aur error hai toh error throw karo
        }
      }
    } else {
      // Pehle se record hai, toh sirf update kardo
      await prisma.recordedClassView.update({
        where: { id: existingView.id },
        data: { 
          viewedAt: new Date(), 
          deviceType, 
          ipAddress: ipAddress as string, 
          location 
        }
      });
    }

    res.json({ status: "success", message: "Analytics recorded safely" });
  } catch (error) {
    console.error("Record View Error:", error);
    res.status(500).json({ status: "error", message: "Failed to record view." });
  }
};