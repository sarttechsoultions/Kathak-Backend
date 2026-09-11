import { GstCalculationResult } from "./gst";
import fs from "fs";

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
  orderId: string | null;
  status: string;
  snapshot?: any;
};

const formatINR = (amount: number, currency = "INR") => {
  if (currency === "INR") {
    return `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${currency} ${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

/** Internal tax invoice for the academy and its CA. */
export const buildCaTaxInvoiceHtml = (invoice: InvoiceData): string => {
  const method = invoice.paymentMethod || invoice.gateway || "Online";

  // Use snapshot data if available, fallback to environment variables
  const academyName = invoice.snapshot?.academyName || process.env.ACADEMY_NAME || "";
  const academyEmail = invoice.snapshot?.academyEmail || process.env.ACADEMY_CONTACT_EMAIL || "";
  const academyPhone = invoice.snapshot?.academyPhone || process.env.ACADEMY_CONTACT_PHONE || "";
  const academyAddress = invoice.snapshot?.academyAddress || process.env.ACADEMY_ADDRESS || "";
  const academyState = invoice.snapshot?.academyState || process.env.ACADEMY_STATE || "";
  const academyGstin = invoice.snapshot?.academyGstin || process.env.ACADEMY_GSTIN || "";
  const studentState = invoice.snapshot?.studentState || "";

  const gstDetails: GstCalculationResult | null = invoice.snapshot?.gstDetails || null;
  const isGstEnabled = gstDetails && gstDetails.totalGst > 0;

  let taxRows = "";
  if (isGstEnabled) {
    if (gstDetails.isInterState) {
      taxRows = `
        <tr>
          <td>IGST</td><td>${gstDetails.gstRate}%</td>
          <td class="money">${escapeHtml(formatINR(gstDetails.igst, invoice.currency))}</td>
        </tr>
      `;
    } else {
      taxRows = `
        <tr>
          <td>CGST</td><td>${gstDetails.gstRate / 2}%</td>
          <td class="money">${escapeHtml(formatINR(gstDetails.cgst, invoice.currency))}</td>
        </tr>
        <tr>
          <td>SGST</td><td>${gstDetails.gstRate / 2}%</td>
          <td class="money">${escapeHtml(formatINR(gstDetails.sgst, invoice.currency))}</td>
        </tr>
      `;
    }
  }

  const baseAmount = isGstEnabled ? gstDetails.taxableBase : invoice.amount;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tax Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin:0; padding:24px; background:#f2f4f7; color:#182230; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.45; }
    .sheet { width:100%; max-width:794px; min-height:1080px; margin:0 auto; background:#fff; border:1px solid #dde3ea; }
    .top-line { height:6px; background:#990d2e; }
    .header { display:flex; justify-content:space-between; gap:28px; padding:30px 36px 24px; border-bottom:1px solid #dde3ea; }
    .academy { max-width:58%; } .academy-name { margin:0 0 7px; color:#990d2e; font-size:23px; line-height:1.15; font-weight:800; }
    .academy p, .invoice-meta p { margin:2px 0; color:#475467; }
    .invoice-meta { min-width:200px; text-align:right; } .invoice-title { margin:0 0 8px; color:#101828; font-size:25px; letter-spacing:.06em; font-weight:800; }
    .invoice-number { color:#990d2e; font-size:13px; font-weight:700; }
    .content { padding:26px 36px 32px; } .columns { display:table; width:100%; margin-bottom:27px; } .column { display:table-cell; width:50%; vertical-align:top; } .column + .column { padding-left:32px; }
    .section-label { margin-bottom:7px; color:#667085; font-size:10px; letter-spacing:.1em; font-weight:700; text-transform:uppercase; }
    .customer-name { color:#101828; font-size:14px; font-weight:700; } .muted { color:#667085; } .details { min-height:86px; }
    table { width:100%; border-collapse:collapse; } .items { margin-top:4px; } .items th { padding:10px 11px; background:#f9fafb; color:#475467; border-top:1px solid #dfe5ec; border-bottom:1px solid #dfe5ec; font-size:10px; letter-spacing:.06em; text-align:left; text-transform:uppercase; }
    .items td { padding:14px 11px; border-bottom:1px solid #e8ecf1; vertical-align:top; } .items .money { text-align:right; white-space:nowrap; font-weight:700; } .service-name { color:#101828; font-weight:700; } .service-note { margin-top:3px; color:#667085; font-size:11px; }
    .bottom { display:table; width:100%; margin-top:24px; } .payment { display:table-cell; width:52%; padding-right:30px; vertical-align:top; } .summary { display:table-cell; width:48%; vertical-align:top; }
    .payment-card { padding:15px 16px; background:#fbfcfe; border:1px solid #e3e8ef; } .payment-row { display:flex; justify-content:space-between; gap:12px; padding:4px 0; } .payment-row span:first-child { color:#667085; }
    .totals { border:1px solid #dfe5ec; } .totals td { padding:9px 13px; border-bottom:1px solid #edf0f4; } .totals td:last-child { text-align:right; font-weight:700; white-space:nowrap; } .totals .grand td { padding:13px; background:#990d2e; color:#fff; border-bottom:none; font-size:15px; font-weight:800; }
    .declaration { margin-top:28px; padding-top:15px; border-top:1px solid #e8ecf1; color:#667085; font-size:10.5px; } .declaration p { margin:4px 0; }
    .footer { padding:16px 36px 24px; border-top:1px solid #e5e9ef; color:#667085; font-size:10px; display:flex; justify-content:space-between; gap:16px; }
    @media print { body { padding:0; background:#fff; } .sheet { border:none; max-width:none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="top-line"></div>
    <div class="header">
      <div class="academy">
        <h1 class="academy-name">${escapeHtml(academyName)}</h1>
        ${academyAddress ? `<p>${escapeHtml(academyAddress)}</p>` : ''}
        ${academyState ? `<p>${escapeHtml(academyState)}</p>` : ''}
        ${academyGstin ? `<p><strong>GSTIN:</strong> ${escapeHtml(academyGstin)}</p>` : ''}
        ${academyEmail || academyPhone ? `<p>${escapeHtml(academyEmail)}${academyEmail && academyPhone ? ' · ' : ''}${escapeHtml(academyPhone)}</p>` : ''}
      </div>
      <div class="invoice-meta">
        <h2 class="invoice-title">TAX INVOICE</h2>
        <p class="invoice-number">${escapeHtml(invoice.invoiceNumber)}</p>
        <p>Invoice Date: ${escapeHtml(formatDate(invoice.issuedAt))}</p>
        <p>Payment Status: <strong>${escapeHtml(invoice.status || "PAID")}</strong></p>
      </div>
    </div>
    <div class="content">
      <div class="columns">
        <div class="column details">
          <div class="section-label">Bill To</div>
          <div class="customer-name">${escapeHtml(invoice.studentName)}</div>
          <div class="muted">${escapeHtml(invoice.studentAddress || "")}${invoice.studentAddress ? '<br/>' : ''}${escapeHtml(studentState)}${studentState ? '<br/>' : ''}${escapeHtml(invoice.studentPhone)}${invoice.studentPhone ? '<br/>' : ''}${escapeHtml(invoice.studentEmail)}</div>
        </div>
        <div class="column details">
          <div class="section-label">Supply & Reference</div>
          <div><strong>Place of Supply:</strong> ${escapeHtml(studentState || academyState || "Not recorded")}</div>
          <div class="muted">Transaction ID: ${escapeHtml(invoice.transactionId)}</div>
          ${invoice.orderId ? `<div class="muted">Order ID: ${escapeHtml(invoice.orderId)}</div>` : ''}
        </div>
      </div>
      <table class="items">
        <thead>
          <tr>
            <th style="width:52%">Description</th>
            <th style="width:22%">Batch</th>
            <th style="width:26%; text-align:right">Taxable Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><div class="service-name">${escapeHtml(invoice.courseTitle || "Course Enrollment")}</div><div class="service-note">Course enrollment fee · Payment method: ${escapeHtml(method)}</div></td>
            <td>${escapeHtml(invoice.batchName || "—")}</td>
            <td class="money">${escapeHtml(formatINR(baseAmount, invoice.currency))}</td>
          </tr>
        </tbody>
      </table>
      <div class="bottom">
        <div class="payment"><div class="section-label">Payment Information</div><div class="payment-card"><div class="payment-row"><span>Payment method</span><strong>${escapeHtml(method)}</strong></div><div class="payment-row"><span>Gateway</span><strong>${escapeHtml(invoice.gateway)}</strong></div><div class="payment-row"><span>Currency</span><strong>${escapeHtml(invoice.currency)}</strong></div><div class="payment-row"><span>Transaction ID</span><strong>${escapeHtml(invoice.transactionId)}</strong></div></div></div>
        <div class="summary"><div class="section-label">Invoice Summary</div><table class="totals"><tbody><tr><td>Taxable value</td><td>${escapeHtml(formatINR(baseAmount, invoice.currency))}</td></tr>${taxRows}<tr class="grand"><td>Total amount received</td><td>${escapeHtml(formatINR(invoice.amount, invoice.currency))}</td></tr></tbody></table></div>
      </div>
      <div class="declaration"><p><strong>Declaration:</strong> This invoice is generated electronically for the payment stated above.</p>${isGstEnabled ? `<p>GST has been calculated from the inclusive amount. ${gstDetails.isInterState ? 'IGST' : 'CGST and SGST'} has been applied based on the recorded place of supply.</p>` : ''}</div>
    </div>
    <div class="footer"><span>This is a computer-generated tax invoice. No signature is required.</span><span>${escapeHtml(academyName)}</span></div>
  </div>
</body>
</html>`;
};

/** Student-facing receipt. GST calculations remain in the stored invoice only. */
export const buildStudentPaymentReceiptHtml = (invoice: InvoiceData): string => {
  const academyName = invoice.snapshot?.academyName || process.env.ACADEMY_NAME || "";
  const academyEmail = invoice.snapshot?.academyEmail || process.env.ACADEMY_CONTACT_EMAIL || "";
  const academyPhone = invoice.snapshot?.academyPhone || process.env.ACADEMY_CONTACT_PHONE || "";
  const academyAddress = invoice.snapshot?.academyAddress || process.env.ACADEMY_ADDRESS || "";
  const method = invoice.paymentMethod || invoice.gateway || "Online";
  const showGstIncluded = invoice.snapshot?.showGstIncluded === true;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Payment Receipt ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
body { font-family:Arial,Helvetica,sans-serif; color:#1B1B24; background:#f6f3ee; margin:0; padding:24px; } .sheet { max-width:720px; margin:0 auto; background:#fff; border:1px solid #eadfd0; border-radius:16px; overflow:hidden; } .header { background:#900C27; color:#fff; padding:28px 32px; display:flex; justify-content:space-between; gap:16px; } h1 { margin:0; font-size:22px; } .header p { margin:6px 0 0; font-size:12px; opacity:.9; } .badge { background:#fff; color:#900C27; font-weight:700; font-size:11px; letter-spacing:.08em; padding:6px 10px; border-radius:999px; height:fit-content; } .body { padding:28px 32px; } .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:24px; } .label { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#7a7168; margin-bottom:4px; } .value { font-size:14px; font-weight:700; } .meta { font-size:12px; color:#5d564e; line-height:1.6; } .item { border-top:1px solid #eadfd0; border-bottom:1px solid #eadfd0; padding:16px 0; display:flex; justify-content:space-between; gap:16px; } .total { background:#FDF2F4; border-radius:12px; padding:16px 18px; display:flex; justify-content:space-between; font-size:18px; font-weight:800; color:#900C27; margin-top:20px; } .note { margin-top:14px; padding:10px 12px; background:#f7f4ef; border-radius:8px; font-size:12px; color:#5d564e; } .footer { padding:0 32px 28px; font-size:11px; color:#8a8178; } @media print { body { background:#fff; padding:0; } .sheet { border:none; } }
</style></head><body><div class="sheet"><div class="header"><div><h1>${escapeHtml(academyName)}</h1><p>${escapeHtml(academyAddress)}</p>${academyEmail ? `<p>${escapeHtml(academyEmail)}${academyPhone ? ` · ${escapeHtml(academyPhone)}` : ""}</p>` : ""}</div><div class="badge">PAYMENT RECEIVED</div></div><div class="body"><div class="grid"><div><div class="label">Received From</div><div class="value">${escapeHtml(invoice.studentName)}</div><div class="meta">${escapeHtml(invoice.studentEmail)}<br/>${escapeHtml(invoice.studentPhone)}</div></div><div><div class="label">Receipt Number</div><div class="value">${escapeHtml(invoice.invoiceNumber)}</div><div class="meta">Issued: ${escapeHtml(formatDate(invoice.issuedAt))}<br/>Transaction: ${escapeHtml(invoice.transactionId)}</div></div></div><div class="item"><div><div class="value">${escapeHtml(invoice.courseTitle || "Course Enrollment")}</div><div class="meta">${escapeHtml(invoice.batchName || "Enrollment")} · ${escapeHtml(method)}</div></div><div class="value">${escapeHtml(formatINR(invoice.amount, invoice.currency))}</div></div><div class="total"><span>Total Amount Received</span><span>${escapeHtml(formatINR(invoice.amount, invoice.currency))}</span></div>${showGstIncluded ? '<div class="note">GST is included in the amount received.</div>' : ""}</div><div class="footer">This is a computer-generated payment receipt. No signature is required.</div></div></body></html>`;
};

/** Backwards-compatible internal/admin invoice renderer. */
export const buildInvoiceHtml = buildCaTaxInvoiceHtml;

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

/**
 * Generates a PDF buffer from an HTML string using Puppeteer.
 */
export const generatePdfBuffer = async (html: string): Promise<Buffer> => {
  const puppeteer = (await import("puppeteer")).default;
  const windowsChromePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
  ].filter((path): path is string => Boolean(path && fs.existsSync(path)));

  const browser = await puppeteer.launch({
    headless: true,
    // Puppeteer's downloaded Chrome can fail to start on some Windows setups.
    // Prefer an explicitly configured browser or the locally installed Chrome.
    executablePath: process.platform === "win32" ? windowsChromePaths[0] : undefined,
    // These flags are required by some Linux containers, but can prevent a
    // normal Windows Chrome launch. Windows uses its default sandbox instead.
    args: process.platform === "linux" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
};
