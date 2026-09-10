export function resolveCurrency(countryCode: string | null | undefined): "INR" | "USD" {
  // If no country code, default to INR for safety
  if (!countryCode) {
    return "INR";
  }

  const normalized = countryCode.trim().toUpperCase();
  
  // List of country codes that should use INR (e.g. India)
  if (normalized === "IN" || normalized === "INDIA" || normalized === "+91") {
    return "INR";
  }

  // All other countries use USD according to the current business rules
  return "USD";
}
