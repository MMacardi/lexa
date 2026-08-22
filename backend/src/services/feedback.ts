import { env } from "../lib/env.js";
import { sendEmail, emailConfigured, type MailAttachment } from "./mailer.js";

// Delivers in-app beta bug reports to the project owner. Two independent channels
// so a report is never lost during the beta: email (needs SMTP_URL) and Telegram
// (needs TELEGRAM_BOT_TOKEN). In pure local dev with neither configured, the
// report is logged to the server console instead.

export interface FeedbackReport {
  message: string;
  kind: "bug" | "idea" | "other";
  telegramId?: string | null;
  url?: string;
  route?: string;
  userAgent?: string;
  viewport?: string;
  locale?: string;
  appLang?: string;
  theme?: string;
  errors?: { message: string; source?: string; time?: string }[];
  screenshot?: string; // data URL (image/png|jpeg), optional
}

export interface DeliveryResult {
  email: boolean;
  telegram: boolean;
  logged: boolean;
}

const KIND_LABEL: Record<FeedbackReport["kind"], string> = {
  bug: "🐞 Bug",
  idea: "💡 Idea",
  other: "💬 Feedback",
};

// Decode a "data:image/png;base64,…" URL into a raw buffer + filename, or null.
function decodeScreenshot(dataUrl?: string): { buffer: Buffer; filename: string; contentType: string } | null {
  if (!dataUrl) return null;
  const m = /^data:(image\/(png|jpeg));base64,([\s\S]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const buffer = Buffer.from(m[3], "base64");
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return null; // sane cap
    const ext = m[2] === "jpeg" ? "jpg" : "png";
    return { buffer, filename: `screenshot.${ext}`, contentType: m[1] };
  } catch {
    return null;
  }
}

function plainSummary(r: FeedbackReport): string {
  const lines = [
    `${KIND_LABEL[r.kind]} report`,
    "",
    r.message.trim(),
    "",
    "— context —",
    `user:     ${r.telegramId ?? "anonymous"}`,
    `page:     ${r.route ?? r.url ?? "?"}`,
    r.url && r.url !== r.route ? `url:      ${r.url}` : "",
    `lang:     ${r.appLang ?? "?"}   locale: ${r.locale ?? "?"}   theme: ${r.theme ?? "?"}`,
    `viewport: ${r.viewport ?? "?"}`,
    `agent:    ${r.userAgent ?? "?"}`,
  ].filter(Boolean);
  if (r.errors?.length) {
    lines.push("", `— captured errors (${r.errors.length}) —`);
    for (const e of r.errors.slice(0, 20)) {
      lines.push(`• [${e.source ?? "js"}] ${e.message}${e.time ? `  (${e.time})` : ""}`);
    }
  }
  return lines.join("\n");
}

function htmlSummary(r: FeedbackReport, hasShot: boolean): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const row = (k: string, v?: string) =>
    v ? `<tr><td style="padding:2px 10px 2px 0;color:#a89f8f;">${k}</td><td style="padding:2px 0;">${esc(v)}</td></tr>` : "";
  const errs = r.errors?.length
    ? `<h4 style="margin:16px 0 6px;color:#9c5f4e;">Captured errors (${r.errors.length})</h4>` +
      `<ul style="margin:0;padding-left:18px;color:#544e45;font-family:monospace;font-size:12px;">` +
      r.errors
        .slice(0, 20)
        .map((e) => `<li>[${esc(e.source ?? "js")}] ${esc(e.message)}</li>`)
        .join("") +
      `</ul>`
    : "";
  return `
  <div style="font-family:Georgia,serif;color:#2e2a26;max-width:640px;">
    <h2 style="margin:0 0 4px;">${KIND_LABEL[r.kind]} — Lexa beta</h2>
    <p style="white-space:pre-wrap;font-size:15px;line-height:1.5;background:#f4f1ec;padding:12px 14px;border-radius:10px;">${esc(
      r.message.trim(),
    )}</p>
    <table style="font-size:13px;color:#544e45;border-collapse:collapse;">
      ${row("user", r.telegramId ?? "anonymous")}
      ${row("page", r.route ?? r.url)}
      ${row("url", r.url && r.url !== r.route ? r.url : undefined)}
      ${row("lang / locale", `${r.appLang ?? "?"} / ${r.locale ?? "?"}`)}
      ${row("theme", r.theme)}
      ${row("viewport", r.viewport)}
      ${row("agent", r.userAgent)}
    </table>
    ${errs}
    ${hasShot ? `<h4 style="margin:16px 0 6px;">Screenshot</h4><img src="cid:shot" style="max-width:100%;border:1px solid #ddd;border-radius:8px;" />` : ""}
  </div>`;
}

async function sendTelegram(chatId: string, r: FeedbackReport, shot: ReturnType<typeof decodeScreenshot>): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const caption = plainSummary(r).slice(0, 1000); // Telegram caption cap ~1024
    if (shot) {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", caption);
      form.append("photo", new Blob([new Uint8Array(shot.buffer)], { type: shot.contentType }), shot.filename);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
      return res.ok;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: plainSummary(r).slice(0, 4000) }),
    });
    return res.ok;
  } catch (e) {
    console.error("[feedback] telegram send failed", e);
    return false;
  }
}

export async function deliverFeedback(report: FeedbackReport): Promise<DeliveryResult> {
  const shot = decodeScreenshot(report.screenshot);
  const subject = `[Lexa ${report.kind}] ${report.message.trim().slice(0, 60).replace(/\s+/g, " ")}`;
  const result: DeliveryResult = { email: false, telegram: false, logged: false };

  // Email channel.
  const to = env.FEEDBACK_EMAIL.trim();
  if (to) {
    const attachments: MailAttachment[] = shot
      ? [{ filename: shot.filename, content: shot.buffer, contentType: shot.contentType }]
      : [];
    // Reference the attachment inline via a cid so it renders in the body too.
    if (shot) attachments[0].cid = "shot";
    try {
      await sendEmail(to, subject, htmlSummary(report, Boolean(shot)), plainSummary(report), attachments);
      result.email = emailConfigured(); // false in dev (it only logs) → fall through to log
    } catch (e) {
      console.error("[feedback] email send failed", e);
    }
  }

  // Telegram channel (owner chat).
  const chatId = env.FEEDBACK_TELEGRAM_CHAT.trim() || env.PRO_ALLOWLIST.split(",")[0]?.trim() || "";
  if (chatId) result.telegram = await sendTelegram(chatId, report, shot);

  if (!result.email && !result.telegram) {
    console.log(`[feedback] (no channel configured)\n${plainSummary(report)}`);
    result.logged = true;
  }
  return result;
}
