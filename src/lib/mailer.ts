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
  html: string;
  attachments?: EmailAttachment[];
}

const fromAddress = () =>
  env.smtp.from || `"Kathak Academy" <${env.smtp.user}>`;

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
      html,
      attachments,
    });
    console.log(`Email sent via SMTP to ${to}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
