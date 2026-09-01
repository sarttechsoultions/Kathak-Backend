import jwt from "jsonwebtoken";
import { Permission, Role } from "@prisma/client";
import { env } from "../config/env";
import { isTokenRevoked } from "./tokenBlocklist";
import { AuthUser } from "../types/auth";

interface JwtPayload {
  id: string;
  email: string;
  role: Role;
  permissions: Permission[];
}

export function extractSocketToken(auth: Record<string, unknown> | undefined, authorization?: string): string | null {
  const fromAuth = auth?.token;
  if (typeof fromAuth === "string" && fromAuth.trim().length > 0) {
    return fromAuth.trim();
  }
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    if (token.length > 0) return token;
  }
  return null;
}

export async function verifySocketToken(token: string): Promise<AuthUser | null> {
  if (await isTokenRevoked(token)) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
    return {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions ?? [],
    };
  } catch {
    return null;
  }
}
