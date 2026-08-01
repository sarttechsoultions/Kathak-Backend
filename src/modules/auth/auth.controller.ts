import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { revokeToken } from "../../lib/tokenBlocklist";

export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ status: "error", message: "Email and password are required." });
      return;
    }

    if (password.length > 128) {
      res.status(400).json({ status: "error", message: "Invalid credentials." });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { permissions: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ status: "error", message: "Invalid credentials." });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ status: "error", message: "Invalid credentials." });
      return;
    }

    const permissionList = user.permissions.map((p) => p.permission);

    const signOptions: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] };

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        permissions: permissionList,
      },
      env.jwtSecret,
      signOptions
    );

    res.status(200).json({
      status: "success",
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatarUrl: user.avatarUrl,
          permissions: permissionList,
        },
        token,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ status: "error", message: "Internal server error during login." });
  }
};

export const logoutUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (token) {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      const expiresAtMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000;
      revokeToken(token, expiresAtMs);
    }

    res.status(200).json({
      status: "success",
      message: "Logout successful.",
    });
  } catch (error) {
    console.error("Logout Error:", error);
    res.status(500).json({ status: "error", message: "Internal server error during logout." });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { permissions: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ status: "error", message: "User not found or inactive." });
      return;
    }

    const permissionList = user.permissions.map((p) => p.permission);

    res.status(200).json({
      status: "success",
      data: {
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatarUrl: user.avatarUrl,
          permissions: permissionList,
        },
      },
    });
  } catch (error) {
    console.error("GetMe Error:", error);
    res.status(500).json({ status: "error", message: "Internal server error." });
  }
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { newPassword } = req.body;

    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({ status: "error", message: "New password must be at least 6 characters long." });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    res.status(200).json({
      status: "success",
      message: "Password updated successfully."
    });
  } catch (error: any) {
    console.error("Change Password Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update password." });
  }
};
