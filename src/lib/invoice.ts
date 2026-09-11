import { GstCalculationResult } from "./gst";
import { BUSINESS_DETAILS } from "./businessConfig";
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
  enrollmentId?: string;
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
  const academyUdyamRegistration =
    invoice.snapshot?.udyamRegistration || BUSINESS_DETAILS.udyamRegistration || "";
  const studentState = invoice.snapshot?.studentState || "";
  const sacCode = invoice.snapshot?.sacCode || process.env.GST_SAC_CODE || "999291";
  const sacDescription = invoice.snapshot?.sacDescription || process.env.GST_SAC_DESCRIPTION || "Cultural education services";

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
        ${academyUdyamRegistration ? `<p><strong>Udyam Reg. No.:</strong> ${escapeHtml(academyUdyamRegistration)}</p>` : ''}
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
            <th style="width:42%">Description</th>
            <th style="width:17%">SAC</th>
            <th style="width:17%">Batch</th>
            <th style="width:24%; text-align:right">Taxable Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><div class="service-name">${escapeHtml(invoice.courseTitle || "Course Enrollment")}</div><div class="service-note">Course enrollment fee · Payment method: ${escapeHtml(method)}</div></td>
            <td><strong>${escapeHtml(sacCode)}</strong><div class="service-note">${escapeHtml(sacDescription)}</div></td>
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

