import { ClassMode, PaymentStatus, PendingEnrollmentStatus, Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { sendEmail } from "../../lib/mailer";
import { buildInvoiceEmailBlock, buildInvoiceHtml, InvoiceData } from "../../lib/invoice";
import { enrollmentAmountINR } from "../../lib/fees";
import { isOneToOneBatch } from "../../lib/batchHelpers";

export class EnrollmentError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "EnrollmentError";
    this.statusCode = statusCode;
  }
}

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
  };
  alreadyCompleted: boolean;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIME_12_REGEX = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const parseEnrollmentType = (value: unknown): EnrollmentClassType => {
  const raw = String(value || "GROUP")
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "-");

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
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
};

const weekdayFromIsoDate = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(year, month - 1, day).getDay()];
};

export const normalizeClassTime = (value: string): string => {
  const trimmed = value.trim();
  const match12 = trimmed.match(TIME_12_REGEX);
  if (match12) {
    let hour = Number(match12[1]);
    const minute = match12[2];
    const meridian = match12[3].toUpperCase();
    if (hour < 1 || hour > 12) {
      throw new EnrollmentError("Please choose a valid class time.");
    }
    const hourLabel = hour < 10 ? `0${hour}` : String(hour);
    return `${hourLabel}:${minute} ${meridian}`;
  }

  const match24 = trimmed.match(TIME_24_REGEX);
  if (match24) {
    let hour = Number(match24[1]);
    const minute = match24[2];
    const meridian = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    const hourLabel = hour < 10 ? `0${hour}` : String(hour);
    return `${hourLabel}:${minute} ${meridian}`;
  }

  throw new EnrollmentError("Please choose a valid class time.");
};

const batchLevelFromCourse = (category?: string | null): string => {
  const raw = String(category || "").toUpperCase();
  if (raw === "INTERMEDIATE") return "INTERMEDIATE";
  if (raw === "PREMIUM" || raw === "ADVANCED") return "ADVANCED";
  return "BEGINNER";
};

