import dns from "node:dns/promises";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../config/env";

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  /** Dynamic, email-specific content. Branding and footer are applied centrally. */
  html: string;
  attachments?: EmailAttachment[];
}

const fromAddress = () =>
  env.smtp.from || `"Kathak Academy" <${env.smtp.user}>`;

/**
 * The academy's single source of truth for automated email branding.
 * Callers provide only their message-specific HTML through sendEmail().
 */
export const buildKathakMasterEmail = (content: string): string => `
<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  </head>
  <body style="margin:0; padding:0; background:#f7f4f2; color:#282020; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f4f2; margin:0; padding:0; width:100%;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px; background:#ffffff; border:1px solid #eadde0; border-radius:16px; overflow:hidden;">
          <tr><td style="background:#900C27; padding:26px 28px; text-align:center;">
            <img src="https://www.kathakbyharshita.com/logo.png" alt="Kathak by Harshita Academy" width="112" style="display:block; max-width:112px; height:auto; margin:0 auto 10px; border:0;" />
            <div style="color:#ffffff; font-size:22px; font-weight:700; line-height:1.25;">Kathak by Harshita Academy</div>
            <div style="color:#ffe8ed; font-size:12px; letter-spacing:.08em; margin-top:7px; text-transform:uppercase;">Preserving Tradition &bull; Inspiring Generations</div>
          </td></tr>
          <tr><td style="padding:30px 28px 12px; font-size:15px; line-height:1.65; color:#33292b;">
            <p style="margin:0 0 18px;">Namaste,</p>
            ${content}
          </td></tr>
          <tr><td style="padding:18px 28px 28px; font-size:14px; line-height:1.65; color:#4b3a3d;">
            <p style="margin:0 0 2px;">Thanks &amp; Regards,</p>
            <p style="margin:0 0 18px; font-weight:700; color:#900C27;">Kathak by Harshita Academy Team</p>
            <div style="border-top:1px solid #eadde0; padding-top:18px; color:#6d5a5e; font-size:13px;">
              <p style="margin:0 0 5px;">&#127760; <a href="https://www.kathakbyharshita.com" style="color:#900C27; text-decoration:none;">www.kathakbyharshita.com</a></p>
              <p style="margin:0 0 5px;">&#128231; <a href="mailto:kathakbyharshita@gmail.com" style="color:#900C27; text-decoration:none;">kathakbyharshita@gmail.com</a></p>
              <p style="margin:0 0 5px;">&#128222; <a href="tel:+919079192223" style="color:#900C27; text-decoration:none;">+91 9079192223</a></p>
              <p style="margin:0 0 16px;">&#128248; <a href="https://www.instagram.com/kathakbyharshita" style="color:#900C27; text-decoration:none;">Instagram: @kathakbyharshita</a></p>
              <p style="margin:0 0 12px; font-weight:700; color:#6b2635;">Preserving Tradition &bull; Inspiring Generations &bull; Connecting Kathak Globally</p>
              <p style="margin:0 0 12px;">Need help? Please contact our support team through the official contact details above.</p>
              <p style="margin:0; font-size:11px; line-height:1.55; color:#907d81;">This is an automated email from Kathak by Harshita Academy. Please do not share confidential booking, payment, login or class-access information with unauthorized persons.</p>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const createSmtpTransport = async () => {
  const hostName = env.smtp.host;
  const port = env.smtp.port;
  const secure = port === 465;
  const { address } = await dns.lookup(hostName, { family: 4 });

  const options: SMTPTransport.Options = {
    host: address,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
    tls: {
      minVersion: "TLSv1.2",
      servername: hostName,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  };

  return nodemailer.createTransport(options);
};

export const sendEmail = async ({ to, subject, html, attachments }: EmailOptions): Promise<boolean> => {
  if (!env.smtp.user || !env.smtp.pass) {
    console.error("SMTP_USER / SMTP_PASS are missing on the server. Email cannot be sent.");
    return false;
  }

  try {
    const transporter = await createSmtpTransport();
    const info = await transporter.sendMail({
      from: fromAddress(),
      to,
      subject,
      html: buildKathakMasterEmail(html),
      attachments,
    });
    console.log(`Email sent via SMTP to ${to}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`[SMTP_FAILURE] Failed to send email to ${to} (Subject: "${subject}"):`, error);
    return false;
  }
};
