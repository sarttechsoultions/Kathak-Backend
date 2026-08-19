import { Response } from "express";
import jwt, { SignOptions } from "jsonwebtoken";
import { Permission, Role } from "@prisma/client";
import { env } from "../config/env";

export type AuthPortal = "admin" | "student";

const ADMIN_COOKIE = "kathak_admin_session";
const STUDENT_COOKIE = "kathak_student_session";

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map((part) => {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq === -1) return [trimmed, ""];
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, value];
      }
    })
  );
}

export function getTokenFromCookies(cookieHeader: string | undefined): string | null {
  const cookies = parseCookies(cookieHeader);
  return cookies[ADMIN_COOKIE] || cookies[STUDENT_COOKIE] || null;
}

export function setPortalAuthCookie(
  res: Response,
  portal: AuthPortal,
  token: string,
  maxAgeMs: number
): void {
  const name = portal === "admin" ? ADMIN_COOKIE : STUDENT_COOKIE;
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${Math.floor(maxAgeMs / 1000)}`
  );
}

export function clearPortalAuthCookies(res: Response): void {
  for (const name of [ADMIN_COOKIE, STUDENT_COOKIE]) {
    res.append(
      "Set-Cookie",
      `${name}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`
    );
  }
}

export function validatePortalAccess(role: Role, portal: AuthPortal): string | null {
  if (portal === "admin") {
    if (role === Role.STUDENT) {
      return "Student accounts cannot access the admin portal. Please use the student login.";
    }
    if (role !== Role.ADMIN && role !== Role.TEACHER) {
      return "Access denied for this portal.";
    }
    return null;
  }

  if (role !== Role.STUDENT) {
    return "Admin and teacher accounts must use the admin login portal.";
  }
  return null;
}

export function signUserToken(payload: {
  id: string;
  email: string;
  role: Role;
  permissions: Permission[];
  rememberMe?: boolean;
}): { token: string; expiresInMs: number } {
  const rememberMe = payload.rememberMe === true;
  const expiresIn = rememberMe ? "30d" : env.jwtExpiresIn;
  const signOptions: SignOptions = { expiresIn: expiresIn as SignOptions["expiresIn"] };

  const token = jwt.sign(
    {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      permissions: payload.permissions,
    },
    env.jwtSecret,
    signOptions
  );

  const expiresInMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return { token, expiresInMs };
}

/**
 * Strips passwordHash (and any other server-only fields) from a User record
 * before it's sent in a response. Several admin endpoints previously
 * returned the raw Prisma user object, which included the bcrypt hash.
 */
export function sanitizeUser<T extends { passwordHash?: unknown }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash, ...safe } = user;
  return safe;
}

export function roleDisplayName(role: Role): string {
  if (role === Role.ADMIN) return "Admin";
  if (role === Role.TEACHER) return "Teacher";
  return "Student";
}
