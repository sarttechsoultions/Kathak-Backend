import { Router } from "express";
import { createOrder, getPaymentPlan, handleRazorpayWebhook } from "./payment.controller";

const router = Router();

// Get pricing plan info for a course (before enrollment)
router.get("/plan", getPaymentPlan);

// Create Razorpay order for enrollment
router.post("/create-order", createOrder);

// Razorpay webhook (payment captured / failed)
router.post("/webhook", handleRazorpayWebhook);

export default router;
