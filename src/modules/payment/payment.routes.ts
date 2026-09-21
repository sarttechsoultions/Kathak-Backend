import { Router } from "express";
import { createOrder, getPaymentPlan, handleRazorpayWebhook } from "./payment.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = Router();

// Website enrollment remains public. OTP-signup mobile users must prove the
// account being enrolled belongs to their current bearer-token session.
const authenticateMobileEnrollment = (req: Parameters<typeof authenticate>[0], res: Parameters<typeof authenticate>[1], next: Parameters<typeof authenticate>[2]) => {
  if (req.body?.isMobileApp === true) return authenticate(req, res, next);
  next();
};

// Get pricing plan info for a course (before enrollment)
router.get("/plan", getPaymentPlan);

// Create Razorpay order for enrollment
router.post("/create-order", authenticateMobileEnrollment, createOrder);

// Razorpay webhook (payment captured / failed)
router.post("/webhook", handleRazorpayWebhook);

export default router;