const findDefaultOneToOneTeacher = async (tx: Prisma.TransactionClient) => {
  const harshita = await tx.user.findFirst({
    where: {
      role: Role.TEACHER,
      isActive: true,
      OR: [
        { fullName: { contains: "Harshita", mode: "insensitive" } },
        { fullName: { contains: "Harsita", mode: "insensitive" } },
        { email: { contains: "harshita", mode: "insensitive" } },
        { email: { contains: "harsita", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  if (harshita) return harshita;

  return tx.user.findFirst({
    where: { role: Role.TEACHER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
};

const createOneToOneBatch = async (
  tx: Prisma.TransactionClient,
  payload: EnrollmentPayload,
  course: { id: string; title: string; category?: string | null }
) => {
  const teacher = await findDefaultOneToOneTeacher(tx);
  if (!teacher) {
    throw new EnrollmentError(
      "No teacher is available to assign this 1-to-1 batch. Please contact the academy.",
      500
    );
  }

  const preferredDate = String(payload.preferredDate || "");
  const classTime = normalizeClassTime(String(payload.preferredTime || ""));
  const weekday = weekdayFromIsoDate(preferredDate);
  const studentFirstName = payload.fullName.trim().split(/\s+/)[0] || "Student";
  const batchCode = `OTO-${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;

  return tx.batch.create({
    data: {
      name: `1-to-1 · ${course.title} · ${studentFirstName}`,
      code: batchCode,
      courseId: course.id,
      courseName: course.title,
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      schedule: `${weekday}|${classTime}|${preferredDate}|`,
      level: batchLevelFromCourse(course.category),
      status: "Active",
      totalStudents: 0,
    },
  });
};

export const toE164 = (phone: unknown, countryCode: unknown = "+91"): string => {
  const digits = String(phone || "").replace(/\D/g, "");
  const code = String(countryCode || "+91").replace(/\D/g, "");

  if (code && digits.startsWith(code)) {
    return `+${digits}`;
  }

  return `+${code}${digits}`;
};

export const isAgeUnder18 = (dob: unknown): boolean => {
  if (!dob) return false;
  const birthDate = new Date(String(dob));
  if (Number.isNaN(birthDate.getTime())) return false;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age < 18;
};

const isPrismaUniqueError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const asPayload = (value: Prisma.JsonValue): EnrollmentPayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EnrollmentError("Stored enrollment payload is invalid.", 500);
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
  options: { requirePassword: boolean }
): Promise<ValidatedEnrollment> => {
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const country = String(body.country || "").trim();
  const countryCodeRaw = String(body.countryCode || "+91").trim();
  const countryCode = countryCodeRaw.startsWith("+") ? countryCodeRaw : `+${countryCodeRaw}`;
  const address = String(body.address || "").trim();
  const password = String(body.password || "");
  const courseId = String(body.courseId || "").trim();
  const enrollmentType = parseEnrollmentType(body.enrollmentType || body.type || body.mode);
  let batchId = String(body.batchId || "").trim();
  const preferredDate = body.preferredDate ? String(body.preferredDate).trim() : "";
  const preferredTime = body.preferredTime ? String(body.preferredTime).trim() : "";
  const dob = body.dob ? String(body.dob).trim() : "";
  const gender = String(body.gender || "").trim();
  const city = String(body.city || "").trim();
  const region = String(body.region || "").trim();
  const postalCode = String(body.postalCode || "").trim();
  const guardianName = String(body.guardianName || "").trim();
  const relationship = String(body.relationship || "").trim();
  const emergencyContact = String(body.emergencyContact || "").trim();
  const methodRaw = String(body.paymentMethod || "RAZORPAY").trim().toUpperCase();
  const paymentMethod = methodRaw === "CARD" || methodRaw === "UPI" || methodRaw === "NETBANKING" ? methodRaw : "RAZORPAY";
  const isUnder18 = Boolean(body.isUnder18) || isAgeUnder18(dob);

  if (!fullName) throw new EnrollmentError("Full Name is required.");
  if (!email) throw new EnrollmentError("Email is required.");
  if (!EMAIL_REGEX.test(email)) throw new EnrollmentError("Invalid email address.");
  if (!country) throw new EnrollmentError("Country is required.");
  if (!String(body.phone || "").trim()) throw new EnrollmentError("Phone number is required.");

  const e164Phone = toE164(body.phone, countryCode);
  const digitsOnly = e164Phone.replace(/\D/g, "");
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    throw new EnrollmentError("Please enter a valid international phone number (10–15 digits).");
  }

  if (!address) throw new EnrollmentError("Residential address is required.");
  if (!region) throw new EnrollmentError("State / region is required.");
  if (!city) throw new EnrollmentError("City is required.");
  if (!postalCode) throw new EnrollmentError("Postal / ZIP code is required.");
  if (!dob) throw new EnrollmentError("Date of birth is required.");
  if (!gender) throw new EnrollmentError("Gender is required.");
  if (!courseId) throw new EnrollmentError("Course is required.");

  const courseRecord = await prisma.course.findUnique({ where: { id: courseId } });
  if (!courseRecord) {
    throw new EnrollmentError("Selected course does not exist.");
  }

  if (enrollmentType === "ONE_TO_ONE") {
    if (!preferredDate || !ISO_DATE_REGEX.test(preferredDate)) {
      throw new EnrollmentError("Please choose a date for your 1-to-1 class.");
    }
    if (preferredDate < todayIsoDate()) {
      throw new EnrollmentError("Please choose a date that is today or later.");
    }
    normalizeClassTime(preferredTime);
    if (!courseRecord.oneToOneFeeINR || courseRecord.oneToOneFeeINR <= 0) {
      throw new EnrollmentError("One-to-one enrollment is not available for this course.");
    }
    batchId = "";
  } else {
    if (!batchId) throw new EnrollmentError("Please select a batch before proceeding to payment.");

    const batchRecord = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batchRecord) {
      throw new EnrollmentError("Selected batch does not exist.");
    }
    if (!batchRecord.courseId || batchRecord.courseId !== courseId) {
      throw new EnrollmentError("Selected batch does not belong to the chosen course.");
    }
    if (isOneToOneBatch(batchRecord.name, batchRecord.code)) {
      throw new EnrollmentError(
        "This is a personal 1-to-1 batch and cannot be selected. Please choose a group batch or enroll in 1-to-1 personal classes."
      );
    }
  }

  if (options.requirePassword && password.length < 6) {
    throw new EnrollmentError("Password must be at least 6 characters.");
  }

  if (isUnder18) {
    if (!guardianName) throw new EnrollmentError("Guardian name is required for students under 18.");
    if (!emergencyContact) throw new EnrollmentError("Emergency contact is required for students under 18.");
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { phone: e164Phone }],
    },
  });

  if (existingUser) {
    throw new EnrollmentError("An account with this email or phone already exists. Please login.", 409);
  }

  const payload: EnrollmentPayload = {
    fullName,
    email,
    phone: e164Phone,
    country,
    countryCode,
    address,
    profileImage: body.profileImage ? String(body.profileImage).trim() : null,
    dob,
    gender,
    city,
    region,
    postalCode,
    skillLevel: body.skillLevel ? String(body.skillLevel).trim() : null,
    joiningDate: body.joiningDate ? String(body.joiningDate).trim() : new Date().toISOString().slice(0, 10),
    isUnder18,
    guardianName: guardianName || null,
    relationship: relationship || null,
    emergencyContact: emergencyContact || null,
    paymentMethod,
    courseId,
    batchId,
    enrollmentType,
    preferredDate: enrollmentType === "ONE_TO_ONE" ? preferredDate : null,
    preferredTime: enrollmentType === "ONE_TO_ONE" ? normalizeClassTime(preferredTime) : null,
  };

  const passwordHash = options.requirePassword ? await bcrypt.hash(password, 10) : "";

  return {
    payload,
    passwordHash,
    normalizedEmail: email,
    e164Phone,
  };
};

const loadCompletedByPayment = async (
  razorpayOrderId: string,
  razorpayPaymentId: string
): Promise<CompletedEnrollment | null> => {
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [{ orderId: razorpayOrderId }, { transactionId: razorpayPaymentId }],
    },
    include: {
      user: true,
      enrollment: true,
    },
  });

  if (!payment?.user) return null;

  const enrollment =
    payment.enrollment ||
    (await prisma.enrollment.findFirst({
      where: { userId: payment.userId },
      orderBy: { createdAt: "desc" },
    }));

  if (!enrollment) return null;

  return {
    user: publicUser(payment.user),
    enrollment,
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
  razorpayOrderId: string,
  razorpayPaymentId: string
): Promise<CompletedEnrollment> => {
  const payload = pending.payload;

  let user = await tx.user.findFirst({
    where: {
      OR: [{ email: payload.email }, { phone: payload.phone }],
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
        dob: payload.dob ? new Date(payload.dob) : null,
        gender: payload.gender || null,
        city: payload.city || null,
        region: payload.region || null,
        postalCode: payload.postalCode || null,
        skillLevel: payload.skillLevel || null,
        joiningDate: payload.joiningDate ? new Date(payload.joiningDate) : null,
        isUnder18: Boolean(payload.isUnder18),
        guardianName: payload.guardianName || null,
        relationship: payload.relationship || null,
        emergencyContact: payload.emergencyContact || null,
        paymentMethod: payload.paymentMethod || null,
        isActive: true,
      },
    });
  }

  let enrollment = await tx.enrollment.findFirst({
    where: { userId: user.id, courseId: payload.courseId },
  });

  const enrollmentType = parseEnrollmentType(payload.enrollmentType);

  if (!enrollment) {
    enrollment = await tx.enrollment.create({
      data: {
        userId: user.id,
        courseId: payload.courseId,
        mode: ClassMode.ONLINE,
        type: enrollmentType,
        active: true,
      },
    });
  } else if (enrollment.type !== enrollmentType) {
    enrollment = await tx.enrollment.update({
      where: { id: enrollment.id },
      data: { type: enrollmentType, active: true },
    });
  }

  const course = await tx.course.findUnique({ where: { id: payload.courseId } });
  if (!course) {
    throw new EnrollmentError("Selected course does not exist.", 404);
  }

  const monthlyFee =
    enrollmentType === "ONE_TO_ONE" ? course.oneToOneFeeINR || 0 : course.groupFeeINR || 0;
  const feePaid = enrollmentAmountINR(monthlyFee);

  const existingPayment = await tx.payment.findFirst({
    where: {
      OR: [{ orderId: razorpayOrderId }, { transactionId: razorpayPaymentId }],
    },
  });

  let alreadyCompleted = Boolean(existingPayment);

  if (!existingPayment) {
    await tx.payment.create({
      data: {
        userId: user.id,
        enrollmentId: enrollment.id,
        amount: feePaid,
        currency: "INR",
        gateway: "RAZORPAY",
        transactionId: razorpayPaymentId,
        orderId: razorpayOrderId,
        status: PaymentStatus.SUCCESS,
      },
    });
  } else if (!existingPayment.enrollmentId) {
    await tx.payment.update({
      where: { id: existingPayment.id },
      data: { enrollmentId: enrollment.id },
    });
  }

  let assignedBatchId = payload.batchId;
  if (enrollmentType === "ONE_TO_ONE") {
    const oneToOneBatch = await createOneToOneBatch(tx, payload, course);
    assignedBatchId = oneToOneBatch.id;
  }

  if (assignedBatchId) {
    const membership = await tx.batchStudent.findUnique({
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
        where: { id: assignedBatchId },
        data: { totalStudents: { increment: 1 } },
      });
    }
  }

  await tx.pendingEnrollment.update({
    where: { id: pending.id },
    data: {
      status: PendingEnrollmentStatus.COMPLETED,
      userId: user.id,
      errorMessage: null,
    },
  });

  return {
    user: publicUser(user),
    enrollment,
    alreadyCompleted,
  };
};

export const completePendingEnrollment = async (params: {
  pendingId?: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
}): Promise<CompletedEnrollment> => {
  const { pendingId, razorpayOrderId, razorpayPaymentId } = params;

  if (!razorpayOrderId || !razorpayPaymentId) {
    throw new EnrollmentError("Payment verification failed. Missing payment details.");
  }

  const pending = pendingId
    ? await prisma.pendingEnrollment.findUnique({ where: { id: pendingId } })
    : await prisma.pendingEnrollment.findUnique({ where: { razorpayOrderId } });

  if (!pending) {
    const alreadyPaid = await loadCompletedByPayment(razorpayOrderId, razorpayPaymentId);
    if (alreadyPaid) return alreadyPaid;
    throw new EnrollmentError("No matching enrollment was found for this payment.", 404);
  }

  if (pending.razorpayOrderId && pending.razorpayOrderId !== razorpayOrderId) {
    throw new EnrollmentError("Payment order does not match this enrollment.");
  }

  if (pending.status === PendingEnrollmentStatus.COMPLETED && pending.userId) {
    const alreadyPaid = await loadCompletedByPayment(razorpayOrderId, razorpayPaymentId);
    if (alreadyPaid) return alreadyPaid;

    const user = await prisma.user.findUnique({ where: { id: pending.userId } });
    const enrollment = await prisma.enrollment.findFirst({
      where: { userId: pending.userId },
      orderBy: { createdAt: "desc" },
    });
    if (user && enrollment) {
      return { user: publicUser(user), enrollment, alreadyCompleted: true };
    }
  }

  try {
    return await prisma.$transaction((tx) =>
      fulfillEnrollment(
        tx,
        {
          id: pending.id,
          passwordHash: pending.passwordHash,
          payload: asPayload(pending.payload),
        },
        razorpayOrderId,
        razorpayPaymentId
      )
    );
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      const recovered = await loadCompletedByPayment(razorpayOrderId, razorpayPaymentId);
      if (recovered) return recovered;

      const pendingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: asPayload(pending.payload).email },
            { phone: asPayload(pending.payload).phone },
          ],
        },
        include: { enrollments: { orderBy: { createdAt: "desc" } } },
      });
      if (pendingUser && pendingUser.enrollments[0]) {
        return {
          user: publicUser(pendingUser),
          enrollment: pendingUser.enrollments[0],
          alreadyCompleted: true,
        };
      }
    }

    if (error instanceof EnrollmentError) throw error;
    throw new EnrollmentError("Enrollment failed after payment. Please contact support with your payment ID.", 500);
  }
};

export const sendEnrollmentWelcomeEmail = async (user: {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  address?: string | null;
}): Promise<void> => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        enrollment: { include: { course: true } },
      },
    });
    const membership = await prisma.batchStudent.findFirst({
      where: { studentId: user.id },
      include: { batch: true },
    });

    const invoice: InvoiceData | null = payment
      ? {
          invoiceNumber: `INV-${(payment.transactionId || payment.id).slice(-10).toUpperCase()}`,
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
        }
      : null;

    await sendEmail({
      to: user.email,
      subject: invoice
        ? "Welcome to Kathak Academy — Enrollment & Payment Invoice"
        : "Welcome to Kathak Academy!",
      html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #900C27; text-align: center;">Welcome to Kathak Academy</h2>
            <p>Hi ${user.fullName},</p>
            <p>Thank you for registering with us! Your enrollment and payment have been successfully processed.</p>
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1B1B24;">Your Login Details</h3>
              <p><strong>Login URL:</strong> <a href="${env.frontendUrl}/login">${env.frontendUrl}/login</a></p>
              <p><strong>Email:</strong> ${user.email}</p>
              <p>Use the portal password you created during enrollment to sign in.</p>
            </div>
            ${invoice ? buildInvoiceEmailBlock(invoice) : ""}
            <p>You can log in anytime to view your classes, assignments, and payments. A copy of this invoice is attached.</p>
            <br/>
            <p>Warm Regards,</p>
            <p><strong>Kathak Academy Team</strong></p>
          </div>
        `,
      attachments: invoice
        ? [
            {
              filename: `${invoice.invoiceNumber}.html`,
              content: buildInvoiceHtml(invoice),
              contentType: "text/html",
            },
          ]
        : undefined,
    });
  } catch (emailErr) {
    console.error("Failed to send registration welcome email:", emailErr);
  }
};
