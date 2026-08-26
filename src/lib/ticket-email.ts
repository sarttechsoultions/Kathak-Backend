import { sendEmail } from "./mailer";

export type TicketEmailPayload = {
  bookingId: string;
  eventTitle: string;
  eventCategory: string;
  dateLabel: string;
  timeLabel: string;
  venue: string;
  attendeeName: string;
  email: string;
  phone: string;
  quantity: number;
  ticketBreakdown?: string;
  amountLabel: string;
};

export function ticketQrUrl(bookingId: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(bookingId)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildTicketEmailHtml(ticket: TicketEmailPayload): string {
  const qr = ticketQrUrl(ticket.bookingId);

  return `
  <div style="margin:0;padding:24px;background:#fbf2ed;font-family:Arial,Helvetica,sans-serif;color:#1e1b18;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #f0e4e6;border-radius:12px;overflow:hidden;">
      <div style="background:#c10f3a;color:#ffffff;padding:20px 24px;">
        <p style="margin:0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;">Kathak by Harshita</p>
        <h1 style="margin:8px 0 0;font-size:24px;">Your ticket is confirmed</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          Namaste ${escapeHtml(ticket.attendeeName)},<br />
          Your booking for <strong>${escapeHtml(ticket.eventTitle)}</strong> is confirmed. Please keep this email with you at the venue.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr>
            <td style="padding:8px 0;color:#8a7174;width:140px;">Booking ID</td>
            <td style="padding:8px 0;font-weight:bold;color:#c10f3a;">${escapeHtml(ticket.bookingId)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#8a7174;">Event</td>
            <td style="padding:8px 0;">${escapeHtml(ticket.eventTitle)} (${escapeHtml(ticket.eventCategory)})</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#8a7174;">Date &amp; Time</td>
            <td style="padding:8px 0;">${escapeHtml(ticket.dateLabel)} • ${escapeHtml(ticket.timeLabel)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#8a7174;">Venue</td>
            <td style="padding:8px 0;">${escapeHtml(ticket.venue)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#8a7174;">Tickets</td>
            <td style="padding:8px 0;">${escapeHtml(ticket.ticketBreakdown || `${ticket.quantity} seat${ticket.quantity === 1 ? "" : "s"}`)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#8a7174;">Amount</td>
            <td style="padding:8px 0;">${escapeHtml(ticket.amountLabel)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#8a7174;">Phone</td>
            <td style="padding:8px 0;">${escapeHtml(ticket.phone)}</td>
          </tr>
        </table>
        <div style="margin-top:24px;text-align:center;">
          <img src="${qr}" alt="Ticket QR code" width="160" height="160" style="border:1px solid #eee8e8;border-radius:8px;" />
          <p style="margin:10px 0 0;font-size:12px;color:#8a7174;">Show this QR code at the entrance</p>
        </div>
      </div>
    </div>
  </div>
  `;
}

export async function sendEventTicketEmail(ticket: TicketEmailPayload): Promise<boolean> {
  return sendEmail({
    to: ticket.email,
    subject: `Your ticket for ${ticket.eventTitle} — ${ticket.bookingId}`,
    html: buildTicketEmailHtml(ticket),
  });
}
