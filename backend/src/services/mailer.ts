import nodemailer from "nodemailer";
import { env } from "../lib/env.js";

// Thin email sender. With SMTP_URL configured we send for real; otherwise we log
// the message (dev) so magic-link flows are testable without an email provider.

const transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  if (!transport) {
    console.log(`[mailer:dev] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  await transport.sendMail({ from: env.EMAIL_FROM, to, subject, html, text });
}

export function emailConfigured(): boolean {
  return Boolean(transport);
}