/** Professional Student-facing Tax Invoice / Payment Receipt. */
export const buildStudentPaymentReceiptHtml = (invoice: InvoiceData): string => {
  const { amountToWords } = require("./currencyToWords");
  const s = invoice.snapshot || {};

  const tradeName = s.academyName || "KATHAK BY HARSHITA ACADEMY";
  const legalName = s.legalName || "HARSHITA SHARMA";
  const academyGstin = s.academyGstin || "08IKFPS1574G1ZQ";
  const udyam = s.udyamRegistration || "UDYAM-RJ-17-0681091";
  const academyAddress = s.academyAddress || "PLOT NO 60, GULAB BADI, Road Number 17, Vishwakarma Industrial Area, Jaipur, Rajasthan - 302013";
  
  const method = s.paymentMode || invoice.paymentMethod || invoice.gateway || "Online";
  const months = s.months || 1;
  const amountWords = amountToWords(invoice.amount);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payment Receipt ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin:0; padding:24px; background:#f2f4f7; color:#182230; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.5; }
    .sheet { width:100%; max-width:794px; min-height:1080px; margin:0 auto; background:#fff; border:1px solid #dde3ea; position: relative; display: flex; flex-direction: column; }
    .top-line { height:6px; background:#990d2e; }
    .header { padding:40px 40px 30px; text-align: center; border-bottom: 1px solid #e8ecf1; }
    .trade-name { margin:0 0 8px; color:#990d2e; font-size:28px; line-height:1.2; font-weight:800; text-transform: uppercase; letter-spacing: 1px; }
    .legal-details { font-size: 12px; color: #475467; margin-bottom: 12px; }
    .legal-details span { margin: 0 8px; color: #d0d5dd; }
    .address { font-size: 12px; color: #475467; max-width: 70%; margin: 0 auto; }
    .doc-title { text-align: center; padding: 16px 0; background: #fdfafb; border-bottom: 1px solid #e8ecf1; font-size: 18px; font-weight: 800; letter-spacing: 2px; color: #101828; }
    .content { padding: 40px; flex-grow: 1; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px; }
    .section-title { font-size: 11px; font-weight: 700; color: #667085; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e8ecf1; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .info-label { color: #475467; }
    .info-val { font-weight: 600; color: #101828; text-align: right; }
    .student-name { font-size: 18px; font-weight: 700; color: #101828; margin-bottom: 4px; }
    .student-contact { color: #475467; line-height: 1.6; }
    .total-box { background: #FDF2F4; border: 2px solid #F9D0D6; border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 32px; }
    .total-label { font-size: 14px; font-weight: 700; color: #990d2e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .total-amount { font-size: 42px; font-weight: 800; color: #990d2e; line-height: 1; margin-bottom: 16px; }
    .amount-words { font-size: 15px; font-weight: 600; color: #475467; background: #fff; padding: 12px 24px; border-radius: 8px; display: inline-block; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
    .course-details { background: #f9fafb; border: 1px solid #e8ecf1; border-radius: 12px; padding: 24px; }
    .course-title { font-size: 16px; font-weight: 700; color: #101828; margin-bottom: 16px; text-align: center; }
    .course-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center; }
    .course-stat-label { font-size: 11px; color: #667085; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 4px; }
    .course-stat-val { font-size: 15px; font-weight: 700; color: #101828; }
    .footer { padding: 32px 40px; border-top: 1px solid #e8ecf1; background: #fff; text-align: center; color: #667085; font-size: 12px; line-height: 1.6; }
    .thank-you { font-size: 15px; font-weight: 700; color: #101828; margin-bottom: 8px; }
    @media print { body { padding:0; background:#fff; } .sheet { border:none; max-width:none; min-height:100vh; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="top-line"></div>
    <div class="header">
      <h1 class="trade-name">${escapeHtml(tradeName)}</h1>
      <div class="legal-details">
        <strong>GSTIN:</strong> ${escapeHtml(academyGstin)} <span>|</span>
        <strong>Udyam Reg. No.:</strong> ${escapeHtml(udyam)}
      </div>
      <div class="address">${escapeHtml(academyAddress)}</div>
    </div>
    
    <div class="doc-title">PAYMENT RECEIPT</div>
    
    <div class="content">
      <div class="grid-2">
        <div>
          <div class="section-title">Received From</div>
          <div class="student-name">${escapeHtml(invoice.studentName)}</div>
          <div class="student-contact">
            ${invoice.studentAddress ? escapeHtml(invoice.studentAddress) + '<br/>' : ''}
            ${s.studentState ? escapeHtml(s.studentState) + '<br/>' : ''}
            ${escapeHtml(invoice.studentPhone)}<br/>
            ${escapeHtml(invoice.studentEmail)}
          </div>
        </div>
        <div>
          <div class="section-title">Payment Details</div>
          <div class="info-row">
            <span class="info-label">Receipt No:</span>
            <span class="info-val">${escapeHtml(invoice.invoiceNumber)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Date:</span>
            <span class="info-val">${escapeHtml(formatDate(invoice.issuedAt))}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Status:</span>
            <span class="info-val" style="color: #027A48;">PAID</span>
          </div>
          <div class="info-row">
            <span class="info-label">Payment Mode:</span>
            <span class="info-val">${escapeHtml(method)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Transaction ID:</span>
            <span class="info-val">${escapeHtml(invoice.transactionId)}</span>
          </div>
          ${invoice.enrollmentId ? `
          <div class="info-row">
            <span class="info-label">Enrollment ID:</span>
            <span class="info-val">${escapeHtml(invoice.enrollmentId)}</span>
          </div>` : ''}
        </div>
      </div>

      <div class="total-box">
        <div class="total-label">Total Amount Paid</div>
        <div class="total-amount">${escapeHtml(formatINR(invoice.amount, invoice.currency))}</div>
        <div class="amount-words">${escapeHtml(amountWords)}</div>
      </div>

      <div class="course-details">
        <div class="course-title">Enrollment Summary</div>
        <div class="course-grid">
          <div>
            <div class="course-stat-label">Course</div>
            <div class="course-stat-val">${escapeHtml(invoice.courseTitle || "Course Enrollment")}</div>
          </div>
          <div>
            <div class="course-stat-label">Batch</div>
            <div class="course-stat-val">${escapeHtml(invoice.batchName || "—")}</div>
          </div>
          <div>
            <div class="course-stat-label">Period</div>
            <div class="course-stat-val">${months} Month(s)</div>
          </div>
        </div>
      </div>
    </div>

    <div class="footer">
      <div class="thank-you">Thank you for your payment!</div>
      This is a computer-generated payment receipt. No physical signature is required.<br/>
      For detailed tax invoice, please refer to the academy administration.
    </div>
  </div>
</body>
</html>`;
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
