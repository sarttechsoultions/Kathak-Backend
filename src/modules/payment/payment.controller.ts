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

import {
  confirmEventTicketByOrder,
  failEventTicketByOrder,
} from "../events/ticket.service";

import {
  confirmDemoBookingByOrder,
  failDemoBookingByOrder,
} from "../demo/demo.controller";

import { resolveCurrency } from "../../lib/currency";

import {
  assertContactVerified,
  OtpError,
} from "../../lib/otp";

import {
  bulkPaymentAmountINR,
  BulkDiscountTier,
  PaymentMode,
  nextMonthDueDate,
  generateDueMonths,
  calculateBulkEnrollmentAmount,
  calculateMonthlyEnrollmentAmount,
  parseTiers,
} from "../../lib/fees";


// ─────────────────────────────────────────────────────────────────────────────
// RAW BODY
// Required for Razorpay webhook signature verification.
// ─────────────────────────────────────────────────────────────────────────────

const getRawBody = (req: Request): Buffer | null => {
  const withRaw = req as Request & { rawBody?: Buffer };

  if (Buffer.isBuffer(withRaw.rawBody)) {
    return withRaw.rawBody;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body);
  }

  return null;
};


// ─────────────────────────────────────────────────────────────────────────────
// RAZORPAY INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

export const getRazorpay = () => {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    return null;
  }

  return new Razorpay({
    key_id: env.razorpayKeyId,
    key_secret: env.razorpayKeySecret,
  });
};


// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY DUES
//
// NOTE:
// These helpers are kept for compatibility with existing callers.
// Final enrollment completion is handled by completePendingEnrollment().
// ─────────────────────────────────────────────────────────────────────────────

