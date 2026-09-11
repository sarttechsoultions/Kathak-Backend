import {
  ClassMode,
  PaymentStatus,
  PendingEnrollmentStatus,
  Prisma,
  Role,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { sendEmail } from "../../lib/mailer";
import {
  buildInvoiceEmailBlock,
  buildStudentPaymentReceiptHtml,
  generatePdfBuffer,
  InvoiceData,
} from "../../lib/invoice";
import {
  enrollmentAmountINR,
  calculateEnrollmentAmount,
  calculateRenewalAmount,
  generateCoverageMonths,
  nextCoverageDueDate,
  nextMonthDueDate,
  parseTiers,
  validateEnrollmentMonths,
} from "../../lib/fees";

import { resolveCurrency } from "../../lib/currency";
import { isOneToOneBatch } from "../../lib/batchHelpers";
import { getRazorpay } from "../payment/payment.controller";

export class EnrollmentError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "EnrollmentError";
    this.statusCode = statusCode;
  }
}

const VALID_UPGRADE_DURATIONS = [1, 6, 12];

const calculateUpgradeFee = (
  monthlyFee: number,
  months: number,
  bulkDiscountTiers: unknown
): {
  monthlyFee: number;
  months: number;
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  finalAmount: number;
} => {
  const subtotal = monthlyFee * months;

  const tiers = Array.isArray(bulkDiscountTiers)
    ? bulkDiscountTiers
        .map((tier: any) => ({
          months: Number(tier?.months),
          discountPercent: Number(tier?.discountPercent),
        }))
        .filter(
          (tier) =>
            Number.isFinite(tier.months) &&
            tier.months > 0 &&
            Number.isFinite(tier.discountPercent) &&
            tier.discountPercent >= 0 &&
            tier.discountPercent <= 100
        )
    : [];

  const matchingTier = tiers
    .filter((tier) => tier.months === months)
    .sort((a, b) => b.discountPercent - a.discountPercent)[0];

  const discountPercent = matchingTier?.discountPercent ?? 0;

  const discountAmount = Math.round(
    (subtotal * discountPercent) / 100
  );

  const finalAmount = Math.max(0, subtotal - discountAmount);

  return {
    monthlyFee,
    months,
    subtotal,
    discountPercent,
    discountAmount,
    finalAmount,
  };
};

export type EnrollmentClassType = "GROUP" | "ONE_TO_ONE";

export type EnrollmentPayload = {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  countryCode: string;
  address: string;
  profileImage?: string | null;
  dob?: string | null;
  gender?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  skillLevel?: string | null;
  joiningDate?: string | null;
  isUnder18: boolean;
  guardianName?: string | null;
  relationship?: string | null;
  emergencyContact?: string | null;
  paymentMethod: string;
  showGstIncluded?: boolean;
  billingLegalName?: string | null;
  billingGstin?: string | null;
  courseId: string;
  batchId: string;
  enrollmentType: EnrollmentClassType;
  preferredDate?: string | null;
  preferredTime?: string | null;
};

export type ValidatedEnrollment = {
  payload: EnrollmentPayload;
  passwordHash: string;
  normalizedEmail: string;
  e164Phone: string;
};

type CompletedEnrollment = {
  user: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    country: string | null;
    countryCode: string | null;
    address: string | null;
    role: Role;
    avatarUrl: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  enrollment: {
    id: string;
    courseId: string;
    mode: string;
    type: string;
    active: boolean;
    createdAt: Date;
    nextDueDate?: Date | null;
  };
  alreadyCompleted: boolean;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIME_12_REGEX = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i;

const WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const parseEnrollmentType = (
  value: unknown
): EnrollmentClassType => {
  const raw = String(value || "GROUP")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "-");

  if (
    raw === "ONE-TO-ONE" ||
    raw === "1-TO-1" ||
    raw === "1TO1" ||
    raw === "PERSONAL" ||
    raw === "ONETOONE"
  ) {
    return "ONE_TO_ONE";
  }

  return "GROUP";
};

const todayIsoDate = (): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year =
    parts.find((part) => part.type === "year")?.value || "1970";

  const month =
    parts.find((part) => part.type === "month")?.value || "01";

  const day =
    parts.find((part) => part.type === "day")?.value || "01";

  return `${year}-${month}-${day}`;
};

const weekdayFromIsoDate = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);

  return WEEKDAYS[
    new Date(year, month - 1, day).getDay()
  ];
};

export const normalizeClassTime = (value: string): string => {
  const trimmed = value.trim();

  const match12 = trimmed.match(TIME_12_REGEX);

  if (match12) {
    let hour = Number(match12[1]);
    const minute = match12[2];
    const meridian = match12[3].toUpperCase();

    if (hour < 1 || hour > 12) {
      throw new EnrollmentError(
        "Please choose a valid class time."
      );
    }

    const hourLabel =
      hour < 10 ? `0${hour}` : String(hour);

    return `${hourLabel}:${minute} ${meridian}`;
  }

  const match24 = trimmed.match(TIME_24_REGEX);

  if (match24) {
    let hour = Number(match24[1]);
    const minute = match24[2];

    const meridian = hour >= 12 ? "PM" : "AM";

    hour = hour % 12;

    if (hour === 0) {
      hour = 12;
    }

    const hourLabel =
      hour < 10 ? `0${hour}` : String(hour);

    return `${hourLabel}:${minute} ${meridian}`;
  }

  throw new EnrollmentError(
    "Please choose a valid class time."
  );
};

const batchLevelFromCourse = (
  category?: string | null
): string => {
  const raw = String(category || "").toUpperCase();

  if (raw === "INTERMEDIATE") {
    return "INTERMEDIATE";
  }

  if (raw === "PREMIUM" || raw === "ADVANCED") {
    return "ADVANCED";
  }

  return "BEGINNER";
};

const findDefaultOneToOneTeacher = async (
  tx: Prisma.TransactionClient
) => {
  return tx.user.findFirst({
    where: {
      role: Role.TEACHER,
      isActive: true,
      email: "kathakbyharshita@gmail.com",
    },
    orderBy: {
      createdAt: "asc",
    },
  });
};

const createOneToOneBatch = async (
  tx: Prisma.TransactionClient,
  payload: EnrollmentPayload,
  course: {
    id: string;
    title: string;
    category?: string | null;
  }
) => {
  const teacher =
    await findDefaultOneToOneTeacher(tx);

  if (!teacher) {
    throw new EnrollmentError(
      "No teacher is available to assign this 1-to-1 batch. Please contact the academy.",
      500
    );
  }

  const preferredDate =
    String(payload.preferredDate || "");

  const classTime = normalizeClassTime(
    String(payload.preferredTime || "")
  );

  const weekday =
    weekdayFromIsoDate(preferredDate);

  const studentFirstName =
    payload.fullName
      .trim()
      .split(/\s+/)[0] || "Student";

  const batchCode =
    `OTO-${Date.now()
      .toString(36)
      .toUpperCase()}${Math.random()
      .toString(36)
      .slice(2, 5)
      .toUpperCase()}`;

  return tx.batch.create({
    data: {
      name:
        `1-to-1 · ${course.title} · ${studentFirstName}`,

      code: batchCode,

      courseId: course.id,

      courseName: course.title,

      teacherId: teacher.id,

      teacherName: teacher.fullName,

      schedule:
        `${weekday}|${classTime}|${preferredDate}|`,

      level:
        batchLevelFromCourse(course.category),

      status: "Active",

      totalStudents: 0,
    },
  });
};

export const toE164 = (
  phone: unknown,
  countryCode: unknown = "+91"
): string => {
  const digits = String(phone || "")
    .replace(/\D/g, "");

  const code = String(countryCode || "+91")
    .replace(/\D/g, "");

  if (code && digits.startsWith(code)) {
    return `+${digits}`;
  }

  return `+${code}${digits}`;
};

export const isAgeUnder18 = (
  dob: unknown
): boolean => {
  if (!dob) {
    return false;
  }

  const birthDate =
    new Date(String(dob));

  if (Number.isNaN(birthDate.getTime())) {
    return false;
  }

  const today = new Date();

  let age =
    today.getFullYear() -
    birthDate.getFullYear();

  const monthDiff =
    today.getMonth() -
    birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (
      monthDiff === 0 &&
      today.getDate() < birthDate.getDate()
    )
  ) {
    age -= 1;
  }

  return age < 18;
};

