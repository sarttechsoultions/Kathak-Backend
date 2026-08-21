export type InvoiceData = {
  invoiceNumber: string;
  issuedAt: Date;
  studentName: string;
  studentEmail: string;
  studentPhone: string;
  studentAddress?: string | null;
  courseTitle: string;
  batchName?: string | null;
  amount: number;
  currency: string;
  gateway: string;
  paymentMethod?: string | null;
  transactionId: string;
  orderId: string;
  status: string;
};

const formatINR = (amount: number, currency = "INR") => {
  if (currency === "INR") {
    return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
  }
  return `${currency} ${Number(amount || 0).toLocaleString("en-IN")}`;
};

const formatDate = (value: Date) =>
  new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const buildInvoiceHtml = (invoice: InvoiceData): string => {
  const method = invoice.paymentMethod || invoice.gateway || "Online";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #1B1B24; background: #f6f3ee; margin: 0; padding: 24px; }
    .sheet { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #eadfd0; border-radius: 16px; overflow: hidden; }
    .header { background: #900C27; color: #fff; padding: 28px 32px; display: flex; justify-content: space-between; gap: 16px; }
    .header h1 { margin: 0; font-size: 22px; }
    .header p { margin: 6px 0 0; font-size: 12px; opacity: .9; }
    .badge { background: #fff; color: #900C27; font-weight: 700; font-size: 11px; letter-spacing: .08em; padding: 6px 10px; border-radius: 999px; height: fit-content; }
    .body { padding: 28px 32px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 24px; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #7a7168; margin-bottom: 4px; }
    .value { font-size: 14px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 24px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7a7168; border-bottom: 1px solid #eadfd0; padding: 10px 0; }
    td { padding: 12px 0; border-bottom: 1px solid #f1ebe3; font-size: 14px; }
    .total { background: #FDF2F4; border-radius: 12px; padding: 16px 18px; display: flex; justify-content: space-between; font-size: 18px; font-weight: 800; color: #900C27; }
    .meta { font-size: 12px; color: #5d564e; line-height: 1.6; }
    .footer { padding: 0 32px 28px; font-size: 11px; color: #8a8178; }
    @media print { body { background: #fff; padding: 0; } .sheet { border: none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <h1>Kathak Academy</h1>
        <p>Kathak by Harshita · Payment Invoice</p>
      </div>
      <div class="badge">${escapeHtml(invoice.status || "PAID")}</div>
    </div>
    <div class="body">
      <div class="grid">
        <div>
          <div class="label">Billed To</div>
          <div class="value">${escapeHtml(invoice.studentName)}</div>
          <div class="meta">${escapeHtml(invoice.studentEmail)}<br/>${escapeHtml(invoice.studentPhone)}${invoice.studentAddress ? `<br/>${escapeHtml(invoice.studentAddress)}` : ""}</div>
        </div>
        <div>
          <div class="label">Invoice</div>
          <div class="value">${escapeHtml(invoice.invoiceNumber)}</div>
          <div class="meta">Issued: ${escapeHtml(formatDate(invoice.issuedAt))}<br/>Transaction: ${escapeHtml(invoice.transactionId)}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Batch</th>
            <th>Method</th>
            <th style="text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(invoice.courseTitle || "Course Enrollment")}</td>
            <td>${escapeHtml(invoice.batchName || "—")}</td>
            <td>${escapeHtml(method)}</td>
            <td style="text-align:right">${escapeHtml(formatINR(invoice.amount, invoice.currency))}</td>
          </tr>
        </tbody>
      </table>
      <div class="total">
        <span>Amount Received</span>
        <span>${escapeHtml(formatINR(invoice.amount, invoice.currency))}</span>
      </div>
      <p class="meta" style="margin-top:18px">
        Gateway: ${escapeHtml(invoice.gateway)} · Order ID: ${escapeHtml(invoice.orderId)} · Currency: ${escapeHtml(invoice.currency)}
      </p>
    </div>
    <div class="footer">This is a computer-generated invoice for Kathak Academy enrollment fees. No signature is required.</div>
  </div>
</body>
</html>`;
};

export const buildInvoiceEmailBlock = (invoice: InvoiceData): string => {
  const method = invoice.paymentMethod || invoice.gateway || "Online";
  return `
    <div style="border:1px solid #eadfd0; border-radius:12px; padding:20px; margin:24px 0;">
      <h3 style="margin:0 0 12px; color:#900C27;">Payment Invoice</h3>
      <p style="margin:0 0 8px;"><strong>Invoice No:</strong> ${escapeHtml(invoice.invoiceNumber)}</p>
      <p style="margin:0 0 8px;"><strong>Course:</strong> ${escapeHtml(invoice.courseTitle)}</p>
      <p style="margin:0 0 8px;"><strong>Batch:</strong> ${escapeHtml(invoice.batchName || "—")}</p>
      <p style="margin:0 0 8px;"><strong>Amount Paid:</strong> ${escapeHtml(formatINR(invoice.amount, invoice.currency))}</p>
      <p style="margin:0 0 8px;"><strong>Method:</strong> ${escapeHtml(method)}</p>
      <p style="margin:0;"><strong>Transaction ID:</strong> ${escapeHtml(invoice.transactionId)}</p>
    </div>
  `;
};
