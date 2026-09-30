import { PaymentStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");

function parseBatchStart(schedule: string | null): Date | null {
  const raw = schedule?.split("|")[2];
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function dueMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const enrollments = await prisma.enrollment.findMany({
    where: { paymentMode: "MONTHLY", active: true },
    include: {
      payments: { where: { status: PaymentStatus.SUCCESS }, orderBy: { createdAt: "asc" } },
      monthlyDues: { orderBy: { dueDate: "asc" } },
      user: {
        select: {
          fullName: true,
          batchMemberships: {
            include: { batch: { select: { courseId: true, schedule: true, name: true } } },
          },
        },
      },
    },
  });

  const candidates = enrollments.flatMap((enrollment) => {
    // Multiple completed payments require a manual review; this job only fixes
    // the unambiguous initial early-payment case.
    if (enrollment.payments.length !== 1 || enrollment.monthlyDues.length === 0) return [];

    const payment = enrollment.payments[0];
    const batch = enrollment.user.batchMemberships
      .map((membership) => membership.batch)
      .find((item) => item.courseId === enrollment.courseId && parseBatchStart(item.schedule));
    const startDate = batch ? parseBatchStart(batch.schedule) : null;
    const paidDues = enrollment.monthlyDues.filter((due) => due.status === PaymentStatus.SUCCESS);

    if (
      !batch ||
      !startDate ||
      paidDues.length === 0 ||
      payment.createdAt >= startDate ||
      !enrollment.nextDueDate ||
      enrollment.nextDueDate >= startDate
    ) {
      return [];
    }

    return [{ enrollment, payment, batch, startDate, paidDues }];
  });

  console.log(`${apply ? "Applying" : "Dry run:"} ${candidates.length} early-enrollment correction(s).`);

  for (const candidate of candidates) {
    const { enrollment, payment, batch, startDate, paidDues } = candidate;
    const coverageStart = monthStart(startDate);
    const nextDueDate = addMonths(coverageStart, paidDues.length);
    console.log(`${enrollment.user.fullName}: ${batch.name} — ${dueMonth(coverageStart)} to ${dueMonth(nextDueDate)}.`);

    if (!apply) continue;

    const template = paidDues[0];
    await prisma.$transaction(async (tx) => {
      await tx.monthlyDue.deleteMany({ where: { enrollmentId: enrollment.id } });

      await tx.monthlyDue.createMany({
        data: paidDues.map((_, index) => {
          const date = addMonths(coverageStart, index);
          return {
            enrollmentId: enrollment.id,
            userId: enrollment.userId,
            courseId: enrollment.courseId,
            dueMonth: dueMonth(date),
            dueDate: date,
            amount: template.amount,
            currency: template.currency,
            status: PaymentStatus.SUCCESS,
            paidAt: payment.createdAt,
          };
        }),
      });

      await tx.monthlyDue.create({
        data: {
          enrollmentId: enrollment.id,
          userId: enrollment.userId,
          courseId: enrollment.courseId,
          dueMonth: dueMonth(nextDueDate),
          dueDate: nextDueDate,
          amount: template.amount,
          currency: template.currency,
          status: PaymentStatus.PENDING,
        },
      });

      await tx.enrollment.update({ where: { id: enrollment.id }, data: { nextDueDate } });
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
