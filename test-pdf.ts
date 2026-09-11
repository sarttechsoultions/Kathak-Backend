import { buildStudentPaymentReceiptHtml, generatePdfBuffer, InvoiceData } from './src/lib/invoice';
import fs from 'fs';

const invoice: InvoiceData = {
  invoiceNumber: 'KATHAK-2026-000125',
  issuedAt: new Date(),
  studentName: 'Priya Sharma',
  studentEmail: 'priya@example.com',
  studentPhone: '+919876543211',
  courseTitle: 'Kathak Basics - Beginners',
  batchName: 'Weekend Morning Batch',
  amount: 3300,
  currency: 'INR',
  gateway: 'RAZORPAY',
  transactionId: 'pay_mock_987654321',
  orderId: null,
  status: 'PAID',
  enrollmentId: 'enr_mock_124',
  snapshot: {
    months: 1,
    monthlyBaseAmount: 2200,
    joiningFeeApplied: 1100,
    discountAmount: 0,
    academyName: "KATHAK BY HARSHITA ACADEMY",
    legalName: "HARSHITA SHARMA",
    academyGstin: "08IKFPS1574G1ZQ",
    udyamRegistration: "UDYAM-RJ-17-0681091",
    academyAddress: "PLOT NO 60, GULAB BADI, Road Number 17, Vishwakarma Industrial Area, Jaipur, Rajasthan - 302013",
  }
};

const html = buildStudentPaymentReceiptHtml(invoice);
fs.writeFileSync('test-receipt-simplified.html', html);

generatePdfBuffer(html).then(buffer => {
  fs.writeFileSync('test-receipt-simplified.pdf', buffer);
  console.log('PDF generated at backend/test-receipt-simplified.pdf');
}).catch(err => {
  console.error('PDF generation failed:', err);
});
