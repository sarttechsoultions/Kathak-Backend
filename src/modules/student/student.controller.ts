import { Request, Response } from "express";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

export const enrollStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      fullName,
      email,
      phone,
      password,
      courseTitle,
      courseId,
      skillLevel,
      batch,
      joiningDate,
      paymentMethod,
      groupFeeINR,
      groupFeeUSD
    } = req.body;

    if (!fullName || !email || !phone || !password) {
      res.status(400).json({
        status: "error",
        message: "Full Name, Email, Phone Number, and Password are required."
      });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = String(phone).trim();

    // Check if student user already exists in PostgreSQL
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { phone: normalizedPhone }]
      }
    });

    if (user) {
      // If user exists, update password if provided and activate account
      const passwordHash = await bcrypt.hash(password, 10);
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          fullName: String(fullName).trim(),
          phone: normalizedPhone,
          passwordHash,
          isActive: true
        }
      });
    } else {
      // Create new Student account in database
      const passwordHash = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: {
          fullName: String(fullName).trim(),
          email: normalizedEmail,
          phone: normalizedPhone,
          passwordHash,
          role: Role.STUDENT,
          avatarUrl: "/Ananya.png",
          isActive: true
        }
      });
    }

    // Automatically increment totalStudents count on matching Batch in Database
    if (batch) {
      const targetBatch = await prisma.batch.findFirst({
        where: {
          OR: [
            { name: { contains: String(batch).substring(0, 8), mode: "insensitive" } },
            { code: String(batch) }
          ]
        }
      });
      if (targetBatch) {
        await prisma.batch.update({
          where: { id: targetBatch.id },
          data: { totalStudents: { increment: 1 } }
        });
      }
    }

    // Generate JWT token for instant portal login
    const signOptions: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] };
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        permissions: []
      },
      env.jwtSecret,
      signOptions
    );

    res.status(201).json({
      status: "success",
      message: `Enrollment & course purchase completed successfully for ${user.fullName}!`,
      data: {
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatarUrl: user.avatarUrl
        },
        token,
        courseEnrollment: {
          courseTitle: courseTitle || "Kathak Beginners Course",
          batch: batch || "Morning Zen (7:00 AM)",
          skillLevel: skillLevel || "Beginner (Prathama)",
          joiningDate: joiningDate || new Date().toISOString().split("T")[0],
          paymentStatus: "PAID",
          amountPaid: groupFeeINR ? `₹${groupFeeINR}` : "₹2,200"
        }
      }
    });
  } catch (error: any) {
    console.error("Student Enrollment Error:", error);
    res.status(500).json({ status: "error", message: "Failed to process enrollment and course purchase." });
  }
};
