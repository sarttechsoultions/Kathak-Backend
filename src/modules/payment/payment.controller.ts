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
import { confirmEventTicketByOrder, failEventTicketByOrder } from "../events/ticket.service";
import { confirmDemoBookingByOrder, failDemoBookingByOrder } from "../demo/demo.controller";
import { assertContactVerified, OtpError } from "../../lib/otp";
import {
  enrollmentAmountINR,
  bulkPaymentAmountINR,
  BulkDiscountTier,
  PaymentMode,
  nextMonthDueDate,
  generateDueMonths,
  monthlyRenewalAmountINR,
} from "../../lib/fees";

const getRawBody = (req: Request): Buffer | null => {
  const withRaw = req as Request & { rawBody?: Buffer };
  if (Buffer.isBuffer(withRaw.rawBody)) return withRaw.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  return null;
};

// ─── Parse BulkDiscountTiers from JSON ──────────────────────────────────────
const parseTiers = (raw: unknown): BulkDiscountTier[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => typeof t === "object" && t !== null && "months" in t && "discountPercent" in t)
    .map((t: { months: unknown; discountPercent: unknown }) => ({
      months: Number(t.months) || 0,
      discountPercent: Number(t.discountPercent) || 0,
    }))
    .filter((t) => t.months > 0 && t.discountPercent >= 0);
};

// ─── Create Razorpay instance ─────────────────────────────────────────────────
export  const getRazorpay = () => {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) return null;
  return new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
};

// ─── Create MonthlyDue records for a full-course enrollment ──────────────────
export const createMonthlyDues = async (params: {
  enrollmentId: string;
  userId: string;
  courseId: string;
  monthlyFeeINR: number;
  monthsPaid: number; // months already covered by this payment
}) => {
  const { enrollmentId, userId, courseId, monthlyFeeINR, monthsPaid } = params;
  const now = new Date();
  const months = generateDueMonths(now, monthsPaid);

  // Upsert MonthlyDue records for each covered month (status = SUCCESS since paid)
  for (const dueMonth of months) {
    const [yyyy, mm] = dueMonth.split("-").map(Number);
    const dueDate = new Date(yyyy, mm - 1, 1);
    await prisma.monthlyDue.upsert({
      where: { enrollmentId_dueMonth: { enrollmentId, dueMonth } },
      update: { status: "SUCCESS", paidAt: now },
      create: {
        enrollmentId,
        userId,
        courseId,
        dueMonth,
        dueDate,
        amount: monthlyFeeINR,
        currency: "INR",
        status: "SUCCESS",
        paidAt: now,
      },
    });
  }

  // Create the NEXT due (the first unpaid month after bulk)
  const nextMonths = generateDueMonths(now, monthsPaid + 1);
  const nextDueMonth = nextMonths[nextMonths.length - 1];
  const [ny, nm] = nextDueMonth.split("-").map(Number);
  const nextDueDate = new Date(ny, nm - 1, 1);

  await prisma.monthlyDue.upsert({
    where: { enrollmentId_dueMonth: { enrollmentId, dueMonth: nextDueMonth } },
    update: {},
    create: {
      enrollmentId,
      userId,
      courseId,
      dueMonth: nextDueMonth,
      dueDate: nextDueDate,
      amount: monthlyFeeINR,
      currency: "INR",
      status: "PENDING",
    },
  });

  return nextDueDate;
};

