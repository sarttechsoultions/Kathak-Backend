import { Router } from "express";
import { createOrder, handleRazorpayWebhook } from "./payment.controller";

const router = Router();

router.post("/create-order", createOrder);
router.post("/webhook", handleRazorpayWebhook);

export default router;
