import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Permission, Role } from "@prisma/client";
import { env } from "../config/env";
import { isTokenRevoked } from "../lib/tokenBlocklist";
import { AuthUser } from "../types/auth";
import { getTokenFromCookies } from "../lib/authHelpers";

interface JwtPayload {
  id: string;
  email: string;
  role: Role;
  permissions: Permission[];
  iat?: number;
  exp?: number;
}

function extractToken(req: Request): string | null {
  // 1. Authorization: Bearer <token>
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.length > 0) return token;
  }

  // 2. HttpOnly portal cookies
  return getTokenFromCookies(req.headers.cookie);
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ status: "error", message: "Authentication required. Please log in." });
    return;
  }

  let revoked: boolean;
  try {
    revoked = await isTokenRevoked(token);
  } catch (err) {

    next(err);
    return;
  }

  if (revoked) {
    res.status(401).json({ status: "error", message: "Session expired. Please log in again." });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions ?? [],
    } satisfies AuthUser;

    next();
  } catch {
    res.status(401).json({ status: "error", message: "Invalid or expired authorization token." });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Authentication required." });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ status: "error", message: "Access denied. Insufficient role permissions." });
      return;
    }

    next();
  };
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Authentication required." });
      return;
    }

    if (req.user.role === Role.ADMIN) {
      next();
      return;
    }

    const hasPermission = permissions.every((p) => req.user?.permissions.includes(p));
    if (!hasPermission) {
      res.status(403).json({ status: "error", message: "Access denied. Required permission missing." });
      return;
    }

    next();
  };
}

export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Authentication required." });
      return;
    }

    if (req.user.role === Role.ADMIN) {
      next();
      return;
    }

    const hasPermission = permissions.some((p) => req.user?.permissions.includes(p));
    if (!hasPermission) {
      res.status(403).json({ status: "error", message: "Access denied. Required permission missing." });
      return;
    }

    next();
  };
}