const isPrismaUniqueError = (
  error: any,
  targetField?: string
): boolean => {
  if (error && error.code === "P2002") {
    if (!targetField) return true;
    const target = error.meta?.target;
    if (Array.isArray(target) && target.includes(targetField)) return true;
    if (typeof target === "string" && target.includes(targetField)) return true;
  }
  return false;
};

const asPayload = (
  value: Prisma.JsonValue
): EnrollmentPayload => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new EnrollmentError(
      "Stored enrollment payload is invalid.",
      500
    );
  }

  return value as EnrollmentPayload;
};

const publicUser = (user: {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  country: string | null;
  countryCode: string | null;
  address: string | null;
  role: Role;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CompletedEnrollment["user"] => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  country: user.country,
  countryCode: user.countryCode,
  address: user.address,
  role: user.role,
  avatarUrl: user.avatarUrl,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const validateEnrollmentInput = async (
  body: Record<string, unknown>,
  options: {
    requirePassword: boolean;
    allowExistingUser?: boolean;
  }
): Promise<ValidatedEnrollment> => {
  const fullName = String(body.fullName || "").trim();

  const email = String(body.email || "")
    .trim()
    .toLowerCase();

  const country = String(body.country || "").trim();

  const countryCodeRaw = String(
    body.countryCode || "+91"
  ).trim();

  const countryCode = countryCodeRaw.startsWith("+")
    ? countryCodeRaw
    : `+${countryCodeRaw}`;

  const address = String(body.address || "").trim();

  const password = String(body.password || "");

  const courseId = String(body.courseId || "").trim();

  const enrollmentType = parseEnrollmentType(
    body.enrollmentType ||
      body.type ||
      body.mode
  );

  let batchId = String(body.batchId || "").trim();

  const preferredDate = body.preferredDate
    ? String(body.preferredDate).trim()
    : "";

  const preferredTime = body.preferredTime
    ? String(body.preferredTime).trim()
    : "";

  const dob = body.dob
    ? String(body.dob).trim()
    : "";

  const gender = String(body.gender || "").trim();

  const city = String(body.city || "").trim();

  const region = String(body.region || "").trim();

  const postalCode = String(
    body.postalCode || ""
  ).trim();

  const guardianName = String(
    body.guardianName || ""
  ).trim();

  const relationship = String(
    body.relationship || ""
  ).trim();

  const emergencyContact = String(
    body.emergencyContact || ""
  ).trim();

  const methodRaw = String(
    body.paymentMethod || "RAZORPAY"
  )
    .trim()
    .toUpperCase();

  const paymentMethod =
    methodRaw === "CARD" ||
    methodRaw === "UPI" ||
    methodRaw === "NETBANKING"
      ? methodRaw
      : "RAZORPAY";

  const showGstIncluded =
    body.showGstIncluded === true || body.showGstIncluded === "true";

  const billingLegalName = showGstIncluded
    ? String(body.billingLegalName || "").trim()
    : "";
  const billingGstin = showGstIncluded
    ? String(body.billingGstin || "").trim().toUpperCase()
    : "";

  const isUnder18 =
    Boolean(body.isUnder18) ||
    isAgeUnder18(dob);

  /*
   * ---------------------------------------------------------
   * BASIC VALIDATION
   * ---------------------------------------------------------
   */

  if (!fullName) {
    throw new EnrollmentError(
      "Full Name is required."
    );
  }

  if (!email) {
    throw new EnrollmentError(
      "Email is required."
    );
  }

  if (!EMAIL_REGEX.test(email)) {
    throw new EnrollmentError(
      "Invalid email address."
    );
  }

  if (!country) {
    throw new EnrollmentError(
      "Country is required."
    );
  }

  if (!String(body.phone || "").trim()) {
    throw new EnrollmentError(
      "Phone number is required."
    );
  }

  const e164Phone = toE164(
    body.phone,
    countryCode
  );

  const digitsOnly =
    e164Phone.replace(/\D/g, "");

  if (
    digitsOnly.length < 10 ||
    digitsOnly.length > 15
  ) {
    throw new EnrollmentError(
      "Please enter a valid international phone number (10–15 digits)."
    );
  }

  if (!address) {
    throw new EnrollmentError(
      "Residential address is required."
    );
  }

  if (!region) {
    throw new EnrollmentError(
      "State / region is required."
    );
  }

  if (!city) {
    throw new EnrollmentError(
      "City is required."
    );
  }

  if (!postalCode) {
    throw new EnrollmentError(
      "Postal / ZIP code is required."
    );
  }

  if (!dob) {
    throw new EnrollmentError(
      "Date of birth is required."
    );
  }

  if (!gender) {
    throw new EnrollmentError(
      "Gender is required."
    );
  }

  if (!courseId) {
    throw new EnrollmentError(
      "Course is required."
    );
  }

  /*
   * ---------------------------------------------------------
   * COURSE VALIDATION
   * ---------------------------------------------------------
   */

  const courseRecord =
    await prisma.course.findUnique({
      where: {
        id: courseId,
      },
    });

  if (!courseRecord) {
    throw new EnrollmentError(
      "Selected course does not exist."
    );
  }

  /*
   * ---------------------------------------------------------
   * 1-TO-1 / GROUP VALIDATION
   * ---------------------------------------------------------
   */

  if (enrollmentType === "ONE_TO_ONE") {
    if (
      !preferredDate ||
      !ISO_DATE_REGEX.test(preferredDate)
    ) {
      throw new EnrollmentError(
        "Please choose a date for your 1-to-1 class."
      );
    }

    if (
      preferredDate < todayIsoDate()
    ) {
      throw new EnrollmentError(
        "Please choose a date that is today or later."
      );
    }

    normalizeClassTime(preferredTime);

    /*
     * Currency-aware pricing validation.
     *
     * India => INR
     * Other countries => USD
     */
    const currency =
      resolveCurrency(
        countryCode || country
      );

    const oneToOneFee =
      currency === "USD"
        ? Number(
            courseRecord.oneToOneFeeUSD || 0
          )
        : Number(
            courseRecord.oneToOneFeeINR || 0
          );

    if (
      !Number.isFinite(oneToOneFee) ||
      oneToOneFee <= 0
    ) {
      throw new EnrollmentError(
        currency === "USD"
          ? "One-to-one USD pricing is not available for this course."
          : "One-to-one enrollment is not available for this course."
      );
    }

    batchId = "";
  } else {
    if (!batchId) {
      throw new EnrollmentError(
        "Please select a batch before proceeding to payment."
      );
    }

    const batchRecord =
      await prisma.batch.findUnique({
        where: {
          id: batchId,
        },
      });

    if (!batchRecord) {
      throw new EnrollmentError(
        "Selected batch does not exist."
      );
    }

    if (
      !batchRecord.courseId ||
      batchRecord.courseId !== courseId
    ) {
      throw new EnrollmentError(
        "Selected batch does not belong to the chosen course."
      );
    }

    if (
      isOneToOneBatch(
        batchRecord.name,
        batchRecord.code
      )
    ) {
      throw new EnrollmentError(
        "This is a personal 1-to-1 batch and cannot be selected. Please choose a group batch or enroll in 1-to-1 personal classes."
      );
    }

    /*
     * Validate that the selected currency has
     * a configured group fee.
     */
    const currency =
      resolveCurrency(
        countryCode || country
      );

    const groupFee =
      currency === "USD"
        ? Number(
            courseRecord.groupFeeUSD || 0
          )
        : Number(
            courseRecord.groupFeeINR || 0
          );

    if (
      !Number.isFinite(groupFee) ||
      groupFee <= 0
    ) {
      throw new EnrollmentError(
        currency === "USD"
          ? "Group USD pricing is not available for this course."
          : "Group classes are not available for this course."
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * PASSWORD
   * ---------------------------------------------------------
   */

  if (
    (options.requirePassword || password.length > 0) &&
    password.length < 6
  ) {
    throw new EnrollmentError(
      "Password must be at least 6 characters."
    );
  }

  /*
   * ---------------------------------------------------------
   * UNDER 18
   * ---------------------------------------------------------
   */

  if (isUnder18) {
    if (!guardianName) {
      throw new EnrollmentError(
        "Guardian name is required for students under 18."
      );
    }

    if (!emergencyContact) {
      throw new EnrollmentError(
        "Emergency contact is required for students under 18."
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * EXISTING USER
   *
   * Public enrollment:
   *   allowExistingUser = false
   *   => reject existing account
   *
   * Admin renewal:
   *   allowExistingUser = true
   *   => existing account allowed
   * ---------------------------------------------------------
   */

  const existingUser =
    await prisma.user.findFirst({
      where: {
        OR: [
          {
            email,
          },
          {
            phone: e164Phone,
          },
        ],
      },
    });

  if (
    existingUser &&
    !options.allowExistingUser
  ) {
    throw new EnrollmentError(
      "An account with this email or phone already exists. Please login.",
      409
    );
  }

  /*
   * ---------------------------------------------------------
   * BUILD PAYLOAD
   * ---------------------------------------------------------
   */

  const payload: EnrollmentPayload = {
    fullName,
    email,
    phone: e164Phone,
    country,
    countryCode,
    address,

    profileImage:
      body.profileImage
        ? String(body.profileImage).trim()
        : null,

    dob,

    gender,

    city,

    region,

    postalCode,

    skillLevel:
      body.skillLevel
        ? String(body.skillLevel).trim()
        : null,

    joiningDate:
      body.joiningDate
        ? String(body.joiningDate).trim()
        : new Date()
            .toISOString()
            .slice(0, 10),

    isUnder18,

    guardianName:
      guardianName || null,

    relationship:
      relationship || null,

    emergencyContact:
      emergencyContact || null,

    paymentMethod,

    showGstIncluded,

    billingLegalName: billingLegalName || null,

    billingGstin: billingGstin || null,

    courseId,

    batchId,

    enrollmentType,

    preferredDate:
      enrollmentType === "ONE_TO_ONE"
        ? preferredDate
        : null,

    preferredTime:
      enrollmentType === "ONE_TO_ONE"
        ? normalizeClassTime(
            preferredTime
          )
        : null,
  };

  /*
   * ---------------------------------------------------------
   * PASSWORD HASH
   * ---------------------------------------------------------
   */

  const passwordHash =
    password.length >= 6
      ? await bcrypt.hash(
          password,
          10
        )
      : "";

  return {
    payload,
    passwordHash,
    normalizedEmail: email,
    e164Phone,
  };
};

const loadCompletedByPayment = async (
  razorpayOrderId: string | null,
  razorpayPaymentId: string
): Promise<CompletedEnrollment | null> => {
  if (!razorpayPaymentId) {
    return null;
  }

  /*
   * Payment transactionId is the primary exact identifier.
   * OrderId is only an additional consistency check.
   *
   * Never recover an enrollment by:
   *   userId + latest enrollment
   *
   * because a student can have multiple enrollments/payments.
   */
  const payment = await prisma.payment.findUnique({
    where: {
      transactionId: razorpayPaymentId,
    },
    include: {
      user: true,
      enrollment: true,
    },
  });

  if (!payment?.user) {
    return null;
  }

  /*
   * If an order ID was supplied, it must match the payment's
   * stored order ID.
   *
   * This prevents a valid payment from being returned for
   * a different Razorpay order.
   */
  if (
    razorpayOrderId &&
    payment.orderId &&
    payment.orderId !== razorpayOrderId
  ) {
    return null;
  }

  /*
   * A completed payment must point to its exact enrollment.
   * Do NOT guess an enrollment from the user's latest record.
   */
  if (!payment.enrollment) {
    return null;
  }

  /*
   * Only a successful payment represents a completed enrollment.
   */
  if (payment.status !== PaymentStatus.SUCCESS) {
    return null;
  }

  return {
    user: publicUser(payment.user),
    enrollment: payment.enrollment,
    alreadyCompleted: true,
  };
};
const fulfillEnrollment = async (
  tx: Prisma.TransactionClient,
  pending: {
    id: string;
    passwordHash: string;
    payload: EnrollmentPayload;
  },
  razorpayOrderId: string | null,
  razorpayPaymentId: string
): Promise<CompletedEnrollment> => {
  const payload = pending.payload;

  let user =
    await tx.user.findFirst({
      where: {
        OR: [
          {
            email: payload.email,
          },
          {
            phone: payload.phone,
          },
        ],
      },
    });

  if (!user) {
    user = await tx.user.create({
      data: {
        fullName: payload.fullName,
        email: payload.email,
        phone: payload.phone,
        countryCode: payload.countryCode,
        passwordHash: pending.passwordHash,
        role: Role.STUDENT,
        avatarUrl: payload.profileImage || null,
        country: payload.country || "India",
        address: payload.address || null,
        dob: payload.dob
          ? new Date(payload.dob)
          : null,
        gender: payload.gender || null,
        city: payload.city || null,
        region: payload.region || null,
        postalCode: payload.postalCode || null,
        skillLevel: payload.skillLevel || null,
        joiningDate: payload.joiningDate
          ? new Date(payload.joiningDate)
          : null,
        isUnder18: Boolean(
          payload.isUnder18
        ),
        guardianName:
          payload.guardianName || null,
        relationship:
          payload.relationship || null,
        emergencyContact:
          payload.emergencyContact || null,
        paymentMethod:
          payload.paymentMethod || null,
        isActive: true,
      },
    });
  } else if (pending.passwordHash) {
    user = await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: pending.passwordHash },
    });
  }

  let enrollment =
    await tx.enrollment.findFirst({
      where: {
        userId: user.id,
        courseId: payload.courseId,
      },
    });

  const enrollmentType =
    parseEnrollmentType(
      payload.enrollmentType
    );

  const paymentModeRaw =
    String(
      (payload as Record<string, unknown>)
        .paymentMode || "MONTHLY"
    ).toUpperCase();

  const paymentMode =
    paymentModeRaw === "FULL_COURSE"
      ? "FULL_COURSE"
      : "MONTHLY";

const anyPayload =
  payload as Record<string, unknown>;

const requestedMonths = Number(
  anyPayload.months ?? 1
);

let monthsPaid: 1 | 3 | 6 | 12;

try {
  monthsPaid =
    validateEnrollmentMonths(
      requestedMonths
    );
} catch {
  throw new EnrollmentError(
    "Invalid payment plan. Allowed plans are 1, 3, 6, or 12 months.",
    400
  );
}

const operationTypeRaw = String(
  anyPayload.operationType ?? "NEW"
)
  .trim()
  .toUpperCase();

const operationType =
  operationTypeRaw === "RENEWAL"
    ? "RENEWAL"
    : "NEW";

let existingNextDueDate: Date | null =
  null;

if (!enrollment) {
  if (operationType === "RENEWAL") {
    throw new EnrollmentError(
      "No existing enrollment was found for this renewal.",
      409
    );
  }

  enrollment =
    await tx.enrollment.create({
      data: {
        userId: user.id,
        courseId: payload.courseId,
        mode: ClassMode.ONLINE,
        type: enrollmentType,
        active: true,
        paymentMode,
        monthsPaid,
      },
    });
} else {
  if (operationType === "NEW") {
    throw new EnrollmentError(
      "Student is already enrolled in this course. Please use renewal.",
      409
    );
  }

  existingNextDueDate =
    enrollment.nextDueDate;

  enrollment =
    await tx.enrollment.update({
      where: {
        id: enrollment.id,
      },
      data: {
        type: enrollmentType,
        active: true,
        paymentMode,
        monthsPaid:
          enrollment.monthsPaid +
          monthsPaid,
      },
    });
}

  const course =
    await tx.course.findUnique({
      where: {
        id: payload.courseId,
      },
    });

  if (!course) {
    throw new EnrollmentError(
      "Selected course does not exist.",
      404
    );
  }
  
  // const anyPayload = payload as Record<string, unknown>;

  // Use explicitly calculated amount and currency from backend payload
  // Fallback to legacy INR logic if missing (for older pending enrollments)
  let feePaid = Number(anyPayload.expectedAmount);
  let paymentCurrency = anyPayload.expectedCurrency as "INR" | "USD" | "GBP" | "EUR";
  
  const isLegacy = !feePaid || Number.isNaN(feePaid) || !paymentCurrency;
  
  if (isLegacy) {
    const monthlyFee =
      enrollmentType === "ONE_TO_ONE"
        ? course.oneToOneFeeINR || 0
        : course.groupFeeINR || 0;

    const joiningFee =
      course.joiningFeeINR ?? 1100;

    feePaid =
      enrollmentAmountINR(
        monthlyFee,
        joiningFee
      );
    paymentCurrency = "INR";
  }
  
  // Determine gateway based on payload or fallback to RAZORPAY
  const gateway = (anyPayload.gateway === "CASH" ? "CASH" : "RAZORPAY") as "CASH" | "RAZORPAY";

  const existingPayment =
    await tx.payment.findFirst({
      where: {
        OR: [
          razorpayOrderId ? { orderId: razorpayOrderId } : { transactionId: razorpayPaymentId },
          {
            transactionId:
              razorpayPaymentId,
          },
        ],
      },
    });

  const alreadyCompleted =
    Boolean(existingPayment);

  if (!existingPayment) {
    await tx.payment.create({
      data: {
        userId: user.id,
        enrollmentId: enrollment.id,
        amount: feePaid,
        currency: paymentCurrency,
        gateway: gateway,
        transactionId:
          razorpayPaymentId,
        orderId: razorpayOrderId || null,
        status: PaymentStatus.SUCCESS,
      },
    });
  } else if (
    !existingPayment.enrollmentId
  ) {
    await tx.payment.update({
      where: {
        id: existingPayment.id,
      },
      data: {
        enrollmentId: enrollment.id,
      },
    });
  }

  let assignedBatchId =
    payload.batchId;

  if (
    enrollmentType === "ONE_TO_ONE"
  ) {
    const oneToOneBatch =
      await createOneToOneBatch(
        tx,
        payload,
        course
      );

    assignedBatchId =
      oneToOneBatch.id;
  }

  if (assignedBatchId) {
    const membership =
      await tx.batchStudent.findUnique({
        where: {
          batchId_studentId: {
            batchId: assignedBatchId,
            studentId: user.id,
          },
        },
      });

    if (!membership) {
      await tx.batchStudent.create({
        data: {
          batchId: assignedBatchId,
          studentId: user.id,
        },
      });

      await tx.batch.update({
        where: {
          id: assignedBatchId,
        },
        data: {
          totalStudents: {
            increment: 1,
          },
        },
      });
    }
  }

  await tx.pendingEnrollment.update({
    where: {
      id: pending.id,
    },
    data: {
      status:
        PendingEnrollmentStatus.COMPLETED,
      userId: user.id,
      errorMessage: null,
    },
  });

  // Setup MonthlyDues inside the transaction
  const paymentDate = new Date(); // authoritative timestamp
  let coverageStartDate = paymentDate;
  if (existingNextDueDate && existingNextDueDate > paymentDate) {
    coverageStartDate = existingNextDueDate;
  }
  
  const isBulk = monthsPaid > 1;
  const monthlyBaseAmount = anyPayload.monthlyBaseAmount 
    ? Number(anyPayload.monthlyBaseAmount)
    : paymentCurrency === "USD" 
        ? (enrollmentType === "ONE_TO_ONE" ? (course.oneToOneFeeUSD || 0) : (course.groupFeeUSD || 0))
        : (enrollmentType === "ONE_TO_ONE" ? (course.oneToOneFeeINR || 0) : (course.groupFeeINR || 0));
  const currencyForDues = paymentCurrency;

  let nextDue: Date;

  if (isBulk) {
    const generatedMonths = generateCoverageMonths(
  coverageStartDate,
  monthsPaid
);
    
    // Create paid dues for the bulk period
    for (const dueMonth of generatedMonths) {
      const [yyyy, mm] = dueMonth.split("-").map(Number);
      const dueDate = new Date(yyyy, mm - 1, 1);
      
      const existingDue = await tx.monthlyDue.findUnique({
        where: { enrollmentId_dueMonth: { enrollmentId: enrollment.id, dueMonth } }
      });
      
      if (existingDue) {
        await tx.monthlyDue.update({
          where: { id: existingDue.id },
          data: { status: "SUCCESS", paidAt: paymentDate, amount: monthlyBaseAmount, currency: currencyForDues }
        });
      } else {
        await tx.monthlyDue.create({
          data: {
            enrollmentId: enrollment.id,
            userId: user.id,
            courseId: course.id,
            dueMonth,
            dueDate,
            amount: monthlyBaseAmount,
            currency: currencyForDues,
            status: "SUCCESS",
            paidAt: paymentDate,
          }
        });
      }
    }
    
    // Create pending due for the next month after bulk
    nextDue = nextCoverageDueDate(coverageStartDate, monthsPaid);
    const mm = String(nextDue.getMonth() + 1).padStart(2, "0");
    const nextDueMonth = `${nextDue.getFullYear()}-${mm}`;
    
    const existingNext = await tx.monthlyDue.findUnique({
      where: { enrollmentId_dueMonth: { enrollmentId: enrollment.id, dueMonth: nextDueMonth } }
    });
    
    if (existingNext) {
      await tx.monthlyDue.update({
        where: { id: existingNext.id },
        data: { amount: monthlyBaseAmount, currency: currencyForDues }
      });
    } else {
      await tx.monthlyDue.create({
        data: {
          enrollmentId: enrollment.id,
          userId: user.id,
          courseId: course.id,
          dueMonth: nextDueMonth,
          dueDate: nextDue,
          amount: monthlyBaseAmount,
          currency: currencyForDues,
          status: "PENDING",
        }
      });
    }
  } else {
    // Single month
    const generatedMonths = generateCoverageMonths(
      coverageStartDate,
      1
    );
    const currentMonth = generatedMonths[0];
    const [yyyy, mm] = currentMonth.split("-").map(Number);
    const currentDueDate = new Date(yyyy, mm - 1, 1);

    const existingCurrent = await tx.monthlyDue.findUnique({
      where: { enrollmentId_dueMonth: { enrollmentId: enrollment.id, dueMonth: currentMonth } }
    });
    
    if (existingCurrent) {
      await tx.monthlyDue.update({
        where: { id: existingCurrent.id },
        data: { status: "SUCCESS", paidAt: paymentDate, amount: monthlyBaseAmount, currency: currencyForDues }
      });
    } else {
      await tx.monthlyDue.create({
        data: {
          enrollmentId: enrollment.id,
          userId: user.id,
          courseId: course.id,
          dueMonth: currentMonth,
          dueDate: currentDueDate,
          amount: monthlyBaseAmount,
          currency: currencyForDues,
          status: "SUCCESS",
          paidAt: paymentDate,
        }
      });
    }
    
    nextDue = nextCoverageDueDate(coverageStartDate, 1);
    const nextMm = String(nextDue.getMonth() + 1).padStart(2, "0");
    const nextDueMonth = `${nextDue.getFullYear()}-${nextMm}`;
    
    const existingNext = await tx.monthlyDue.findUnique({
      where: { enrollmentId_dueMonth: { enrollmentId: enrollment.id, dueMonth: nextDueMonth } }
    });
    
    if (existingNext) {
      await tx.monthlyDue.update({
        where: { id: existingNext.id },
        data: { amount: monthlyBaseAmount, currency: currencyForDues }
      });
    } else {
      await tx.monthlyDue.create({
        data: {
          enrollmentId: enrollment.id,
          userId: user.id,
          courseId: course.id,
          dueMonth: nextDueMonth,
          dueDate: nextDue,
          amount: monthlyBaseAmount,
          currency: currencyForDues,
          status: "PENDING",
        }
      });
    }
  }

  // Update enrollment nextDueDate
  enrollment = await tx.enrollment.update({
    where: { id: enrollment.id },
    data: { nextDueDate: nextDue }
  });

  const paymentRecord = await tx.payment.findFirst({
    where: {
      OR: [
        razorpayOrderId ? { orderId: razorpayOrderId } : { transactionId: razorpayPaymentId },
        { transactionId: razorpayPaymentId }
      ]
    }
  });

  if (paymentRecord) {
    const { calculateGstFromInclusiveTotal, getInvoiceSacCode, getInvoiceSacDescription } = require("../../lib/gst");
    const anyPayload = payload as any;
    const gstDetails = calculateGstFromInclusiveTotal(feePaid, anyPayload.region);

    const currentYear = new Date().getFullYear();
    const counter = await tx.invoiceCounter.upsert({
      where: { year: currentYear },
      update: { current: { increment: 1 } },
      create: { year: currentYear, current: 1 }
    });

    const prefix = (process.env.INVOICE_PREFIX || "KATHAK").trim().replace(/-+$/, "");
    const invNumber = `${prefix}-${currentYear}-${String(counter.current).padStart(6, "0")}`;

    const batch = assignedBatchId ? await tx.batch.findUnique({ where: { id: assignedBatchId } }) : null;
    const batchName = batch ? batch.name : "1-to-1 Session";

    const { BUSINESS_DETAILS } = require("../../lib/businessConfig");
    
    const snapshot = {
      academyName: BUSINESS_DETAILS.tradeName || process.env.ACADEMY_NAME || "",
      legalName: BUSINESS_DETAILS.legalName || "",
      academyEmail: process.env.ACADEMY_CONTACT_EMAIL || "",
      academyPhone: process.env.ACADEMY_CONTACT_PHONE || "",
      academyAddress: BUSINESS_DETAILS.address || process.env.ACADEMY_ADDRESS || "",
      academyState: BUSINESS_DETAILS.state || process.env.ACADEMY_STATE || "",
      academyGstin: BUSINESS_DETAILS.gstin || process.env.ACADEMY_GSTIN || "",
      udyamRegistration: BUSINESS_DETAILS.udyamRegistration || "",
      authorizedSignatory: BUSINESS_DETAILS.authorizedSignatory || "",
      sacCode: getInvoiceSacCode(),
      sacDescription: getInvoiceSacDescription(),
      gstDetails,
      studentName: user.fullName,
      studentEmail: user.email,
      studentPhone: user.phone,
      studentState: anyPayload.region || "",
      showGstIncluded: anyPayload.showGstIncluded === true,
      billingLegalName: anyPayload.billingLegalName || "",
      billingGstin: anyPayload.billingGstin || "",
      courseTitle: course.title,
      batchName: batchName,
      months: anyPayload.months || 1,
      monthlyBaseAmount: anyPayload.monthlyBaseAmount || 0,
      joiningFeeApplied: anyPayload.joiningFeeApplied || 0,
      discountAmount: anyPayload.discountAmount || 0,
      paymentMode: anyPayload.paymentMode || paymentRecord.gateway || "ONLINE"
    };

    await tx.invoice.upsert({
      where: { paymentId: paymentRecord.id },
      update: {},
      create: {
        invoiceNumber: invNumber,
        paymentId: paymentRecord.id,
        enrollmentId: enrollment.id,
        userId: user.id,
        amount: feePaid,
        currency: paymentCurrency,
        status: "PAID",
        snapshot: snapshot as any
      }
    });
  }

  return {
    user: publicUser(user),
    enrollment,
    alreadyCompleted,
  };
};

export const completePendingEnrollment = async (
  params: {
    pendingId?: string;
    razorpayOrderId: string | null;
    razorpayPaymentId: string;
  }
): Promise<CompletedEnrollment> => {
  const {
    pendingId,
    razorpayOrderId,
    razorpayPaymentId,
  } = params;

  if (!razorpayPaymentId) {
    throw new EnrollmentError(
      "Payment verification failed. Missing payment details."
    );
  }

  if (!pendingId && !razorpayOrderId) {
    throw new EnrollmentError(
      "Payment verification failed. Missing pendingId and orderId."
    );
  }

  const pending = pendingId
    ? await prisma.pendingEnrollment.findUnique({
        where: {
          id: pendingId,
        },
      })
    : await prisma.pendingEnrollment.findUnique({
        where: {
          razorpayOrderId: razorpayOrderId as string,
        },
      });

  if (!pending) {
    const alreadyPaid = await loadCompletedByPayment(
      razorpayOrderId,
      razorpayPaymentId
    );

    if (alreadyPaid) {
      return alreadyPaid;
    }

    throw new EnrollmentError(
      "No matching enrollment was found for this payment.",
      404
    );
  }

  /*
   * The Razorpay order, when present, must belong to this
   * pending enrollment.
   */
  if (
    pending.razorpayOrderId &&
    pending.razorpayOrderId !== razorpayOrderId
  ) {
    throw new EnrollmentError(
      "Payment order does not match this enrollment."
    );
  }

  /*
   * If this pending enrollment has already been completed,
   * recover ONLY the payment belonging to this exact payment ID.
   *
   * Do not fall back to the user's latest enrollment because
   * that can return the wrong enrollment.
   */
  if (pending.status === PendingEnrollmentStatus.COMPLETED) {
    const alreadyPaid = await loadCompletedByPayment(
      razorpayOrderId,
      razorpayPaymentId
    );

    if (alreadyPaid) {
      return alreadyPaid;
    }

    throw new EnrollmentError(
      "This enrollment was already completed, but the matching payment record could not be recovered.",
      409
    );
  }

  /*
   * A previous attempt may have left the record in PROCESSING
   * or FAILED. The same payment/idempotency attempt is allowed
   * to resume; Payment.transactionId remains the database-level
   * duplicate protection.
   */
  if (
    pending.status === PendingEnrollmentStatus.PENDING ||
    pending.status === PendingEnrollmentStatus.FAILED
  ) {
    await prisma.pendingEnrollment.updateMany({
      where: {
        id: pending.id,
        status: {
          in: [
            PendingEnrollmentStatus.PENDING,
            PendingEnrollmentStatus.FAILED,
          ],
        },
      },
      data: {
        status: PendingEnrollmentStatus.PROCESSING,
        errorMessage: null,
      },
    });
  }

  try {
    const result = await prisma.$transaction(
      (tx) =>
        fulfillEnrollment(
          tx,
          {
            id: pending.id,
            passwordHash: pending.passwordHash,
            payload: asPayload(pending.payload),
          },
          razorpayOrderId,
          razorpayPaymentId
        ),
      {
        isolationLevel: "Serializable",
      }
    );

    return result;
  } catch (error) {
    /*
     * If another concurrent request completed the same payment,
     * recover using the exact Razorpay payment/order identifiers.
     *
     * Do NOT recover by "latest enrollment".
     */
    if (
      isPrismaUniqueError(error, "transactionId") ||
      isPrismaUniqueError(error, "orderId")
    ) {
      const recovered = await loadCompletedByPayment(
        razorpayOrderId,
        razorpayPaymentId
      );

      if (recovered) {
        return recovered;
      }
    }

    /*
     * If fulfillEnrollment failed, mark this pending attempt
     * as FAILED so the same idempotent request can be retried.
     *
     * Never overwrite COMPLETED if another concurrent request
     * managed to finish it between the transaction failure and
     * this update.
     */
    try {
      await prisma.pendingEnrollment.updateMany({
        where: {
          id: pending.id,
          status: PendingEnrollmentStatus.PROCESSING,
        },
        data: {
          status: PendingEnrollmentStatus.FAILED,
          errorMessage:
            error instanceof EnrollmentError
              ? error.message
              : "Enrollment finalization failed.",
        },
      });
    } catch {
      /*
       * Failure to update the diagnostic state must not hide
       * the original enrollment error.
       */
    }

    if (error instanceof EnrollmentError) {
      throw error;
    }

    throw new EnrollmentError(
      "Enrollment failed after payment. Please contact support with your payment ID.",
      500
    );
  }
};

export const sendEnrollmentWelcomeEmail =
  async (
    user: {
      id: string;
      fullName: string;
      email: string;
      phone?: string | null;
      address?: string | null;
    },
    plaintextPassword?: string
  ): Promise<boolean> => {
    try {
      const payment =
        await prisma.payment.findFirst({
          where: {
            userId: user.id,
          },
          orderBy: {
            createdAt: "desc",
          },
          include: {
            Invoice: true,
            enrollment: {
              include: {
                course: true,
              },
            },
          },
        });

      const membership =
        await prisma.batchStudent.findFirst({
          where: {
            studentId: user.id,
          },
          include: {
            batch: true,
          },
        });

      const invoice: InvoiceData | null =
        payment && payment.Invoice
          ? {
              invoiceNumber: payment.Invoice.invoiceNumber,
              issuedAt: payment.createdAt,
              studentName: user.fullName,
              studentEmail: user.email,
              studentPhone: user.phone || "",
              studentAddress: user.address,
              courseTitle: payment.enrollment?.course?.title || "Kathak Course Enrollment",
              batchName: membership?.batch?.name || membership?.batch?.code || null,
              amount: payment.amount,
              currency: String(payment.currency || "INR"),
              gateway: payment.gateway,
              paymentMethod: payment.gateway,
              transactionId: payment.transactionId,
              orderId: payment.orderId,
              status: payment.status,
              snapshot: payment.Invoice.snapshot,
            }
          : null;

      let attachments:
        | { filename: string; content: Buffer; contentType: string }[]
        | undefined;

      if (invoice) {
        try {
          attachments = [{
            filename: `${invoice.invoiceNumber}.pdf`,
            content: await generatePdfBuffer(buildStudentPaymentReceiptHtml(invoice)),
            contentType: "application/pdf",
          }];
        } catch (pdfError) {
          // A receipt PDF must never prevent a successful enrollment from
          // notifying the student. The committed invoice remains available.
          console.error(`[PDF_GENERATION_FAILURE] Failed to generate receipt PDF for invoice ${invoice.invoiceNumber} (User: ${user.email}):`, pdfError);
        }
      }

      return await sendEmail({
        to: user.email,

        subject: invoice
          ? "Welcome to Kathak Academy — Enrollment & Payment Receipt"
          : "Welcome to Kathak Academy!",

        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #900C27; text-align: center;">
              Welcome to Kathak Academy
            </h2>

            <p>Hi ${user.fullName},</p>

            <p>
              Thank you for registering with us!
              Your enrollment and payment have been successfully processed.
            </p>

            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1B1B24;">
                Your Login Details
              </h3>

              <p>
                <strong>Login URL:</strong>
                <a href="${env.frontendUrl}/login">
                  ${env.frontendUrl}/login
                </a>
              </p>

              <p>
                <strong>Email:</strong>
                ${user.email}
              </p>

              ${
                plaintextPassword
                  ? `<p><strong>Password:</strong> ${plaintextPassword}</p>`
                  : `<p>Use the portal password you created during enrollment to sign in.</p>`
              }
            </div>

            ${
              invoice
                ? buildInvoiceEmailBlock(
                    invoice
                  )
                : ""
            }

            <p>
              You can log in anytime to view your classes,
              assignments, and payments.
              ${attachments ? "A copy of your payment receipt is attached." : "Your payment receipt is available in your student portal."}
            </p>

            <br/>

            <p>Warm Regards,</p>

            <p>
              <strong>Kathak Academy Team</strong>
            </p>
          </div>
        `,

        attachments,
      });
    } catch (emailErr) {
      console.error(
        `[WELCOME_EMAIL_FAILURE] Failed to send registration welcome email to ${user.email}:`,
        emailErr
      );
      return false;
    }
  };

/* =========================================================
   INITIATE ENROLLMENT UPGRADE
   ========================================================= */

export async function initiateEnrollmentUpgrade(
  userId: string,
  params: {
    targetCourseId: string;
    targetType: string;
    targetBatchId?: string;
    months?: number;
    preferredDate?: string;
    preferredTime?: string;
    currency?: "INR" | "USD";
  }
) {
  const {
    targetCourseId,
    targetType,
    targetBatchId,
  } = params;

  const months =
    Number(params.months ?? 1);

  const normalizedCurrency =
    String(params.currency ?? "INR")
      .trim()
      .toUpperCase();

  if (
    normalizedCurrency !== "INR" &&
    normalizedCurrency !== "USD"
  ) {
    throw new EnrollmentError(
      "Invalid payment currency.",
      400
    );
  }

  /* -------------------------------------------------------
     Validate duration
     ------------------------------------------------------- */

  if (
    !Number.isInteger(months) ||
    !VALID_UPGRADE_DURATIONS.includes(
      months
    )
  ) {
    throw new EnrollmentError(
      "Please select a valid duration: 1, 6, or 12 months.",
      400
    );
  }

  /* -------------------------------------------------------
     Normalize target type
     ------------------------------------------------------- */

  const normalizedTargetType =
    String(targetType)
      .trim()
      .toUpperCase()
      .replace(/[\s_-]+/g, "_");

  if (
    normalizedTargetType !== "GROUP" &&
    normalizedTargetType !== "ONE_TO_ONE"
  ) {
    throw new EnrollmentError(
      "Invalid target course type.",
      400
    );
  }

  /* -------------------------------------------------------
     Find current active enrollment
     ------------------------------------------------------- */

  const currentEnrollment =
    await prisma.enrollment.findFirst({
      where: {
        userId,
        active: true,
      },
      include: {
        course: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  if (!currentEnrollment) {
    throw new EnrollmentError(
      "No active enrollment found to upgrade.",
      400
    );
  }

  /* -------------------------------------------------------
     Find target course
     ------------------------------------------------------- */

  const targetCourse =
    await prisma.course.findUnique({
      where: {
        id: targetCourseId,
      },
    });

  if (!targetCourse) {
    throw new EnrollmentError(
      "Target course not found.",
      400
    );
  }

  /* -------------------------------------------------------
     Prevent same course + same type
     ------------------------------------------------------- */

  if (
    currentEnrollment.courseId ===
      targetCourseId &&
    currentEnrollment.type ===
      normalizedTargetType
  ) {
    throw new EnrollmentError(
      "You are already enrolled in this course and type.",
      400
    );
  }

  /* -------------------------------------------------------
     Validate fixed course duration

     0 = ongoing/unlimited
     ------------------------------------------------------- */

  const courseDurationMonths =
    Number(
      targetCourse.courseDurationMonths ??
        0
    );

  if (
    courseDurationMonths > 0 &&
    months > courseDurationMonths
  ) {
    throw new EnrollmentError(
      `This course has a maximum duration of ${courseDurationMonths} month${
        courseDurationMonths === 1
          ? ""
          : "s"
      }. Please select a shorter payment duration.`,
      400
    );
  }

  /* -------------------------------------------------------
     1-to-1 preferred schedule
     ------------------------------------------------------- */

  let preferredDate = "";
  let preferredTime = "";

  if (
    normalizedTargetType ===
    "ONE_TO_ONE"
  ) {
    if (
      !params.preferredDate ||
      !ISO_DATE_REGEX.test(
        params.preferredDate
      )
    ) {
      throw new EnrollmentError(
        "Please choose a date for your 1-to-1 class.",
        400
      );
    }

    if (
      params.preferredDate <
      todayIsoDate()
    ) {
      throw new EnrollmentError(
        "Please choose a date that is today or later.",
        400
      );
    }

    preferredDate =
      params.preferredDate;

    preferredTime =
      normalizeClassTime(
        String(
          params.preferredTime || ""
        )
      );
  }

  /* -------------------------------------------------------
     Determine monthly fee

     Currency is academy configured:
     INR -> INR fields
     USD -> USD fields
     ------------------------------------------------------- */

  let monthlyFee: number;

  if (
    normalizedCurrency === "USD"
  ) {
    monthlyFee =
      normalizedTargetType ===
      "ONE_TO_ONE"
        ? Number(
            targetCourse.oneToOneFeeUSD ??
              0
          )
        : Number(
            targetCourse.groupFeeUSD ??
              0
          );
  } else {
    monthlyFee =
      normalizedTargetType ===
      "ONE_TO_ONE"
        ? Number(
            targetCourse.oneToOneFeeINR ??
              0
          )
        : Number(
            targetCourse.groupFeeINR ??
              0
          );
  }

  if (
    !Number.isFinite(monthlyFee) ||
    monthlyFee <= 0
  ) {
    throw new EnrollmentError(
      normalizedCurrency === "USD"
        ? normalizedTargetType ===
          "ONE_TO_ONE"
          ? "One-to-one USD pricing is not available for this course."
          : "Group USD pricing is not available for this course."
        : normalizedTargetType ===
          "ONE_TO_ONE"
        ? "One-to-one pricing is not available for this course."
        : "Group classes are not available for this course.",
      400
    );
  }

  /* -------------------------------------------------------
     Calculate upgrade price

     IMPORTANT:
     No joining fee on upgrade.
     ------------------------------------------------------- */

  const pricing =
    calculateUpgradeFee(
      monthlyFee,
      months,
      targetCourse.bulkDiscountTiers
    );

  const finalAmount =
    pricing.finalAmount;

  if (
    !Number.isFinite(finalAmount) ||
    finalAmount <= 0
  ) {
    throw new EnrollmentError(
      "Unable to calculate the upgrade amount.",
      500
    );
  }

  /* -------------------------------------------------------
     Razorpay
     ------------------------------------------------------- */

  const razorpay =
    getRazorpay();

  if (!razorpay) {
    throw new EnrollmentError(
      "Payment is temporarily unavailable. Please try again later.",
      500
    );
  }

  /* -------------------------------------------------------
     Create Razorpay order
     ------------------------------------------------------- */

  const razorpayOrder =
    await razorpay.orders.create({
      amount:
        Math.round(
          finalAmount * 100
        ),

      currency:
        normalizedCurrency,

      receipt:
        `upgrade_${currentEnrollment.id.slice(
          0,
          20
        )}`,

      notes: {
        userId,

        currentEnrollmentId:
          currentEnrollment.id,

        targetCourseId,

        targetType:
          normalizedTargetType,

        months:
          String(months),

        currency:
          normalizedCurrency,

        monthlyFee:
          String(
            pricing.monthlyFee
          ),

        subtotal:
          String(
            pricing.subtotal
          ),

        discountPercent:
          String(
            pricing.discountPercent
          ),

        discountAmount:
          String(
            pricing.discountAmount
          ),

        finalAmount:
          String(
            pricing.finalAmount
          ),
      },
    });

  /* -------------------------------------------------------
     Create pending upgrade
     ------------------------------------------------------- */

  const pendingUpgrade =
    await prisma.pendingUpgrade.create({
      data: {
        userId,

        currentEnrollmentId:
          currentEnrollment.id,

        targetCourseId,

        targetType:
          normalizedTargetType,

        targetBatchId:
          targetBatchId || null,

        months,

        preferredDate:
          preferredDate || null,

        preferredTime:
          preferredTime || null,

        razorpayOrderId:
          razorpayOrder.id,
      },
    });

  /* -------------------------------------------------------
     Return payment details
     ------------------------------------------------------- */

  return {
    pendingUpgradeId:
      pendingUpgrade.id,

    razorpayOrderId:
      razorpayOrder.id,

    amount:
      finalAmount,

    currency:
      normalizedCurrency,

    pricing: {
      currency:
        normalizedCurrency,

      monthlyFee:
        pricing.monthlyFee,

      months:
        pricing.months,

      subtotal:
        pricing.subtotal,

      discountPercent:
        pricing.discountPercent,

      discountAmount:
        pricing.discountAmount,

      finalAmount:
        pricing.finalAmount,
    },
  };
}

/* =========================================================
   COMPLETE ENROLLMENT UPGRADE
   ========================================================= */

export async function completeEnrollmentUpgrade(
  params: {
    pendingUpgradeId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    currency?: "INR" | "USD";
  }
) {
  const {
    pendingUpgradeId,
    razorpayOrderId,
    razorpayPaymentId,
    currency = "INR",
  } = params;

  const normalizedCurrency =
    String(currency)
      .trim()
      .toUpperCase() as
      | "INR"
      | "USD";

  if (
    normalizedCurrency !== "INR" &&
    normalizedCurrency !== "USD"
  ) {
    throw new EnrollmentError(
      "Invalid payment currency.",
      400
    );
  }

  /* -------------------------------------------------------
     Find pending upgrade
     ------------------------------------------------------- */

  const pending =
    await prisma.pendingUpgrade.findUnique({
      where: {
        id: pendingUpgradeId,
      },
    });

  if (!pending) {
    throw new EnrollmentError(
      "Upgrade request not found.",
      400
    );
  }

  /* -------------------------------------------------------
     Verify Razorpay order
     ------------------------------------------------------- */

  if (
    pending.razorpayOrderId !==
    razorpayOrderId
  ) {
    throw new EnrollmentError(
      "Order mismatch.",
      400
    );
  }

  /* -------------------------------------------------------
     Idempotency
     ------------------------------------------------------- */

  if (
    pending.status === "COMPLETED"
  ) {
    const enrollment =
      await prisma.enrollment.findFirst({
        where: {
          previousEnrollmentId:
            pending.currentEnrollmentId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    return {
      alreadyCompleted: true,
      enrollment,
    };
  }

  /* -------------------------------------------------------
     Validate duration
     ------------------------------------------------------- */

  const months =
    Number(
      pending.months ?? 1
    );

  if (
    !Number.isInteger(months) ||
    !VALID_UPGRADE_DURATIONS.includes(
      months
    )
  ) {
    throw new EnrollmentError(
      "Invalid upgrade duration.",
      400
    );
  }

  /* -------------------------------------------------------
     Find target course
     ------------------------------------------------------- */

  const targetCourse =
    await prisma.course.findUnique({
      where: {
        id: pending.targetCourseId,
      },
    });

  if (!targetCourse) {
    throw new EnrollmentError(
      "Target course not found.",
      404
    );
  }

  /* -------------------------------------------------------
     Normalize target type
     ------------------------------------------------------- */

  const targetType =
    String(
      pending.targetType
    )
      .trim()
      .toUpperCase()
      .replace(/[\s_-]+/g, "_");

  if (
    targetType !== "GROUP" &&
    targetType !== "ONE_TO_ONE"
  ) {
    throw new EnrollmentError(
      "Invalid target enrollment type.",
      400
    );
  }

  /* -------------------------------------------------------
     Validate fixed course duration
     ------------------------------------------------------- */

  const courseDurationMonths =
    Number(
      targetCourse.courseDurationMonths ??
        0
    );

  if (
    courseDurationMonths > 0 &&
    months > courseDurationMonths
  ) {
    throw new EnrollmentError(
      `The selected duration exceeds this course's maximum duration of ${courseDurationMonths} month${
        courseDurationMonths === 1
          ? ""
          : "s"
      }.`,
      400
    );
  }

  /* -------------------------------------------------------
     Validate 1-to-1 schedule
     ------------------------------------------------------- */

  if (
    targetType === "ONE_TO_ONE"
  ) {
    if (
      !pending.preferredDate ||
      !ISO_DATE_REGEX.test(
        pending.preferredDate
      )
    ) {
      throw new EnrollmentError(
        "Please choose a date for your 1-to-1 class.",
        400
      );
    }

    if (
      pending.preferredDate <
      todayIsoDate()
    ) {
      throw new EnrollmentError(
        "Please choose a date that is today or later.",
        400
      );
    }

    normalizeClassTime(
      String(
        pending.preferredTime || ""
      )
    );
  }

  /* -------------------------------------------------------
     Determine monthly fee based on currency
     ------------------------------------------------------- */

  let monthlyFee: number;

  if (
    normalizedCurrency === "USD"
  ) {
    monthlyFee =
      targetType === "ONE_TO_ONE"
        ? Number(
            targetCourse.oneToOneFeeUSD ??
              0
          )
        : Number(
            targetCourse.groupFeeUSD ??
              0
          );
  } else {
    monthlyFee =
      targetType === "ONE_TO_ONE"
        ? Number(
            targetCourse.oneToOneFeeINR ??
              0
          )
        : Number(
            targetCourse.groupFeeINR ??
              0
          );
  }

  if (
    !Number.isFinite(monthlyFee) ||
    monthlyFee <= 0
  ) {
    throw new EnrollmentError(
      normalizedCurrency === "USD"
        ? targetType === "ONE_TO_ONE"
          ? "One-to-one USD pricing is not available for this course."
          : "Group USD pricing is not available for this course."
        : targetType === "ONE_TO_ONE"
        ? "One-to-one pricing is not available for this course."
        : "Group classes are not available for this course.",
      400
    );
  }

  /* -------------------------------------------------------
     Calculate exact upgrade price

     No joining fee.
     ------------------------------------------------------- */

  const pricing =
    calculateUpgradeFee(
      monthlyFee,
      months,
      targetCourse.bulkDiscountTiers
    );

  const finalAmount =
    pricing.finalAmount;

  if (
    !Number.isFinite(finalAmount) ||
    finalAmount <= 0
  ) {
    throw new EnrollmentError(
      "Unable to calculate the upgrade amount.",
      500
    );
  }

  /* -------------------------------------------------------
     Transaction
     ------------------------------------------------------- */

  const newEnrollment =
    await prisma.$transaction(
      async (tx) => {
        /* -------------------------------------------------
           Verify student
           ------------------------------------------------- */

        const upgradingUser =
          await tx.user.findUnique({
            where: {
              id: pending.userId,
            },
          });

        if (!upgradingUser) {
          throw new EnrollmentError(
            "Student not found.",
            404
          );
        }

        /* -------------------------------------------------
           Verify current enrollment
           ------------------------------------------------- */

        const currentEnrollment =
          await tx.enrollment.findUnique({
            where: {
              id:
                pending.currentEnrollmentId,
            },
          });

        if (!currentEnrollment) {
          throw new EnrollmentError(
            "Current enrollment not found.",
            400
          );
        }

        /* -------------------------------------------------
           Collect ALL old memberships
           before deleting
           ------------------------------------------------- */

        const oldMemberships =
          await tx.batchStudent.findMany({
            where: {
              studentId:
                pending.userId,
            },
            select: {
              batchId: true,
            },
          });

        /* -------------------------------------------------
           Remove old memberships
           ------------------------------------------------- */

        if (
          oldMemberships.length > 0
        ) {
          await tx.batchStudent.deleteMany({
            where: {
              studentId:
                pending.userId,
            },
          });

          /* -----------------------------------------------
             Decrement old batch student counts
             ----------------------------------------------- */

          for (
            const membership of oldMemberships
          ) {
            await tx.batch.update({
              where: {
                id:
                  membership.batchId,
              },
              data: {
                totalStudents: {
                  decrement: 1,
                },
              },
            });
          }
        }

        /* -------------------------------------------------
           Deactivate current enrollment
           ------------------------------------------------- */

        await tx.enrollment.update({
          where: {
            id:
              pending.currentEnrollmentId,
          },
          data: {
            active: false,
            expiresAt: new Date(),
          },
        });

        /* -------------------------------------------------
           Create new active enrollment

           Both GROUP and ONE_TO_ONE
           are monthly plans.
           ------------------------------------------------- */

        const enrollment =
          await tx.enrollment.create({
            data: {
              userId:
                pending.userId,

              courseId:
                pending.targetCourseId,

              mode:
                ClassMode.ONLINE,

              type:
                targetType,

              active:
                true,

              previousEnrollmentId:
                pending.currentEnrollmentId,

              paymentMode:
                "MONTHLY",

              monthsPaid:
                months,
            },
          });

        /* -------------------------------------------------
           Determine target batch
           ------------------------------------------------- */

        let assignedBatchId =
          pending.targetBatchId ||
          null;

        /* -------------------------------------------------
           ONE-TO-ONE

           Always create dedicated batch.
           ------------------------------------------------- */

        if (
          targetType ===
          "ONE_TO_ONE"
        ) {
          if (
            !pending.preferredDate ||
            !pending.preferredTime
          ) {
            throw new EnrollmentError(
              "1-to-1 class date and time are required.",
              400
            );
          }

          const teacher =
            await findDefaultOneToOneTeacher(
              tx
            );

          if (!teacher) {
            throw new EnrollmentError(
              "No teacher is available to assign this 1-to-1 batch. Please contact the academy.",
              500
            );
          }

          const weekday =
            weekdayFromIsoDate(
              pending.preferredDate
            );

          const studentFirstName =
            upgradingUser.fullName
              .trim()
              .split(/\s+/)[0] ||
            "Student";

          const batchCode =
            `OTO-UPG-${Date.now()
              .toString(36)
              .toUpperCase()}${Math.random()
              .toString(36)
              .slice(2, 5)
              .toUpperCase()}`;

          const oneToOneBatch =
            await tx.batch.create({
              data: {
                name:
                  `1-to-1 · ${targetCourse.title} · ${studentFirstName}`,

                code:
                  batchCode,

                courseId:
                  targetCourse.id,

                courseName:
                  targetCourse.title,

                teacherId:
                  teacher.id,

                teacherName:
                  teacher.fullName,

                schedule:
                  `${weekday}|${pending.preferredTime}|${pending.preferredDate}|`,

                level:
                  batchLevelFromCourse(
                    targetCourse.category
                  ),

                status:
                  "Active",

                totalStudents:
                  0,
              },
            });

          assignedBatchId =
            oneToOneBatch.id;
        }

        /* -------------------------------------------------
           GROUP

           Validate selected target batch.
           ------------------------------------------------- */

        if (
          targetType ===
          "GROUP"
        ) {
          if (!assignedBatchId) {
            throw new EnrollmentError(
              "Please select a target batch.",
              400
            );
          }

          const targetBatch =
            await tx.batch.findUnique({
              where: {
                id:
                  assignedBatchId,
              },
            });

          if (!targetBatch) {
            throw new EnrollmentError(
              "Target batch not found.",
              400
            );
          }

          if (
            targetBatch.courseId !==
            targetCourse.id
          ) {
            throw new EnrollmentError(
              "Target batch does not belong to the selected course.",
              400
            );
          }

          if (
            isOneToOneBatch(
              targetBatch.name,
              targetBatch.code
            )
          ) {
            throw new EnrollmentError(
              "A 1-to-1 batch cannot be selected for group enrollment.",
              400
            );
          }
        }

        /* -------------------------------------------------
           Assign student to new batch
           ------------------------------------------------- */

        if (assignedBatchId) {
          const existingMembership =
            await tx.batchStudent.findUnique({
              where: {
                batchId_studentId: {
                  batchId:
                    assignedBatchId,

                  studentId:
                    pending.userId,
                },
              },
            });

          if (!existingMembership) {
            await tx.batchStudent.create({
              data: {
                batchId:
                  assignedBatchId,

                studentId:
                  pending.userId,
              },
            });

            await tx.batch.update({
              where: {
                id:
                  assignedBatchId,
              },
              data: {
                totalStudents: {
                  increment: 1,
                },
              },
            });
          }
        }

        /* -------------------------------------------------
           Create successful payment

           No joining fee.
           Store actual currency.
           ------------------------------------------------- */

        await tx.payment.create({
          data: {
            userId:
              pending.userId,

            enrollmentId:
              enrollment.id,

            amount:
              finalAmount,

            currency:
              normalizedCurrency,

            gateway:
              "RAZORPAY",

            transactionId:
              razorpayPaymentId,

            orderId:
              razorpayOrderId,

            status:
              PaymentStatus.SUCCESS,
          },
        });

        /* -------------------------------------------------
           Mark upgrade completed
           ------------------------------------------------- */

        await tx.pendingUpgrade.update({
          where: {
            id:
              pending.id,
          },
          data: {
            status:
              PendingEnrollmentStatus.COMPLETED,
          },
        });

        return enrollment;
      }
    );

  /* -------------------------------------------------------
     Return
     ------------------------------------------------------- */

  return {
    alreadyCompleted: false,

    enrollment:
      newEnrollment,

    pricing: {
      currency:
        normalizedCurrency,

      monthlyFee:
        pricing.monthlyFee,

      months:
        pricing.months,

      subtotal:
        pricing.subtotal,

      discountPercent:
        pricing.discountPercent,

      discountAmount:
        pricing.discountAmount,

      finalAmount:
        pricing.finalAmount,
    },
  };
}
