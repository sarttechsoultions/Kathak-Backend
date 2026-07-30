import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Permission, Role } from "@prisma/client";
import { env } from "../config/env";
import { isTokenRevoked } from "../lib/tokenBlocklist";
import { AuthUser } from "../types/auth";

interface JwtPayload {
  id: string;
  email: string;
  role: Role;
  permissions: Permission[];
  iat?: number;
  exp?: number;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);

  if (!token) {
    // In development mode, provide fallback Admin session
    if (env.nodeEnv === "development") {
      req.user = {
        id: "admin-dev-01",
        email: "admin@kathakbyharshita.com",
        role: Role.ADMIN,
        permissions: Object.values(Permission)
      } satisfies AuthUser;
      return next();
    }

    res.status(401).json({ status: "error", message: "Authentication required." });
    return;
  }

  if (isTokenRevoked(token)) {
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
    // Development Mode Fallback: Allow dev token / admin session to succeed smoothly
    if (env.nodeEnv === "development") {
      req.user = {
        id: "admin-dev-01",
        email: "admin@kathakbyharshita.com",
        role: Role.ADMIN,
        permissions: Object.values(Permission)
      } satisfies AuthUser;
      return next();
    }

    res.status(401).json({ status: "error", message: "Invalid or expired token." });
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
