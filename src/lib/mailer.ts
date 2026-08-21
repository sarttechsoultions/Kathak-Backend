import nodemailer, { type Transporter } from "nodemailer";
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

const createSmtpTransport = (port: number): Transporter => {
  const isGmail = env.smtp.host.includes("gmail");
  const secure = port === 465;

  if (isGmail) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: env.smtp.user,
        pass: env.smtp.pass,
      },
      family: 4,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }

  return nodemailer.createTransport({
    host: env.smtp.host,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
    tls: {
      minVersion: "TLSv1.2",
    },
    family: 4,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
};

const sendViaSmtp = async (options: EmailOptions) => {
  const ports = env.smtp.port === 587 ? [587, 465] : [env.smtp.port, env.smtp.port === 465 ? 587 : 465];
  const uniquePorts = [...new Set(ports)];
  let lastError: unknown;

  for (const port of uniquePorts) {
    try {
      const transporter = createSmtpTransport(port);
      const info = await transporter.sendMail({
        from: fromAddress(),
        to: options.to,
        subject: options.subject,
        html: options.html,
        attachments: options.attachments,
      });
      console.log(`Email sent via SMTP:${port} to ${options.to}: ${info.messageId}`);
      return;
    } catch (error) {
      lastError = error;
      console.error(`SMTP send failed on port ${port}:`, error);
    }
  }

  throw lastError;
};

const sendViaResend = async (options: EmailOptions) => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend email failed (${res.status}): ${body}`);
  }

  console.log(`Email sent via Resend to ${options.to}`);
  return true;
};

export const sendEmail = async ({ to, subject, html, attachments }: EmailOptions): Promise<boolean> => {
  if (!env.smtp.user || !env.smtp.pass) {
    console.error("SMTP_USER / SMTP_PASS are missing on the server. Email cannot be sent.");
    return false;
  }

  try {
    if (process.env.RESEND_API_KEY?.trim() && !attachments?.length) {
      await sendViaResend({ to, subject, html, attachments });
      return true;
    }

    await sendViaSmtp({ to, subject, html, attachments });
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
