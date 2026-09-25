import { Request } from "express";

export type DisplayCurrency = "INR" | "USD";

/**
 * Reads Cloudflare country header safely.
 * Never throws.
 */
export const getVisitorCountry = (req: Request): string => {
  const raw = req.headers["cf-ipcountry"];

  // Express can give string | string[]
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value === "string" && value.trim()) {
    return value.trim().toUpperCase();
  }

  return "UNKNOWN";
};

/**
 * Determines display currency from visitor country.
 * - India → INR
 * - Everything else (including missing / XX / T1) → INR (safe default for INR-first product)
 *
 * Change the fallback to "USD" if you ever want the opposite behaviour.
 */
export const getDisplayCurrency = (req: Request): DisplayCurrency => {
  const country = getVisitorCountry(req);

  // Cloudflare special codes + missing header
  if (country === "XX" || country === "T1" || country === "UNKNOWN") {
    return "INR"; // prefer INR as safe default
  }

  return country === "IN" ? "INR" : "USD";
};