export const createMonthlyDues = async (params: {
  enrollmentId: string;
  userId: string;
  courseId: string;
  monthlyFeeINR: number;
  monthsPaid: number;
}) => {
  const {
    enrollmentId,
    userId,
    courseId,
    monthlyFeeINR,
    monthsPaid,
  } = params;

  const now = new Date();

  if (!Number.isInteger(monthsPaid) || monthsPaid <= 0) {
    throw new EnrollmentError(
      "Invalid prepaid month count.",
      400
    );
  }

  const months = generateDueMonths(now, monthsPaid);

  for (const dueMonth of months) {
    const [yyyy, mm] = dueMonth.split("-").map(Number);

    const dueDate = new Date(
      yyyy,
      mm - 1,
      1
    );

    await prisma.monthlyDue.upsert({
      where: {
        enrollmentId_dueMonth: {
          enrollmentId,
          dueMonth,
        },
      },

      update: {
        status: "SUCCESS",
        paidAt: now,
      },

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

  const nextMonths = generateDueMonths(
    now,
    monthsPaid + 1
  );

  const nextDueMonth =
    nextMonths[nextMonths.length - 1];

  const [ny, nm] =
    nextDueMonth.split("-").map(Number);

  const nextDueDate = new Date(
    ny,
    nm - 1,
    1
  );

  await prisma.monthlyDue.upsert({
    where: {
      enrollmentId_dueMonth: {
        enrollmentId,
        dueMonth: nextDueMonth,
      },
    },

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


// ─────────────────────────────────────────────────────────────────────────────
// CREATE NEXT MONTHLY DUE
// ─────────────────────────────────────────────────────────────────────────────

export const createNextMonthlyDue = async (params: {
  enrollmentId: string;
  userId: string;
  courseId: string;
  monthlyFeeINR: number;
}) => {
  const {
    enrollmentId,
    userId,
    courseId,
    monthlyFeeINR,
  } = params;

  const now = new Date();

  const [currentMonth] = generateDueMonths(
    new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    ),
    1
  );

  await prisma.monthlyDue.upsert({
    where: {
      enrollmentId_dueMonth: {
        enrollmentId,
        dueMonth: currentMonth,
      },
    },

    update: {
      status: "SUCCESS",
      paidAt: now,
    },

    create: {
      enrollmentId,
      userId,
      courseId,
      dueMonth: currentMonth,
      dueDate: new Date(
        now.getFullYear(),
        now.getMonth(),
        1
      ),
      amount: monthlyFeeINR,
      currency: "INR",
      status: "SUCCESS",
      paidAt: now,
    },
  });

  const nextDue = nextMonthDueDate(now);

  const mm = String(
    nextDue.getMonth() + 1
  ).padStart(2, "0");

  const nextDueMonth =
    `${nextDue.getFullYear()}-${mm}`;

  await prisma.monthlyDue.upsert({
    where: {
      enrollmentId_dueMonth: {
        enrollmentId,
        dueMonth: nextDueMonth,
      },
    },

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
// SHARED RAZORPAY ENROLLMENT ORDER CREATION
//
// Used by:
// - Public student enrollment
// - Admin online enrollment
//
// Pricing is ALWAYS calculated from backend course data.
// Client supplied amount is never trusted.
// ─────────────────────────────────────────────────────────────────────────────

export const createEnrollmentPaymentOrder = async (
  validated: any,
  requestedMonths: number,
  country: string,
  idempotencyKey: string
) => {
  const {
    batchId,
    courseId,
    enrollmentType,
  } = validated.payload;

  // ------------------------------------------------------------
  // Validate idempotency key
  // ------------------------------------------------------------

  const normalizedIdempotencyKey =
    String(idempotencyKey || "").trim();

  if (!normalizedIdempotencyKey) {
    throw new EnrollmentError(
      "Idempotency key is required.",
      400
    );
  }

  if (normalizedIdempotencyKey.length > 255) {
    throw new EnrollmentError(
      "Invalid idempotency key.",
      400
    );
  }

  // ------------------------------------------------------------
  // Only 1 / 3 / 6 / 12 months are allowed
  // ------------------------------------------------------------

  if (![1, 3, 6, 12].includes(requestedMonths)) {
    throw new EnrollmentError(
      "Invalid payment plan. Allowed plans are 1, 3, 6 or 12 months.",
      400
    );
  }

  // ------------------------------------------------------------
  // Backend-authoritative currency
  // India => INR
  // Non-India => USD
  // ------------------------------------------------------------

  const currency = resolveCurrency(country);

  // ------------------------------------------------------------
  // Check existing idempotent payment attempt
  //
  // Same key = same business attempt.
  // Never create another PendingEnrollment/Razorpay order.
  // ------------------------------------------------------------

  const existingPending =
    await prisma.pendingEnrollment.findUnique({
      where: {
        idempotencyKey:
          normalizedIdempotencyKey,
      },
    });

  if (existingPending) {
    const existingPayload =
      existingPending.payload as Record<
        string,
        any
      >;

    const existingCourseId =
      String(
        existingPending.courseId || ""
      );

    const existingMonths = Number(
      existingPayload?.months || 0
    );

    const existingCurrency =
      String(
        existingPayload?.expectedCurrency || ""
      ).toUpperCase();

    // ----------------------------------------------------------
    // Same idempotency key cannot be reused for another request
    // ----------------------------------------------------------

    if (
      existingCourseId !==
        String(courseId) ||
      existingMonths !== requestedMonths ||
      existingCurrency !== currency
    ) {
      throw new EnrollmentError(
        "This idempotency key is already associated with a different enrollment request.",
        409
      );
    }

    // ----------------------------------------------------------
    // Existing Razorpay order = return same order
    // ----------------------------------------------------------

    if (existingPending.razorpayOrderId) {
      const existingAmount =
        Number(
          existingPayload?.expectedAmount || 0
        );

      return {
        pendingId: existingPending.id,
        orderId:
          existingPending.razorpayOrderId,
        currency,
        amount: Math.round(
          existingAmount * 100
        ),
        reused: true,
      };
    }

    // ----------------------------------------------------------
    // A failed attempt without an order cannot silently become
    // a new business attempt with the same key.
    // ----------------------------------------------------------

    if (
      existingPending.status ===
      "FAILED"
    ) {
      throw new EnrollmentError(
        "This payment attempt has already failed. Please start a new payment attempt with a new idempotency key.",
        409
      );
    }
  }

  // ------------------------------------------------------------
  // Resolve backend pricing
  // ------------------------------------------------------------

  let resolvedBatchId = "";
  let monthlyFee = 0;
  let joiningFee = 0;
  let tiers: BulkDiscountTier[] = [];

  const isGroup =
    enrollmentType !== "ONE_TO_ONE";

  // ------------------------------------------------------------
  // ONE-TO-ONE
  // ------------------------------------------------------------

  if (!isGroup) {
    const course =
      await prisma.course.findUnique({
        where: {
          id: courseId,
        },
      });

    if (!course) {
      throw new EnrollmentError(
        "Course not found.",
        404
      );
    }

    monthlyFee =
      currency === "USD"
        ? course.oneToOneFeeUSD || 0
        : course.oneToOneFeeINR || 0;

    joiningFee =
      currency === "USD"
        ? course.joiningFeeUSD ?? 0
        : course.joiningFeeINR ?? 1100;

    tiers = parseTiers(
      course.bulkDiscountTiers
    );
  }

  // ------------------------------------------------------------
  // GROUP / BATCH
  // ------------------------------------------------------------

  else {
    if (!batchId) {
      throw new EnrollmentError(
        "Batch is required for group enrollment.",
        400
      );
    }

    const batch =
      await prisma.batch.findUnique({
        where: {
          id: batchId,
        },
        include: {
          course: true,
        },
      });

    if (
      !batch ||
      !batch.course
    ) {
      throw new EnrollmentError(
        "Batch or Course not found.",
        404
      );
    }

    if (
      batch.courseId !== courseId
    ) {
      throw new EnrollmentError(
        "Selected batch does not belong to the chosen course.",
        400
      );
    }

    monthlyFee =
      currency === "USD"
        ? batch.course.groupFeeUSD || 0
        : batch.course.groupFeeINR || 0;

    joiningFee =
      currency === "USD"
        ? batch.course.joiningFeeUSD ?? 0
        : batch.course.joiningFeeINR ?? 1100;

    tiers = parseTiers(
      batch.course.bulkDiscountTiers
    );

    resolvedBatchId = batchId;
  }

  // ------------------------------------------------------------
  // Validate monthly fee
  // ------------------------------------------------------------

  if (
    !Number.isFinite(monthlyFee) ||
    monthlyFee <= 0
  ) {
    throw new EnrollmentError(
      "Invalid course fee.",
      400
    );
  }

  // ------------------------------------------------------------
  // Enforce NEW enrollment only & check active enrollment
  // ------------------------------------------------------------

  const existingUser = await prisma.user.findFirst({
    where: { email: validated.normalizedEmail },
  });
  const activeEnrollment = existingUser
    ? await prisma.enrollment.findFirst({
        where: { userId: existingUser.id, courseId, active: true, upgradedTo: null },
      })
    : null;

  if (activeEnrollment) {
    throw new EnrollmentError(
      "Student is already enrolled in this course. Please use Admin Finance to process renewals.",
      409
    );
  }

  const operationType: "NEW" = "NEW";

  const joiningFeeApplied = requestedMonths === 1 ? joiningFee : 0;

  // ------------------------------------------------------------
  // Pricing
  //
  // 1 month:
  //   monthly fee + joining fee (if NEW)
  //
  // 3/6/12:
  //   bulk pricing
  //   joining fee = 0
  // ------------------------------------------------------------

  const pricing =
    requestedMonths === 1
      ? {
          total:
            calculateMonthlyEnrollmentAmount(
              monthlyFee,
              joiningFeeApplied
            ),

          joiningFee: joiningFeeApplied,

          discountAmount: 0,

          discountPercent: 0,
        }
      : calculateBulkEnrollmentAmount(
          monthlyFee,
          requestedMonths,
          tiers
        );

  const paymentMode: PaymentMode =
    requestedMonths === 1
      ? "MONTHLY"
      : "FULL_COURSE";

  const finalAmount =
    Number(pricing.total);

  if (
    !Number.isFinite(finalAmount) ||
    finalAmount <= 0
  ) {
    throw new EnrollmentError(
      "Invalid enrollment amount.",
      400
    );
  }

  const amountInSmallestUnit =
    Math.round(finalAmount * 100);

  if (
    amountInSmallestUnit <= 0
  ) {
    throw new EnrollmentError(
      "Invalid payment amount.",
      400
    );
  }

  // ------------------------------------------------------------
  // Razorpay
  // ------------------------------------------------------------

  const razorpay = getRazorpay();

  if (!razorpay) {
    throw new EnrollmentError(
      "Payment is temporarily unavailable.",
      500
    );
  }

  // ------------------------------------------------------------
  // Create PendingEnrollment
  //
  // IMPORTANT:
  // Use caller supplied idempotency key.
  // Never generate a new UUID here.
  // ------------------------------------------------------------

  let pending =
    existingPending;

  if (!pending) {
    pending =
      await prisma.pendingEnrollment.create({
        data: {
          email:
            validated.normalizedEmail,

          phone:
            validated.e164Phone,

          passwordHash:
            validated.passwordHash,

          batchId:
            resolvedBatchId,

          courseId,

          idempotencyKey:
            normalizedIdempotencyKey,

          payload: {
            ...(validated.payload as object),

            operationType,

            paymentMode,

            months:
              requestedMonths,

            expectedAmount:
              finalAmount,

            expectedCurrency:
              currency,

            monthlyBaseAmount:
              monthlyFee,

            joiningFeeApplied:
              pricing.joiningFee,

            discountAmount:
              pricing.discountAmount,

            discountPercent:
              pricing.discountPercent,

            gateway:
              "RAZORPAY",
          },
        },
      });
  }

  // ------------------------------------------------------------
  // Existing pending record may have been created but not yet
  // assigned a Razorpay order.
  // ------------------------------------------------------------

  if (pending.razorpayOrderId) {
    return {
      pendingId: pending.id,
      orderId:
        pending.razorpayOrderId,
      currency,
      amount:
        amountInSmallestUnit,
      reused: true,
    };
  }

  // ------------------------------------------------------------
  // Create Razorpay order
  // ------------------------------------------------------------

  const order =
    await razorpay.orders.create({
      amount:
        amountInSmallestUnit,

      currency,

      receipt:
        pending.id,

      payment_capture: true,

      notes: {
        pendingId:
          pending.id,

        pendingEnrollmentId:
          pending.id,

        courseId,

        months:
          String(requestedMonths),

        currency,

        idempotencyKey:
          normalizedIdempotencyKey,
      },
    });

  // ------------------------------------------------------------
  // Save Razorpay order ID
  // ------------------------------------------------------------

  await prisma.pendingEnrollment.update({
    where: {
      id: pending.id,
    },

    data: {
      razorpayOrderId:
        order.id,
    },
  });

  // ------------------------------------------------------------
  // Return
  // ------------------------------------------------------------

  return {
    pendingId:
      pending.id,

    orderId:
      order.id,

    currency:
      order.currency,

    amount:
      order.amount,

    reused: false,
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CREATE ORDER
//
// Public enrollment:
// - Password required
// - Existing user not allowed
// - Email OTP required
// - Mobile OTP required
// - Razorpay only
// ─────────────────────────────────────────────────────────────────────────────

export const createOrder = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // ------------------------------------------------------------
    // Validate enrollment data
    // ------------------------------------------------------------

    const validated =
      await validateEnrollmentInput(
        req.body,
        {
          requirePassword: true,
          allowExistingUser: false,
        }
      );

    // ------------------------------------------------------------
    // OTP verification
    // ------------------------------------------------------------

    await assertContactVerified(
      "EMAIL",
      validated.normalizedEmail
    );

    await assertContactVerified(
      "MOBILE",
      validated.e164Phone
    );

    // ------------------------------------------------------------
    // Payment months
    // ------------------------------------------------------------

    const requestedMonths =
      Number.parseInt(
        String(
          req.body.months ?? "1"
        ),
        10
      );

    if (
      ![1, 3, 6, 12].includes(
        requestedMonths
      )
    ) {
      throw new EnrollmentError(
        "Invalid payment plan. Allowed plans are 1, 3, 6 or 12 months.",
        400
      );
    }

    // ------------------------------------------------------------
    // Idempotency key
    //
    // Preferred:
    // Idempotency-Key HTTP header
    //
    // Fallback:
    // req.body.idempotencyKey
    // ------------------------------------------------------------

    const headerKey =
      req.headers["idempotency-key"];

    const idempotencyKey =
      typeof headerKey === "string"
        ? headerKey.trim()
        : String(
            req.body.idempotencyKey || ""
          ).trim();

    if (!idempotencyKey) {
      throw new EnrollmentError(
        "Idempotency key is required.",
        400
      );
    }

    if (
      idempotencyKey.length > 255
    ) {
      throw new EnrollmentError(
        "Invalid idempotency key.",
        400
      );
    }

    // ------------------------------------------------------------
    // Country
    // Backend decides currency.
    // ------------------------------------------------------------

    const country =
      String(
        req.body.country ||
          validated.payload?.country ||
          ""
      ).trim();

    // ------------------------------------------------------------
    // Create Razorpay order
    // ------------------------------------------------------------

    const orderData =
      await createEnrollmentPaymentOrder(
        validated,
        requestedMonths,
        country,
        idempotencyKey
      );

    // ------------------------------------------------------------
    // Response
    // ------------------------------------------------------------

    res.json({
      status: "success",

      data: {
        ...orderData,

        keyId:
          env.razorpayKeyId,
      },
    });
  } catch (error) {
    // ------------------------------------------------------------
    // Known errors
    // ------------------------------------------------------------

    if (
      error instanceof OtpError ||
      error instanceof EnrollmentError
    ) {
      res.status(
        error.statusCode || 400
      ).json({
        status: "error",
        message:
          error.message,
      });

      return;
    }

    // ------------------------------------------------------------
    // Unexpected errors
    // ------------------------------------------------------------

    console.error(
      "createOrder error:",
      error
    );

    res.status(500).json({
      status: "error",
      message:
        "Failed to create order.",
    });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT PLAN
//
// Returns authoritative pricing for frontend display.
// Frontend amount is never trusted during actual payment creation.
// ─────────────────────────────────────────────────────────────────────────────

export const getPaymentPlan = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const courseId =
      String(
        req.query.courseId || ""
      ).trim();

    if (!courseId) {
      res.status(400).json({
        status: "error",
        message:
          "Course ID is required.",
      });

      return;
    }

    const enrollmentType =
      String(
        req.query.enrollmentType ||
          "GROUP"
      )
        .trim()
        .toUpperCase();

    const country =
      String(
        req.query.country || ""
      ).trim();

    const currency =
      resolveCurrency(country);

    // ------------------------------------------------------------
    // Course
    // ------------------------------------------------------------

    const course =
      await prisma.course.findUnique({
        where: {
          id: courseId,
        },
      });

    if (!course) {
      res.status(404).json({
        status: "error",
        message:
          "Course not found.",
      });

      return;
    }

    // ------------------------------------------------------------
    // Pricing type
    // ------------------------------------------------------------

    const isGroup =
      enrollmentType !==
      "ONE_TO_ONE";

    const monthlyFee =
      currency === "USD"
        ? isGroup
          ? course.groupFeeUSD || 0
          : course.oneToOneFeeUSD || 0
        : isGroup
          ? course.groupFeeINR || 0
          : course.oneToOneFeeINR || 0;

    const joiningFee =
      currency === "USD"
        ? course.joiningFeeUSD ?? 0
        : course.joiningFeeINR ?? 1100;

    if (
      !Number.isFinite(
        monthlyFee
      ) ||
      monthlyFee <= 0
    ) {
      res.status(400).json({
        status: "error",
        message:
          "Invalid course fee.",
      });

      return;
    }

    const tiers =
      parseTiers(
        course.bulkDiscountTiers
      );

    const isRenewal =
      String(req.query.isRenewal || "").trim().toLowerCase() === "true";

    const joiningFeeApplied = isRenewal ? 0 : joiningFee;

    // ------------------------------------------------------------
    // 1 month
    // ------------------------------------------------------------

    const monthlyCalc =
      calculateMonthlyEnrollmentAmount(
        monthlyFee,
        joiningFeeApplied
      );

    const monthlyOption = {
      mode:
        "MONTHLY" as PaymentMode,

      months: 1,

      monthlyFee,

      joiningFee: joiningFeeApplied,

      total:
        monthlyCalc,

      discountPercent: 0,

      discountAmount: 0,

      originalTotal:
        monthlyCalc,

      currency,
    };

    // ------------------------------------------------------------
    // 3 / 6 / 12 months
    //
    // Joining fee = 0
    // ------------------------------------------------------------

    const bulkOptions =
      [3, 6, 12].map(
        (months) => {
          const calc =
            calculateBulkEnrollmentAmount(
              monthlyFee,
              months,
              tiers
            );

          return {
            mode:
              "FULL_COURSE" as PaymentMode,

            months,

            monthlyFee,

            joiningFee: 0,

            total:
              calc.total,

            discountPercent:
              calc.discountPercent,

            discountAmount:
              calc.discountAmount,

            originalTotal:
              calc.originalTotal,

            currency,
          };
        }
      );

    // ------------------------------------------------------------
    // Response
    // ------------------------------------------------------------

    res.json({
      status: "success",

      data: {
        courseId,

        courseTitle:
          course.title,

        monthlyFee,

        joiningFee,

        autoPayEnabled:
          course.autoPayEnabled,

        courseDurationMonths:
          course.courseDurationMonths,

        currency,

        pricingOptions: [
          monthlyOption,
          ...bulkOptions,
        ],
      },
    });
  } catch (error) {
    console.error(
      "getPaymentPlan error:",
      error
    );

    res.status(500).json({
      status: "error",
      message:
        "Failed to fetch payment plan.",
    });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// RAZORPAY WEBHOOK
//
// Important:
// - Verify signature before processing.
// - payment.captured and order.paid are accepted.
// - Duplicate webhook is safe because finalization is idempotent.
// ─────────────────────────────────────────────────────────────────────────────

export const handleRazorpayWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // ------------------------------------------------------------
    // Webhook secret
    // ------------------------------------------------------------

    if (
      !env.razorpayWebhookSecret
    ) {
      res.status(503).json({
        status: "error",
        message:
          "Razorpay webhook secret is not configured.",
      });

      return;
    }

    // ------------------------------------------------------------
    // Signature
    // ------------------------------------------------------------

    const signature =
      req.headers[
        "x-razorpay-signature"
      ];

    const rawBody =
      getRawBody(req);

    if (
      !rawBody ||
      typeof signature !== "string"
    ) {
      res.status(400).json({
        status: "error",
        message:
          "Missing webhook signature.",
      });

      return;
    }

    // ------------------------------------------------------------
    // Verify HMAC
    // ------------------------------------------------------------

    const expected =
      crypto
        .createHmac(
          "sha256",
          env.razorpayWebhookSecret
        )
        .update(rawBody)
        .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature)
      )
    ) {
      res.status(400).json({
        status: "error",
        message:
          "Invalid webhook signature.",
      });

      return;
    }

    // ------------------------------------------------------------
    // Parse webhook
    // ------------------------------------------------------------

    const event =
      typeof req.body === "object" &&
      !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(
            rawBody.toString("utf8")
          );

    const eventName =
      event?.event as
        | string
        | undefined;

    const paymentEntity =
      event?.payload?.payment
        ?.entity;

    const orderEntity =
      event?.payload?.order
        ?.entity;

    // ------------------------------------------------------------
    // PAYMENT FAILED
    // ------------------------------------------------------------

    if (
      eventName ===
      "payment.failed"
    ) {
      const failedOrderId =
        paymentEntity?.order_id as
          | string
          | undefined;

      if (failedOrderId) {
        await prisma.pendingEnrollment.updateMany(
          {
            where: {
              razorpayOrderId:
                failedOrderId,

              status:
                PendingEnrollmentStatus.PENDING,
            },

            data: {
              status:
                PendingEnrollmentStatus.FAILED,

              errorMessage:
                paymentEntity
                  ?.error_description ||
                "Payment failed",
            },
          }
        );

        // Event tickets may use the same Razorpay
        // order infrastructure.
        await failEventTicketByOrder(
          failedOrderId
        );

        // Demo bookings may use the same infrastructure.
        await failDemoBookingByOrder(
          failedOrderId
        );
      }

      res.json({
        status: "ok",
      });

      return;
    }

    // ------------------------------------------------------------
    // Ignore unrelated webhook events
    // ------------------------------------------------------------

    if (
      eventName !==
        "payment.captured" &&
      eventName !==
        "order.paid"
    ) {
      res.json({
        status: "ignored",
      });

      return;
    }

    // ------------------------------------------------------------
    // Payment ID / Order ID
    // ------------------------------------------------------------

    const razorpayPaymentId =
      paymentEntity?.id as
        | string
        | undefined;

    const razorpayOrderId =
      (
        paymentEntity?.order_id ||
        orderEntity?.id
      ) as
        | string
        | undefined;

    // ------------------------------------------------------------
    // Pending ID
    //
    // We support both names because existing orders may have
    // either note key.
    // ------------------------------------------------------------

    const pendingId =
      (
        paymentEntity?.notes
          ?.pendingEnrollmentId ||
        paymentEntity?.notes
          ?.pendingId ||
        orderEntity?.notes
          ?.pendingEnrollmentId ||
        orderEntity?.notes
          ?.pendingId
      ) as
        | string
        | undefined;

    if (
      !razorpayPaymentId ||
      !razorpayOrderId
    ) {
      res.json({
        status: "ignored",
      });

      return;
    }

    // ------------------------------------------------------------
    // Event ticket
    // ------------------------------------------------------------

    const ticketPaid =
      await confirmEventTicketByOrder(
        razorpayOrderId,
        razorpayPaymentId
      );

    if (ticketPaid) {
      res.json({
        status: "ok",
      });

      return;
    }

    // ------------------------------------------------------------
    // Demo booking
    // ------------------------------------------------------------

    const demoPaid =
      await confirmDemoBookingByOrder(
        razorpayOrderId,
        razorpayPaymentId
      );

    if (demoPaid) {
      res.json({
        status: "ok",
      });

      return;
    }

    // ------------------------------------------------------------
    // Student enrollment
    //
    // completePendingEnrollment() owns the atomic finalization.
    // ------------------------------------------------------------

    const result =
      await completePendingEnrollment({
        pendingId:
          pendingId,

        razorpayOrderId:
          razorpayOrderId,

        razorpayPaymentId:
          razorpayPaymentId,
      });

    // ------------------------------------------------------------
    // Email is an external side effect.
    //
    // Do not put email sending inside the DB transaction.
    // ------------------------------------------------------------

    if (
      !result.alreadyCompleted
    ) {
      await sendEnrollmentWelcomeEmail(
        result.user
      );
    }

    // ------------------------------------------------------------
    // Success
    // ------------------------------------------------------------

    res.json({
      status: "ok",
    });
  } catch (error) {
    // ------------------------------------------------------------
    // Unknown order / non-enrollment webhook
    // ------------------------------------------------------------

    if (
      error instanceof
        EnrollmentError &&
      error.statusCode === 404
    ) {
      res.json({
        status: "ignored",
      });

      return;
    }

    console.error(
      "Razorpay webhook error:",
      error
    );

    res.status(500).json({
      status: "error",
      message:
        "Webhook processing failed.",
    });
  }
};