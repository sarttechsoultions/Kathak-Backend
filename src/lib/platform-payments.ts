import { PaymentStatus } from "@prisma/client";
import { prisma } from "./prisma";

export type PlatformPaymentRow = {
  id: string;
  source: "COURSE" | "WORKSHOP";
  sourceLabel: string;
  createdAt: Date;
  studentName: string;
  email: string;
  phone: string;
  itemTitle: string;
  transactionId: string;
  orderId: string | null;
  gateway: string;
  status: string;
  amount: number;
  currency: string;
  invoicePaymentId: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  billingState: string;
  sacCode: string | null;
  gstRate: number | null;
  taxableValue: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  totalGst: number | null;
};

type InvoiceSnapshot = {
  studentState?: unknown;
  sacCode?: unknown;
  gstDetails?: {
    gstRate?: unknown;
    taxableBase?: unknown;
    cgst?: unknown;
    sgst?: unknown;
    igst?: unknown;
    totalGst?: unknown;
  };
};

const asNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const isSuccessfulStatus = (status: string) =>
  status === PaymentStatus.SUCCESS || status === "SUCCESS";

export const loadPlatformPayments = async (): Promise<PlatformPaymentRow[]> => {
  const [payments, tickets, registrations] = await Promise.all([
    prisma.payment.findMany({
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            country: true,
            city: true,
            region: true,
            address: true,
            postalCode: true,
            paymentMethod: true,
            joiningDate: true,
            batchMemberships: { include: { batch: { select: { name: true, code: true } } } },
          },
        },
        enrollment: { include: { course: true } },
        Invoice: { select: { invoiceNumber: true, createdAt: true, snapshot: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.eventTicket.findMany({
      include: { event: { select: { title: true, category: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.eventRegistration.findMany({
      where: { paymentId: null },
      include: {
        event: { select: { title: true, category: true, registrationFee: true } },
        student: { select: { fullName: true, email: true, phone: true } },
      },
      orderBy: { registeredAt: "desc" },
    }),
  ]);

  const rows: PlatformPaymentRow[] = payments.map((payment) => {
    const snapshot = (payment.Invoice?.snapshot || {}) as InvoiceSnapshot;
    const gst = snapshot.gstDetails;
    return {
      id: payment.id,
      source: "COURSE",
      sourceLabel: "Course Enrollment",
      createdAt: payment.createdAt,
      studentName: payment.user?.fullName || "Student",
      email: payment.user?.email || "",
      phone: payment.user?.phone || "",
      itemTitle: payment.enrollment?.course?.title || "Course Enrollment",
      transactionId: payment.transactionId,
      orderId: payment.orderId,
      gateway: payment.gateway || payment.user?.paymentMethod || "RAZORPAY",
      status: payment.status,
      amount: payment.amount,
      currency: String(payment.currency || "INR"),
      invoicePaymentId: payment.id,
      invoiceNumber: payment.Invoice?.invoiceNumber || null,
      invoiceDate: payment.Invoice?.createdAt || null,
      billingState: typeof snapshot.studentState === "string" ? snapshot.studentState : payment.user?.region || "",
      // Older invoices predate the immutable SAC snapshot. Keep their CA export
      // useful while new invoices always retain the code that was issued.
      sacCode: payment.Invoice
        ? typeof snapshot.sacCode === "string"
          ? snapshot.sacCode
          : (process.env.GST_SAC_CODE || "999291").trim()
        : null,
      gstRate: asNumberOrNull(gst?.gstRate),
      taxableValue: asNumberOrNull(gst?.taxableBase),
      cgst: asNumberOrNull(gst?.cgst),
      sgst: asNumberOrNull(gst?.sgst),
      igst: asNumberOrNull(gst?.igst),
      totalGst: asNumberOrNull(gst?.totalGst),
    };
  });

  for (const ticket of tickets) {
    rows.push({
      id: ticket.id,
      source: "WORKSHOP",
      sourceLabel: ticket.event?.category === "Event" ? "Event Ticket" : "Workshop Ticket",
      createdAt: ticket.createdAt,
      studentName: ticket.fullName,
      email: ticket.email,
      phone: ticket.phone,
      itemTitle: ticket.event?.title || "Workshop",
      transactionId: ticket.razorpayPaymentId || ticket.bookingId,
      orderId: ticket.razorpayOrderId || ticket.bookingId,
      gateway: ticket.paymentMethod || "RAZORPAY",
      status: ticket.paymentStatus,
      amount: ticket.amount,
      currency: "INR",
      invoicePaymentId: null,
      invoiceNumber: null,
      invoiceDate: null,
      billingState: "",
      sacCode: null,
      gstRate: null,
      taxableValue: null,
      cgst: null,
      sgst: null,
      igst: null,
      totalGst: null,
    });
  }

  for (const registration of registrations) {
    const amount = registration.event?.registrationFee || 0;
    if (amount <= 0 && registration.paymentStatus === PaymentStatus.PENDING) continue;
    rows.push({
      id: registration.id,
      source: "WORKSHOP",
      sourceLabel: "Workshop Registration",
      createdAt: registration.registeredAt,
      studentName: registration.student?.fullName || "Student",
      email: registration.student?.email || "",
      phone: registration.student?.phone || "",
      itemTitle: registration.event?.title || "Workshop",
      transactionId: registration.paymentId || registration.id,
      orderId: registration.id,
      gateway: "RAZORPAY",
      status: registration.paymentStatus,
      amount,
      currency: "INR",
      invoicePaymentId: registration.paymentId,
      invoiceNumber: null,
      invoiceDate: null,
      billingState: "",
      sacCode: null,
      gstRate: null,
      taxableValue: null,
      cgst: null,
      sgst: null,
      igst: null,
      totalGst: null,
    });
  }

  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows;
};

export const summarizePlatformPayments = (rows: PlatformPaymentRow[]) => {
  const successful = rows.filter((row) => isSuccessfulStatus(row.status));
  const courseRevenue = successful
    .filter((row) => row.source === "COURSE")
    .reduce((sum, row) => sum + row.amount, 0);
  const workshopRevenue = successful
    .filter((row) => row.source === "WORKSHOP")
    .reduce((sum, row) => sum + row.amount, 0);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysPayments = rows.filter((row) => new Date(row.createdAt) >= todayStart);
  const todayRevenue = todaysPayments
    .filter((row) => isSuccessfulStatus(row.status))
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    platformRevenue: courseRevenue + workshopRevenue,
    courseRevenue,
    workshopRevenue,
    totalPayments: rows.length,
    successCount: successful.length,
    pendingCount: rows.filter((row) => row.status === PaymentStatus.PENDING || row.status === "PENDING").length,
    failedCount: rows.filter((row) => row.status === PaymentStatus.FAILED || row.status === "FAILED").length,
    todayRevenue,
    todaysPayments,
  };
};
