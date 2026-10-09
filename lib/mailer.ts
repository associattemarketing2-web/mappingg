import nodemailer, { type Transporter } from 'nodemailer';

// Outgoing email over SMTP (Gmail with an App password by default): sign-up and
// password-reset codes, welcome mails and account / project notifications.
//
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS — the mailbox that sends
//   MAIL_FROM            — "Name <address>" shown as the sender
//   ADMIN_NOTIFY_EMAIL   — inbox that gets a copy of every notification
//
// sendMail() never throws: a mail that can't go out is logged, and the request
// that triggered it carries on. Only OTP sending checks the result.

const g = globalThis as unknown as { __mailer?: Transporter };

export function mailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transporter(): Transporter {
  if (!g.__mailer) {
    const port = Number(process.env.SMTP_PORT || 465);
    g.__mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      // Google shows App passwords as "abcd efgh ijkl mnop" — the spaces aren't part of it.
      auth: { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS || '').replace(/\s+/g, '') },
      pool: true,
      maxConnections: 3,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return g.__mailer;
}

/** Inboxes that get a copy of every notification. */
export function adminEmails(): string[] {
  const list = process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_USER || '';
  return list.split(',').map((s) => s.trim()).filter(Boolean);
}

const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com').replace(/\/$/, '');

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The shared email layout: heading, paragraphs (already-escaped HTML), optional detail rows and button. */
export function layout(o: { title: string; body: string[]; rows?: [string, unknown][]; cta?: { label: string; href: string } }): string {
  const rows = (o.rows || []).filter(([, v]) => v !== undefined && v !== null && String(v) !== '');
  const table = rows.length
    ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">${rows
        .map(([k, v]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #eef0f4;color:#6b7280;width:38%">${esc(k)}</td><td style="padding:8px 10px;border-bottom:1px solid #eef0f4;color:#111827">${esc(v)}</td></tr>`)
        .join('')}</table>`
    : '';
  const cta = o.cta
    ? `<p style="margin:22px 0 4px"><a href="${esc(o.cta.href.startsWith('http') ? o.cta.href : SITE() + o.cta.href)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(o.cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="font-size:20px;font-weight:700;color:#111827;margin-bottom:14px">Mappingg<span style="color:#2563eb">.com</span></div>
  <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
    <h2 style="margin:0 0 12px;font-size:19px;color:#111827">${esc(o.title)}</h2>
    ${o.body.map((p) => `<p style="margin:0 0 10px;color:#374151;font-size:15px;line-height:1.55">${p}</p>`).join('')}
    ${table}${cta}
  </div>
  <p style="color:#9ca3af;font-size:12px;margin:14px 4px">This is an automatic message from <a href="${esc(SITE())}" style="color:#9ca3af">Mappingg.com</a>.</p>
</div></body></html>`;
}

export async function sendMail(m: { to: string | string[]; subject: string; html: string; text?: string; replyTo?: string }): Promise<boolean> {
  const to = (Array.isArray(m.to) ? m.to : [m.to]).map((s) => s.trim()).filter(Boolean);
  if (!to.length) return false;
  if (!mailConfigured()) {
    console.warn('[mail] SMTP is not configured — skipped:', m.subject);
    return false;
  }
  try {
    await transporter().sendMail({
      from: process.env.MAIL_FROM || `Mappingg <${process.env.SMTP_USER}>`,
      to: to.join(', '),
      subject: m.subject,
      html: m.html,
      text: m.text || m.html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      replyTo: m.replyTo,
    });
    return true;
  } catch (e) {
    console.warn('[mail] could not send', m.subject, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Fire-and-forget: for notifications that must not slow down the request. */
export function queueMail(m: Parameters<typeof sendMail>[0]): void {
  void sendMail(m);
}

/** Copy of a notification to the Mappingg team inbox. */
export function notifyAdmin(subject: string, o: Parameters<typeof layout>[0], replyTo?: string): void {
  const to = adminEmails();
  if (to.length) queueMail({ to, subject: `[Mappingg] ${subject}`, html: layout(o), replyTo });
}
