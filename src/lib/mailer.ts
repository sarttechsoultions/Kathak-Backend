import nodemailer from "nodemailer";
import { env } from "../config/env";

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.port === 465,
  auth: {
    user: env.smtp.user,
    pass: env.smtp.pass,
  },
});

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

export const sendEmail = async ({ to, subject, html, attachments }: EmailOptions): Promise<boolean> => {
  try {
    if (!env.smtp.user || !env.smtp.pass) {
      console.warn("SMTP credentials not configured. Skipping email send.");
      return false;
    }

    const info = await transporter.sendMail({
      from: env.smtp.from || `"Kathak Academy" <${env.smtp.user}>`,
      to,
      subject,
      html,
      attachments,
    });

    console.log(`Email sent successfully: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
