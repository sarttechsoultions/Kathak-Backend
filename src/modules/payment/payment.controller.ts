import { Request, Response } from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

// We initialize Razorpay inside the function to prevent server crashes on startup if keys are missing


export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { batchId } = req.body;

    if (!batchId) {
      res.status(400).json({ status: "error", message: "Batch ID is required to calculate price." });
      return;
    }

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { course: true }
    });

    if (!batch || !batch.course) {
      res.status(404).json({ status: "error", message: "Batch or Course not found." });
      return;
    }

    // Defaulting to groupFeeINR. In a real scenario you might have logic for USD/One-to-One.
    const amountInINR = batch.course.groupFeeINR; 

    if (!amountInINR || amountInINR <= 0) {
      res.status(400).json({ status: "error", message: "Invalid course fee." });
      return;
    }

    if (!env.razorpayKeyId || !env.razorpayKeySecret) {
      res.status(500).json({ status: "error", message: "Razorpay keys are not configured on the server." });
      return;
    }

    const razorpay = new Razorpay({
      key_id: env.razorpayKeyId,
      key_secret: env.razorpayKeySecret,
    });

    const options = {
      amount: Math.round(amountInINR * 100), // Razorpay expects amount in paise
      currency: "INR",
      receipt: `receipt_${Date.now()}_${batchId.substring(0, 5)}`,
    };

    const order = await razorpay.orders.create(options);

    res.status(200).json({
      status: "success",
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: env.razorpayKeyId, // Need to send key to frontend for Checkout script
      }
    });

  } catch (error) {
    console.error("Razorpay createOrder error:", error);
    res.status(500).json({ status: "error", message: "Failed to create payment order." });
  }
};
