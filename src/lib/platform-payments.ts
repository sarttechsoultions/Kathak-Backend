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
  orderId: string;
  gateway: string;
  status: string;
  amount: number;
  currency: string;
  invoicePaymentId: string | null;
};

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

  const rows: PlatformPaymentRow[] = payments.map((payment) => ({
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
  }));

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
