import cron from "node-cron";
import { prisma } from "../../lib/prisma";
import { getRazorpay } from "../payment/payment.controller";
import { completePendingEnrollment, sendEnrollmentWelcomeEmail } from "../student/enrollment.service";

let running = false;
let cursor: string | undefined;

// Scan bounded pages, including old orders, without letting abandoned orders
// permanently hide newer paid orders behind the first page.
export async function reconcileEnrollments() {
  if (running) return;
  running = true;
  try {
    const gateway = getRazorpay();
    if (!gateway) return;
    const rows = await prisma.pendingEnrollment.findMany({
      where: {
        status: { in: ["PENDING", "FAILED", "PROCESSING"] },
        razorpayOrderId: { not: null },
        updatedAt: { lt: new Date(Date.now() - 2 * 60_000) },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 25,
    });
    cursor = rows.length === 25 ? rows[rows.length - 1].id : undefined;
    for (const row of rows) {
      try {
        const payload = row.payload as Record<string, unknown>;
        const amount = Math.round(Number(payload.expectedAmount) * 100);
        const currency = String(payload.expectedCurrency || "");
        if (!Number.isSafeInteger(amount) || amount <= 0 || !currency) {
          console.error("Enrollment reconciliation: invalid pricing", { pendingId: row.id });
          continue;
        }
        const orderId = row.razorpayOrderId!;
        const order = await gateway.orders.fetch(orderId);
        if (Number(order.amount) !== amount || order.currency !== currency) {
          console.error("Enrollment reconciliation: order mismatch", { pendingId: row.id });
          continue;
        }
        const payments = await gateway.orders.fetchPayments(orderId);
        const captured = payments.items.find(payment =>
          payment.order_id === orderId && payment.status === "captured" &&
          payment.currency === currency && Number(payment.amount) === amount &&
          !Number(payment.amount_refunded)
        );
        if (!captured) continue;
        const result = await completePendingEnrollment({
          pendingId: row.id, razorpayOrderId: orderId, razorpayPaymentId: captured.id,
        });
        console.log("Enrollment reconciled", { pendingId: row.id, paymentId: captured.id });
        if (!result.alreadyCompleted) {
          await sendEnrollmentWelcomeEmail(result.user, undefined,
            payload.operationType === "RENEWAL" ? "RENEWAL" : "ENROLLMENT");
        }
      } catch (error) {
        console.error("Enrollment reconciliation failed", {
          pendingId: row.id, message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  } catch (error) {
    console.error("Enrollment reconciliation scan failed", error instanceof Error ? error.message : "Unknown error");
  } finally {
    running = false;
  }
}

export function startEnrollmentReconciliationJob() {
  cron.schedule("*/5 * * * *", () => { void reconcileEnrollments(); });
}
