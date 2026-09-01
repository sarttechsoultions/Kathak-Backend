import { Request, Response } from "express";
import { env } from "../../config/env";
import { fetchGoogleReviews } from "./google-reviews.service";

const ERROR_MESSAGES = {
  MISSING_API_KEY: "Google Places API key is missing on the backend.",
  PLACE_NOT_FOUND: "Could not find your Google Business listing.",
  PLACE_DETAILS_FAILED: "Google Places details request failed.",
  NO_REVIEWS: "No public Google reviews were returned for this business.",
  API_PERMISSION_DENIED:
    "Google blocked this server request. Create a backend-only API key without website referrer restrictions, or allow your server IP.",
  API_NOT_ENABLED:
    "Enable Places API (Legacy) in Google Cloud Console for this API key.",
} as const;

export const getPublicGoogleReviews = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await fetchGoogleReviews();

    if (!result.data) {
      const message = result.error
        ? ERROR_MESSAGES[result.error] || "Unable to load Google reviews."
        : "Unable to load Google reviews.";

      res.status(503).json({
        status: "error",
        message,
        ...(env.nodeEnv !== "production" && result.details
          ? { details: result.details }
          : {}),
      });
      return;
    }

    res.status(200).json({
      status: "success",
      data: result.data,
    });
  } catch (error) {
    console.error("Error fetching Google reviews:", error);
    res.status(500).json({
      status: "error",
      message: "Unable to load Google reviews.",
    });
  }
};