// ─── Record a single monthly due ──────────────────────────────────────────────
export const createNextMonthlyDue = async (params: {
  enrollmentId: string;
  userId: string;
  courseId: string;
  monthlyFeeINR: number;
}) => {
  const { enrollmentId, userId, courseId, monthlyFeeINR } = params;
  const now = new Date();
  // Current month is paid
  const [currentMonth] = generateDueMonths(new Date(now.getFullYear(), now.getMonth() - 1, 1), 1);
  await prisma.monthlyDue.upsert({
    where: { enrollmentId_dueMonth: { enrollmentId, dueMonth: currentMonth } },
    update: { status: "SUCCESS", paidAt: now },
    create: {
      enrollmentId,
      userId,
      courseId,
      dueMonth: currentMonth,
      dueDate: new Date(now.getFullYear(), now.getMonth(), 1),
      amount: monthlyFeeINR,
      currency: "INR",
      status: "SUCCESS",
      paidAt: now,
    },
  });

  // Create next month's pending due
  const nextDue = nextMonthDueDate(now);
  const mm = String(nextDue.getMonth() + 1).padStart(2, "0");
  const nextDueMonth = `${nextDue.getFullYear()}-${mm}`;

  await prisma.monthlyDue.upsert({
    where: { enrollmentId_dueMonth: { enrollmentId, dueMonth: nextDueMonth } },
    update: {},
    create: {
      enrollmentId,
      userId,
      courseId,
      dueMonth: nextDueMonth,
      dueDate: nextDue,
      amount: monthlyFeeINR,
      currency: "INR",
      status: "PENDING",
    },
  });

  return nextDue;
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE ORDER  (used during enrollment)
// Body additions:
//   paymentMode: "MONTHLY" | "FULL_COURSE"   (default: MONTHLY)
//   months: number                            (required for FULL_COURSE, min 2)
// ─────────────────────────────────────────────────────────────────────────────
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const validated = await validateEnrollmentInput(req.body, { requirePassword: true });
    await assertContactVerified("EMAIL", validated.normalizedEmail);
    await assertContactVerified("MOBILE", validated.e164Phone);
    const { batchId, courseId, enrollmentType } = validated.payload;

    // ── Payment mode from request ──────────────────────────────────────────
    const paymentModeRaw = String(req.body.paymentMode || "MONTHLY").toUpperCase();
    const paymentMode: PaymentMode =
      paymentModeRaw === "FULL_COURSE" ? "FULL_COURSE" : "MONTHLY";
    const requestedMonths = Math.max(1, parseInt(String(req.body.months || "1"), 10));

    let amountInINR: number;
    let discountPercent = 0;
    let discountAmount = 0;
    let originalAmount: number;
    let resolvedBatchId: string;
    let monthlyFeeINR = 0;
    let joiningFeeINR = 1100;
    let tiers: BulkDiscountTier[] = [];

    if (enrollmentType === "ONE_TO_ONE") {
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        res.status(404).json({ status: "error", message: "Course not found." });
        return;
      }
      monthlyFeeINR = course.oneToOneFeeINR || 0;
      joiningFeeINR = course.joiningFeeINR ?? 1100;
      tiers = parseTiers(course.bulkDiscountTiers);
      resolvedBatchId = "";
    } else {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { course: true },
      });

      if (!batch || !batch.course) {
        res.status(404).json({ status: "error", message: "Batch or Course not found." });
        return;
      }

      if (batch.courseId !== courseId) {
        res.status(400).json({
          status: "error",
          message: "Selected batch does not belong to the chosen course.",
        });
        return;
      }

      monthlyFeeINR = batch.course.groupFeeINR || 0;
      joiningFeeINR = batch.course.joiningFeeINR ?? 1100;
      tiers = parseTiers(batch.course.bulkDiscountTiers);
      resolvedBatchId = batchId;
    }

    if (!monthlyFeeINR || monthlyFeeINR <= 0) {
      res.status(400).json({ status: "error", message: "Invalid course fee." });
      return;
    }

    // ── Calculate amount based on payment mode ─────────────────────────────
    if (paymentMode === "FULL_COURSE") {
      const months = requestedMonths > 1 ? requestedMonths : 2;
      const calc = bulkPaymentAmountINR(monthlyFeeINR, months, tiers, joiningFeeINR);
      amountInINR = calc.total;
      originalAmount = calc.originalTotal;
      discountPercent = calc.discountPercent;
      discountAmount = calc.discountAmount;
    } else {
      // MONTHLY: first month + joining fee
      amountInINR = enrollmentAmountINR(monthlyFeeINR, joiningFeeINR);
      originalAmount = amountInINR;
    }

    if (!env.razorpayKeyId || !env.razorpayKeySecret) {
      res.status(500).json({
        status: "error",
        message: "Payment is temporarily unavailable. Please try again later.",
      });
      return;
    }

    const pending = await prisma.pendingEnrollment.create({
      data: {
        email: validated.normalizedEmail,
        phone: validated.e164Phone,
        passwordHash: validated.passwordHash,
        payload: {
          ...(validated.payload as object),
          paymentMode,
          months: paymentMode === "FULL_COURSE" ? requestedMonths : 1,
        },
        batchId: resolvedBatchId,
        courseId,
      },
    });

    const razorpay = getRazorpay()!;
    const order = await razorpay.orders.create({
      amount: Math.round(amountInINR * 100),
      currency: "INR",
      receipt: `enroll_${pending.id.replace(/-/g, "").slice(0, 20)}`,
      notes: {
        pendingEnrollmentId: pending.id,
        batchId: resolvedBatchId,
        courseId,
        enrollmentType,
        paymentMode,
        months: String(paymentMode === "FULL_COURSE" ? requestedMonths : 1),
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
        // ── Payment breakdown for the frontend ──
        paymentMode,
        months: paymentMode === "FULL_COURSE" ? requestedMonths : 1,
        monthlyFeeINR,
        joiningFeeINR,
        originalAmount,
        discountPercent,
        discountAmount,
        finalAmount: amountInINR,
        availableDiscountTiers: tiers,
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

// ─────────────────────────────────────────────────────────────────────────────
// GET PAYMENT PLAN INFO  (before enrollment – lets frontend show pricing)
// GET /payment/plan?courseId=xxx&enrollmentType=GROUP&batchId=xxx
// ─────────────────────────────────────────────────────────────────────────────
export const getPaymentPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const courseId = String(req.query.courseId || "");
    const enrollmentType = String(req.query.enrollmentType || "GROUP").toUpperCase();

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      res.status(404).json({ status: "error", message: "Course not found." });
      return;
    }

    const monthlyFeeINR =
      enrollmentType === "ONE_TO_ONE" ? course.oneToOneFeeINR : course.groupFeeINR;
    const joiningFeeINR = course.joiningFeeINR ?? 1100;
    const tiers = parseTiers(course.bulkDiscountTiers);

    // Build pricing options
    const monthlyOption = {
      mode: "MONTHLY" as PaymentMode,
      months: 1,
      monthlyFeeINR,
      joiningFeeINR,
      total: enrollmentAmountINR(monthlyFeeINR, joiningFeeINR),
      discountPercent: 0,
      discountAmount: 0,
      originalTotal: enrollmentAmountINR(monthlyFeeINR, joiningFeeINR),
    };

    const bulkOptions = tiers.map((tier) => {
      const calc = bulkPaymentAmountINR(monthlyFeeINR, tier.months, tiers, joiningFeeINR);
      return {
        mode: "FULL_COURSE" as PaymentMode,
        months: tier.months,
        monthlyFeeINR,
        joiningFeeINR,
        total: calc.total,
        discountPercent: calc.discountPercent,
        discountAmount: calc.discountAmount,
        originalTotal: calc.originalTotal,
      };
    });

    res.json({
      status: "success",
      data: {
        courseId,
        courseTitle: course.title,
        monthlyFeeINR,
        joiningFeeINR,
        autoPayEnabled: course.autoPayEnabled,
        courseDurationMonths: course.courseDurationMonths,
        pricingOptions: [monthlyOption, ...bulkOptions],
      },
    });
  } catch (error) {
    console.error("getPaymentPlan error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch payment plan." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RAZORPAY WEBHOOK
// ─────────────────────────────────────────────────────────────────────────────
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

    const expected = crypto
      .createHmac("sha256", env.razorpayWebhookSecret)
      .update(rawBody)
      .digest("hex");
    if (expected !== signature) {
      res.status(400).json({ status: "error", message: "Invalid webhook signature." });
      return;
    }

    const event =
      typeof req.body === "object" && !Buffer.isBuffer(req.body)
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
        await failEventTicketByOrder(failedOrderId);
        await failDemoBookingByOrder(failedOrderId);
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
    const pendingId = (
      paymentEntity?.notes?.pendingEnrollmentId || orderEntity?.notes?.pendingEnrollmentId
    ) as string | undefined;

    if (!razorpayPaymentId || !razorpayOrderId) {
      res.json({ status: "ignored" });
      return;
    }

    const ticketPaid = await confirmEventTicketByOrder(razorpayOrderId, razorpayPaymentId);
    if (ticketPaid) {
      res.json({ status: "ok" });
      return;
    }

    const demoPaid = await confirmDemoBookingByOrder(razorpayOrderId, razorpayPaymentId);
    if (demoPaid) {
      res.json({ status: "ok" });
      return;
    }

    const result = await completePendingEnrollment({
      pendingId,
      razorpayOrderId,
      razorpayPaymentId,
    });

    if (!result.alreadyCompleted) {
      await sendEnrollmentWelcomeEmail(result.user);

      // ── Post-enrollment: create MonthlyDue records ───────────────────────
      try {
        const enrollment = await prisma.enrollment.findFirst({
          where: { userId: result.user.id, courseId: result.enrollment.courseId },
          orderBy: { createdAt: "desc" },
          include: { course: true },
        });

        if (enrollment) {
          const paymentMode = String(enrollment.paymentMode || "MONTHLY");
          const course = enrollment.course;
          const monthlyFeeINR =
            enrollment.type === "ONE_TO_ONE"
              ? course?.oneToOneFeeINR || 0
              : course?.groupFeeINR || 0;

          if (paymentMode === "FULL_COURSE" && enrollment.monthsPaid > 1) {
            const nextDue = await createMonthlyDues({
              enrollmentId: enrollment.id,
              userId: enrollment.userId,
              courseId: enrollment.courseId,
              monthlyFeeINR,
              monthsPaid: enrollment.monthsPaid,
            });
            await prisma.enrollment.update({
              where: { id: enrollment.id },
              data: { nextDueDate: nextDue },
            });
          } else {
            const nextDue = await createNextMonthlyDue({
              enrollmentId: enrollment.id,
              userId: enrollment.userId,
              courseId: enrollment.courseId,
              monthlyFeeINR,
            });
            await prisma.enrollment.update({
              where: { id: enrollment.id },
              data: { nextDueDate: nextDue },
            });
          }
        }
      } catch (dueErr) {
        console.error("Failed to create MonthlyDue records:", dueErr);
        // Non-fatal – enrollment already succeeded
      }
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
