import { Request } from "express";

export type DisplayCurrency = "INR" | "USD";

export const getVisitorCountry = (req: Request): string => {
  // 1. Custom header from Next.js (highest priority)
  const forwarded = req.headers["x-client-country"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;

  if (typeof forwardedValue === "string" && forwardedValue.trim()) {
    return forwardedValue.trim().toUpperCase();
  }

  // 2. Fallback to Cloudflare header
  const raw = req.headers["cf-ipcountry"];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value === "string" && value.trim()) {
    return value.trim().toUpperCase();
  }

  return "UNKNOWN";
};

export const getDisplayCurrency = (req: Request): DisplayCurrency => {
  const country = getVisitorCountry(req);

  // Missing / XX / T1 → INR
  if (country === "XX" || country === "T1" || country === "UNKNOWN") {
    return "INR";
  }

  return country === "IN" ? "INR" : "USD";
};