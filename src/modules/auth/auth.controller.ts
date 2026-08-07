import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { revokeToken } from "../../lib/tokenBlocklist";
import {
  setPortalAuthCookie,
  clearPortalAuthCookies,
  validatePortalAccess,
  signUserToken,
  roleDisplayName,
  getTokenFromCookies,
} from "../../lib/authHelpers";

const normalizePhone = (value: string) => String(value || "").replace(/\D/g, "");

export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ status: "error", message: "Email/Phone and password are required." });
      return;
    }

    if (password.length > 128) {
      res.status(400).json({ status: "error", message: "Invalid credentials." });
      return;
    }

    const input = email.trim();
    const normalizedLoginPhone = normalizePhone(input);

    const loginConditions: Array<Record<string, unknown>> = [
      { email: input.toLowerCase() },
      { id: input }
    ];
    if (input) {
      loginConditions.push({ phone: input });
    }
    if (normalizedLoginPhone) {
      loginConditions.push({ phone: normalizedLoginPhone });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: loginConditions,
      },
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

    const portalError = validatePortalAccess(user.role, "admin");
    if (portalError) {
      res.status(403).json({ status: "error", message: portalError });
      return;
    }

    const permissionList = user.permissions.map((p) => p.permission);

    const { token, expiresInMs } = signUserToken({
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: permissionList,
      rememberMe: Boolean(rememberMe),
    });

    // HttpOnly cookie set
    setPortalAuthCookie(res, "admin", token, expiresInMs);

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
          displayRole: roleDisplayName(user.role),
        },
        // ⚠️ SECURITY NOTE: token is duplicated here for Bearer-header auth.
        // If your frontend now relies only on the HttpOnly cookie, remove this
        // and drop Bearer-header support in auth.middleware.ts — returning the
        // token in JSON lets any XSS on the frontend steal it, defeating HttpOnly.
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
    // Token nikaalo – Bearer header ya cookie se
    let token: string | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }

    if (!token) {
      token = getTokenFromCookies(req.headers.cookie);
    }

    if (token) {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      const expiresAtMs = decoded?.exp
        ? decoded.exp * 1000
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      await revokeToken(token, expiresAtMs);
    }

    // Dono portal cookies clear karo
    clearPortalAuthCookies(res);

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
    const { currentPassword, newPassword } = req.body;

    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized." });
      return;
    }

    if (!currentPassword || !newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({
        status: "error",
        message: "Current password and a new password (min 6 characters) are required.",
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ status: "error", message: "User not found." });
      return;
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      res.status(400).json({ status: "error", message: "Current password is incorrect." });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    res.status(200).json({
      status: "success",
      message: "Password updated successfully.",
    });
  } catch (error: any) {
    console.error("Change Password Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update password." });
  }
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const { fullName, phone, avatarUrl } = req.body;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName ? { fullName: String(fullName).trim() } : {}),
        ...(phone ? { phone: String(phone).trim() } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl: String(avatarUrl) } : {})
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        createdAt: true
      }
    });

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully.",
      data: { user: updated }
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ status: "error", message: "Failed to update profile." });
  }
};