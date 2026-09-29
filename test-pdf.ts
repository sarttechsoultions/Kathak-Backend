
import { generatePdfBuffer, buildStudentPaymentReceiptHtml, InvoiceData } from "./src/lib/invoice";

async function main() {
  const invoice: InvoiceData = {
    invoiceNumber: "INV-123",
    issuedAt: new Date(),
    studentName: "John Doe",
    studentEmail: "john@example.com",
    studentPhone: "1234567890",
    courseTitle: "Kathak Beginner",
    amount: 3600,
    currency: "INR",
    gateway: "CASH",
    transactionId: "TXN123",
    orderId: null,
    status: "PAID",
  };
  const html = buildStudentPaymentReceiptHtml(invoice);
  console.log("HTML length:", html.length);
  const pdf = await generatePdfBuffer(html);
  console.log("PDF length:", pdf.length);
}

main().catch(console.error);

