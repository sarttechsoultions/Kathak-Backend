import { Request, Response } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { PendingEnrollmentStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import {
  completePendingEnrollment,
  EnrollmentError,
  sendEnrollmentWelcomeEmail,
  validateEnrollmentInput,
} from "../student/enrollment.service";
import { assertContactVerified, OtpError } from "../../lib/otp";

const getRawBody = (req: Request): Buffer | null => {
  const withRaw = req as Request & { rawBody?: Buffer };
  if (Buffer.isBuffer(withRaw.rawBody)) return withRaw.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  return null;
};

export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const validated = await validateEnrollmentInput(req.body, { requirePassword: true });
    await assertContactVerified("EMAIL", validated.normalizedEmail);
    await assertContactVerified("MOBILE", validated.e164Phone);
    const { batchId, courseId } = validated.payload;

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { course: true },
    });

    if (!batch || !batch.course) {
      res.status(404).json({ status: "error", message: "Batch or Course not found." });
      return;
    }

    const amountInINR = batch.course.groupFeeINR;

    if (!amountInINR || amountInINR <= 0) {
      res.status(400).json({ status: "error", message: "Invalid course fee." });
      return;
    }

    if (!env.razorpayKeyId || !env.razorpayKeySecret) {
      res.status(500).json({ status: "error", message: "Razorpay keys are not configured on the server." });
      return;
    }

    const pending = await prisma.pendingEnrollment.create({
      data: {
        email: validated.normalizedEmail,
        phone: validated.e164Phone,
        passwordHash: validated.passwordHash,
        payload: validated.payload,
        batchId,
        courseId,
      },
    });

    const razorpay = new Razorpay({
      key_id: env.razorpayKeyId,
      key_secret: env.razorpayKeySecret,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amountInINR * 100),
      currency: "INR",
      receipt: `enroll_${pending.id.replace(/-/g, "").slice(0, 20)}`,
      notes: {
        pendingEnrollmentId: pending.id,
        batchId,
        courseId,
      },
    });

    await prisma.pendingEnrollment.update({
      where: { id: pending.id },
      data: { razorpayOrderId: order.id },
    });

    res.status(200).json({
      status: "success",
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: env.razorpayKeyId,
        pendingEnrollmentId: pending.id,
      },
    });
  } catch (error) {
    if (error instanceof EnrollmentError || error instanceof OtpError) {
      res.status(error.statusCode).json({ status: "error", message: error.message });
      return;
    }
    console.error("Razorpay createOrder error:", error);
    res.status(500).json({ status: "error", message: "Failed to create payment order." });
  }
};

export const handleRazorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!env.razorpayWebhookSecret) {
      res.status(503).json({ status: "error", message: "Razorpay webhook secret is not configured." });
      return;
    }

    const signature = req.headers["x-razorpay-signature"];
    const rawBody = getRawBody(req);

    if (!rawBody || typeof signature !== "string") {
      res.status(400).json({ status: "error", message: "Missing webhook signature." });
      return;
    }

    const expected = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(rawBody).digest("hex");
    if (expected !== signature) {
      res.status(400).json({ status: "error", message: "Invalid webhook signature." });
      return;
    }

    const event = typeof req.body === "object" && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody.toString("utf8"));

    const eventName = event?.event as string | undefined;
    const paymentEntity = event?.payload?.payment?.entity;
    const orderEntity = event?.payload?.order?.entity;

    if (eventName === "payment.failed") {
      const failedOrderId = paymentEntity?.order_id as string | undefined;
      if (failedOrderId) {
        await prisma.pendingEnrollment.updateMany({
          where: { razorpayOrderId: failedOrderId, status: PendingEnrollmentStatus.PENDING },
          data: {
            status: PendingEnrollmentStatus.FAILED,
            errorMessage: paymentEntity?.error_description || "Payment failed",
          },
        });
      }
      res.json({ status: "ok" });
      return;
    }

    if (eventName !== "payment.captured" && eventName !== "order.paid") {
      res.json({ status: "ignored" });
      return;
    }

    const razorpayPaymentId = paymentEntity?.id as string | undefined;
    const razorpayOrderId = (paymentEntity?.order_id || orderEntity?.id) as string | undefined;
    const pendingId = (paymentEntity?.notes?.pendingEnrollmentId ||
      orderEntity?.notes?.pendingEnrollmentId) as string | undefined;

    if (!razorpayPaymentId || !razorpayOrderId) {
      res.json({ status: "ignored" });
      return;
    }

    const result = await completePendingEnrollment({
      pendingId,
      razorpayOrderId,
      razorpayPaymentId,
    });

    if (!result.alreadyCompleted) {
      await sendEnrollmentWelcomeEmail(result.user);
    }

    res.json({ status: "ok" });
  } catch (error) {
    if (error instanceof EnrollmentError && error.statusCode === 404) {
      res.json({ status: "ignored" });
      return;
    }
    console.error("Razorpay webhook error:", error);
    res.status(500).json({ status: "error", message: "Webhook processing failed." });
  }
};
