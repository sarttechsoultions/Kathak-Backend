import { Request } from "express";

export type DisplayCurrency = "INR" | "USD";

export const getVisitorCountry = (req: Request): string => {
  const cfCountry = req.headers["cf-ipcountry"];

  if (typeof cfCountry === "string" && cfCountry.trim()) {
    return cfCountry.toUpperCase();
  }

  return "UNKNOWN";
};

export const getDisplayCurrency = (
  req: Request
): DisplayCurrency => {
  const country = getVisitorCountry(req);

  return country === "IN" ? "INR" : "USD";
};