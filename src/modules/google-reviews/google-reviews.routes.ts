import { Router } from "express";
import { getPublicGoogleReviews } from "./google-reviews.controller";

export const publicGoogleReviewsRouter = Router();
publicGoogleReviewsRouter.get("/", getPublicGoogleReviews);
