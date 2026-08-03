import { Request, Response } from "express";
import { Role, ClassMode } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

export const enrollStudent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      fullName,
      email,
      phone,
      password,
      courseId,
      courseTitle,
      skillLevel,
      batch,
      joiningDate,
      paymentMethod,
      groupFeeINR,
      groupFeeUSD
    } = req.body;

    // Validation
    if (!fullName?.trim()) {
      res.status(400).json({
        status: "error",
        message: "Full Name is required."
      });
      return;
    }

    if (!email?.trim()) {
      res.status(400).json({
        status: "error",
        message: "Email is required."
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      res.status(400).json({
        status: "error",
        message: "Invalid email address."
      });
      return;
    }

    if (!phone?.trim()) {
      res.status(400).json({
        status: "error",
        message: "Phone number is required."
      });
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      res.status(400).json({
        status: "error",
        message: "Phone number must be exactly 10 digits."
      });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({
        status: "error",
        message: "Password must be at least 6 characters."
      });
      return;
    }

    if (!courseId) {  
      res.status(400).json({
        status: "error",
        message: "Course is required."
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();

    // Duplicate Check
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          {
            email: normalizedEmail
          },
          {
            phone: normalizedPhone
          }
        ]
      }
    });

    if (existingUser) {
      res.status(409).json({
        status: "error",
        message: "An account with this email or phone already exists. Please login."
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await tx.user.create({
        data: {
          fullName: fullName.trim(),
          email: normalizedEmail,
          phone: normalizedPhone,
          passwordHash,
          role: Role.STUDENT,
          avatarUrl: "/Ananya.png",
          isActive: true
        }
      });

      console.log("Received courseId:", courseId);

const course = await tx.course.findUnique({
  where: {
    id: courseId
  }
});

console.log("Course Found:", course);
            // Create Enrollment
      const enrollment = await tx.enrollment.create({
        data: {
          userId: user.id,
          courseId,
          mode: ClassMode.ONLINE,
          type: "GROUP",
          active: true
        }
      });

      // Assign Student to Batch
      if (batch) {

        const targetBatch = await tx.batch.findFirst({
          where: {
            OR: [
              {
                name: {
                  contains: String(batch).substring(0, 8),
                  mode: "insensitive"
                }
              },
              {
                code: String(batch)
              }
            ]
          }
        });

        if (!targetBatch) {
          throw new Error("Selected batch not found.");
        }

        await tx.batchStudent.create({
          data: {
            batchId: targetBatch.id,
            studentId: user.id
          }
        });

        await tx.batch.update({
          where: {
            id: targetBatch.id
          },
          data: {
            totalStudents: {
              increment: 1
            }
          }
        });
      }

      return {
        user,
        enrollment
      };

    });
        const signOptions: SignOptions = {
      expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"]
    };

    const token = jwt.sign(
      {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        permissions: []
      },
      env.jwtSecret,
      signOptions
    );

    res.status(201).json({
      status: "success",
      message: `Enrollment & course purchase completed successfully for ${result.user.fullName}!`,
      data: {
        user: {
          id: result.user.id,
          fullName: result.user.fullName,
          email: result.user.email,
          phone: result.user.phone,
          role: result.user.role,
          avatarUrl: result.user.avatarUrl
        },
        token,
        courseEnrollment: {
          id: result.enrollment.id,
          courseId,
          courseTitle: courseTitle || "",
          batch: batch || "",
          skillLevel: skillLevel || "Beginner",
          joiningDate:
            joiningDate || new Date().toISOString().split("T")[0],
          paymentMethod: paymentMethod || "",
          paymentStatus: "PENDING",
          amountPaid: groupFeeINR
            ? `₹${groupFeeINR}`
            : groupFeeUSD
            ? `$${groupFeeUSD}`
            : "-"
        }
      }
    });

  } catch (error: any) {
    console.error("Student Enrollment Error:", error);

    res.status(500).json({
      status: "error",
      message: error.message || "Failed to process enrollment."
    });
  }
};

export const getStudentProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const student = await prisma.user.findUnique({
      where: {
        id: req.user!.id
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        avatarUrl: true,
        country: true,
        isActive: true,
        createdAt: true
      }
    });

    if (!student) {
      res.status(404).json({
        status: "error",
        message: "Student not found."
      });
      return;
    }

    res.json({
      status: "success",
      data: student
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Failed to fetch profile."
    });
  }
};

export const updateStudentProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fullName, phone, country, avatarUrl } = req.body;

    const student = await prisma.user.findUnique({
      where: {
        id: req.user!.id
      }
    });

    if (!student) {
      res.status(404).json({
        status: "error",
        message: "Student not found."
      });
      return;
    }

    // Check duplicate phone number
    if (phone && phone !== student.phone) {
      const existingPhone = await prisma.user.findFirst({
        where: {
          phone,
          NOT: {
            id: student.id
          }
        }
      });

      if (existingPhone) {
        res.status(409).json({
          status: "error",
          message: "Phone number already exists."
        });
        return;
      }
    }

    const updatedStudent = await prisma.user.update({
      where: {
        id: student.id
      },
      data: {
        fullName: fullName ?? student.fullName,
        phone: phone ?? student.phone,
        country: country ?? student.country,
        avatarUrl: avatarUrl ?? student.avatarUrl
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        country: true,
        avatarUrl: true,
        role: true,
        isActive: true
      }
    });

    res.json({
      status: "success",
      message: "Profile updated successfully.",
      data: updatedStudent
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Failed to update profile."
    });
  }
};

export const changeStudentPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        status: "error",
        message: "Current password and new password are required."
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        status: "error",
        message: "New password must be at least 6 characters."
      });
      return;
    }

    const student = await prisma.user.findUnique({
      where: {
        id: req.user!.id
      }
    });

    if (!student) {
      res.status(404).json({
        status: "error",
        message: "Student not found."
      });
      return;
    }

    const isPasswordCorrect = await bcrypt.compare(
      currentPassword,
      student.passwordHash
    );

    if (!isPasswordCorrect) {
      res.status(400).json({
        status: "error",
        message: "Current password is incorrect."
      });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: {
        id: student.id
      },
      data: {
        passwordHash
      }
    });

    res.json({
      status: "success",
      message: "Password changed successfully."
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Failed to change password."
    });
  }
};

export const studentLogin = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password) {
      res.status(400).json({
        status: "error",
        message: "Email/Phone and Password are required."
      });
      return;
    }

    const loginValue = String(emailOrPhone).trim();

    const user = await prisma.user.findFirst({
      where: {
        role: Role.STUDENT,
        OR: [
          {
            email: loginValue.toLowerCase()
          },
          {
            phone: loginValue
          }
        ]
      }
    });

    if (!user) {
      res.status(404).json({
        status: "error",
        message: "Student account not found."
      });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({
        status: "error",
        message: "Your account is inactive."
      });
      return;
    }

    const passwordMatched = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatched) {
      res.status(401).json({
        status: "error",
        message: "Invalid credentials."
      });
      return;
    }

    const signOptions: SignOptions = {
      expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"]
    };

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

    res.json({
      status: "success",
      message: "Login successful.",
      data: {
        token,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatarUrl: user.avatarUrl,
          country: user.country
        }
      }
    });

  } catch (error) {
    console.error("Student Login Error:", error);

    res.status(500).json({
      status: "error",
      message: "Login failed."
    });
  }
};