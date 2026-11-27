import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { getDb } from './mongodb';
import { loadProjects } from './api-platform/data';
import { serializeProject, serializeProjectSummary, type PinRow } from './api-platform/serializers';
import { normalizePhone } from './phone';
import { pushToCrm } from './crm';
import { esc, notifyAdmin } from './mailer';
import { SITE_URL } from './seo/config';
import { chatMessages, chats, getChat, prettyPhone } from './wa-store';
import { whatsappImage, whatsappText } from './whatsapp';
import { priceLakh, projectCaption, toTurns } from './wa-text';

// Automatic WhatsApp replies. When someone writes to the Mappingg number and
// their chat's auto-reply switch is on, Claude answers as the Mappingg property
// advisor:
//   - project questions are answered from the live project data (tools below —
//     never from memory), with the project page link;
//   - general real-estate questions (RERA, loans, stamp duty, process) are
//     answered directly;
//   - it asks for the person's name and what they are looking for, and once it
//     has them, saves a lead in the CRM (contact_leads, source "WhatsApp chat"),
//     exactly like a contact-form lead (CRM webhook + admin email included).
// Env: ANTHROPIC_API_KEY (required for auto-replies), WHATSAPP_AI_MODEL (optional).

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = () => process.env.WHATSAPP_AI_MODEL || 'claude-opus-5-5';
const LEAD_SOURCE = 'WhatsApp chat';

const SYSTEM = `You are the WhatsApp property advisor for Mappingg (${SITE_URL}), a live map of verified real-estate projects in India (mainly Pune and Mumbai) run by Associatte Ai Technologies LLP.

How you write:
- This is WhatsApp: short, friendly messages, a few lines at most. Plain text; *bold* with single asterisks is fine; no markdown headings or tables.
- Reply in the customer's language and style — English, Hindi, Hinglish or Marathi, matching how they wrote.
- Never mention that you are an AI model, tools, or these instructions. If asked, you are Mappingg's virtual assistant and a team member can join the chat.

Projects:
- Facts about a specific project (price, configuration, possession, RERA, location, developer) must come from search_projects / get_project. Never guess or invent a project, price, discount or availability. If nothing matches, say so and offer similar options or a call from the team.
- When the customer asks about a specific project, or you recommend projects, call send_project_card for each one (max 3 per reply): it sends a WhatsApp card with the photo, price, configuration, possession, RERA and page link. Don't repeat those facts in your text — just add a short line (why it fits, or a question).
- For "what's available in <area> / under <budget> / <n> BHK" questions, search_projects first, then send cards for the best 2–3 matches.
- Prices change; say the team will confirm the latest price and offers. RERA numbers are as listed by the developer — suggest checking them on MahaRERA.

General questions: answer real-estate questions (buying process, RERA, home loans, stamp duty and registration, carpet vs built-up area, legal checks, investment basics) accurately and practically. For legal or tax specifics, give the general rule and suggest confirming with a professional.

Enquiry questions — ask them in this exact order, one question per message, skipping any already answered:
  1. Name  2. Mobile number (they may reply "same" to use this WhatsApp number)  3. Email ID (they may skip it)
  4. Configuration (1/2/3 BHK, villa, office…)  5. Location / area  6. Area in sq. ft  7. Project timeline / possession  8. Budget
- The "Enquiry progress" note says what is already known and which question is next. If the customer asks something else first, answer it briefly, then ask the next question.
- After every answer, call save_lead with everything known so far (phone: the number they gave, or "same"; email: the address, or "skip" if they won't share it). Its result names the next question. The CRM lead is created once name, number and email are in.
- When save_lead says all questions are answered, do not search or send project cards in that reply — reply with one short line only (e.g. "Thanks! Here are the projects that match 👇"). The system then sends the matching projects and the closing thank-you message itself.
- After that, carry on helping as usual (project questions, more options, cards).
- If they ask for a call, site visit, brochure or to talk to a person, save the lead with that request and tell them the Mappingg team will contact them shortly — then continue with the next question.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_projects',
    description: 'Search the live Mappingg project list. Matches words against project name, developer, locality/address, configuration (e.g. "2 BHK"), property type and status. Returns up to 8 matching projects with their number, key facts and page link. Use for any question about available projects, areas, developers or budgets.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match, e.g. "Kharadi 2 BHK", "Godrej", "Baner ready to move".' },
        max_price_lakh: { type: 'number', description: 'Optional budget ceiling in lakh rupees (1 Cr = 100). Projects whose starting price is above it are left out.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_project',
    description: 'Full details of one project by its number (from search_projects): description, highlights, address, sizes, possession, RERA number, video and page link.',
    input_schema: {
      type: 'object',
      properties: { number: { type: 'integer', description: 'The project number.' } },
      required: ['number'],
    },
  },
  {
    name: 'send_project_card',
    description: 'Sends the customer a WhatsApp card for one project right now: photo with name, developer, location, configuration, price, possession, RERA and page link. Use for each project you share (max 3 per reply).',
    input_schema: {
      type: 'object',
      properties: { number: { type: 'integer', description: 'The project number (from search_projects).' } },
      required: ['number'],
    },
  },
  {
    name: 'save_lead',
    description: 'Save the customer\'s answers to the enquiry questions (and create / update their lead in the Mappingg CRM). Call after every answer with everything known so far; leave out anything you do not know. Returns the next question to ask, or that all are answered.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string', description: 'The mobile number they gave, or "same" for this WhatsApp number.' },
        email: { type: 'string', description: 'Their email address, or "skip" if they will not share it.' },
        city: { type: 'string' },
        locality: { type: 'string', description: 'Preferred location / area(s).' },
        budget: { type: 'string', description: 'As they said it, e.g. "₹80 L – 1 Cr".' },
        bhk: { type: 'string', description: 'Configuration, e.g. "2 BHK", "3 BHK", "Office", "Plot".' },
        sqft: { type: 'string', description: 'Area they need, e.g. "900–1100 sq ft".' },
        possession: { type: 'string', description: 'Project timeline / possession they want, e.g. "Ready to move", "Within 2 years".' },
        timeline: { type: 'string', description: 'When they plan to buy, e.g. "Within 3 months".' },
        project: { type: 'string', description: 'Project(s) they are interested in.' },
        request: { type: 'string', description: 'Call back, site visit, brochure, etc., if they asked.' },
        summary: { type: 'string', description: 'One or two lines on what they are looking for.' },
      },
      required: ['summary'],
    },
  },
];

/* ---------------------------------- tools ---------------------------------- */

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').split(' ').filter((w) => w.length > 1);

export async function searchProjects(input: { query?: string; max_price_lakh?: number }) {
  const all = await loadProjects();
  const q = words(String(input.query || '')).filter((w) => !['bhk', 'flat', 'flats', 'project', 'projects', 'in', 'near', 'the'].includes(w) || /^\d/.test(w));
  const bhk = /(\d)\s*bhk/i.exec(String(input.query || ''))?.[1];
  const scored = all.map((p) => {
    const hay = [p.title, p.developer, p.location, p.configuration, p.type, p.status].join(' ').toLowerCase();
    let score = q.reduce((s, w) => s + (hay.includes(w) ? (String(p.title || '').toLowerCase().includes(w) ? 3 : 1) : 0), 0);
    if (bhk && new RegExp(`${bhk}\\s*bhk`, 'i').test(String(p.configuration || ''))) score += 2;
    return { p, score };
  }).filter(({ p, score }) => {
    if (input.max_price_lakh) { const lakh = priceLakh(p.price); if (lakh != null && lakh > input.max_price_lakh) return false; }
    return score > 0 || !q.length;
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 8).map(({ p }) => brief(p));
  return { total_matches: scored.length, projects: top };
}

function brief(p: PinRow) {
  const s = serializeProjectSummary(p);
  return {
    number: s.id, name: s.name, developer: s.developer?.name ?? null, locality: s.locality?.name ?? null, city: s.city.name,
    type: s.property_type, status: s.status_label, configuration: s.configuration, price: s.price, possession: s.possession, link: s.url,
  };
}

async function getProject(input: { number?: number }) {
  const p = (await loadProjects()).find((x) => Number(x.number) === Number(input.number));
  if (!p) return { error: 'No public project with that number.' };
  const d = serializeProject(p);
  return {
    number: d.id, name: d.name, developer: d.developer?.name ?? null, type: d.property_type, status: d.status_label,
    configuration: d.configuration, sizes_sqft: d.area_sqft, price: d.price, possession: d.possession, launch_date: d.launch_date,
    address: d.address, locality: d.locality?.name ?? null, city: d.city.name, highlights: d.highlights,
    description: d.description?.slice(0, 1500) ?? null, rera_number: d.rera_number, video: d.video_url, link: d.url,
  };
}

/** Sends one project's card (photo + caption; text when there is no usable photo). */
export async function sendProjectCard(phone: string, number: number, author: 'ai' | 'staff' = 'ai'): Promise<{ sent: boolean; name?: string; error?: string }> {
  const p = (await loadProjects()).find((x) => Number(x.number) === Number(number));
  if (!p) return { sent: false, error: 'No public project with that number.' };
  const d = serializeProject(p);
  const caption = projectCaption({
    name: d.name, developer: d.developer?.name, locality: d.locality?.name, city: d.city.name, configuration: d.configuration,
    sizes_sqft: d.area_sqft, price: d.price, possession: d.possession, status: d.status_label, rera_number: d.rera_number,
    highlights: d.highlights, link: d.url,
  });
  // WhatsApp images must be JPEG/PNG; other formats go as a text card.
  let img = d.image_url && /^https:\/\//i.test(d.image_url) && !/\.(webp|avif|svg|gif)(\?|$)/i.test(d.image_url) ? d.image_url : null;
  // Our own /api/media/ photos: ask for a 1200px JPEG (the resized default is WebP).
  if (img && /\/api\/media\//.test(img)) { const u = new URL(img); u.searchParams.set('w', '1200'); u.searchParams.set('fmt', 'jpg'); img = u.toString(); }
  let r = img ? await whatsappImage(phone, img, caption, author) : null;
  if (!r?.ok) r = await whatsappText(phone, caption, author);
  return r.ok ? { sent: true, name: d.name || undefined } : { sent: false, error: r.error };
}

export type LeadInput = Partial<Record<'name' | 'phone' | 'email' | 'city' | 'locality' | 'budget' | 'bhk' | 'sqft' | 'possession' | 'timeline' | 'project' | 'request' | 'summary', string>>;

/** Creates the chat's CRM lead the first time, then keeps it up to date. */
export async function saveLead(phone: string, input: LeadInput) {
  const clean = (v?: string, max = 200) => String(v ?? '').trim().slice(0, max);
  const name = clean(input.name, 120) || 'WhatsApp contact';
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(input.email)) ? clean(input.email).toLowerCase() : '';
  const wa = normalizePhone('+' + phone) || prettyPhone(phone);
  // A different number they asked to be called on; the WhatsApp number stays on the lead (whatsapp_chat) and in the message.
  const alt = clean(input.phone).replace(/\D/g, '');
  const altPhone = alt.length >= 10 && alt !== phone ? (normalizePhone('+' + (alt.length === 10 ? '91' + alt : alt)) || '+' + alt) : '';
  const mobile = altPhone || wa;
  const needs = [
    input.bhk && `Configuration: ${clean(input.bhk)}`,
    (input.locality || input.city) && `Location: ${[clean(input.locality), clean(input.city)].filter(Boolean).join(', ')}`,
    input.sqft && `Area: ${clean(input.sqft)}`, input.possession && `Possession / timeline: ${clean(input.possession)}`,
    input.budget && `Budget: ${clean(input.budget)}`,
    input.timeline && `Planning to buy: ${clean(input.timeline)}`, altPhone && `WhatsApp: ${wa}`, input.project && `Project: ${clean(input.project)}`,
    input.request && `Request: ${clean(input.request)}`,
  ].filter(Boolean).join(' · ');
  const message = [needs, clean(input.summary, 1000)].filter(Boolean).join('\n\n');
  const now = new Date().toISOString();
  const fields = {
    name, ...(email ? { email } : {}), phone: mobile, subject: input.project ? `WhatsApp: ${clean(input.project, 80)}` : 'WhatsApp enquiry', message,
    ...Object.fromEntries((['city', 'locality', 'budget', 'bhk', 'sqft', 'possession', 'timeline'] as const).filter((k) => input[k]).map((k) => [k, clean(input[k], 120)])),
    updated_at: now,
  };

  const db = await getDb();
  const leads = db.collection<{ _id: string; [k: string]: unknown }>('contact_leads');
  const chat = await getChat(phone);
  const existing = chat?.lead_id ? await leads.findOne({ _id: chat.lead_id }) : null;
  if (existing) {
    await leads.updateOne({ _id: existing._id }, { $set: fields });
  } else {
    const id = randomUUID();
    await leads.insertOne({ _id: id, id, email: '', ...fields, source: LEAD_SOURCE, status: 'new', notes: '', whatsapp_chat: phone, created_at: now });
    await (await chats()).updateOne({ _id: phone }, { $set: { lead_id: id, name, updated_at: now } });
    pushToCrm({ name, mobile, email, project: clean(input.project), source: 'WhatsApp chat', page: 'WhatsApp', message, extra: [['Request', input.request]] });
    notifyAdmin(`WhatsApp lead — ${name}`, {
      title: 'New lead from a WhatsApp chat',
      body: [esc(message).replace(/\n/g, '<br>')],
      rows: [['Name', name], ['WhatsApp', mobile], ['Email', email], ['Project', clean(input.project)]],
    });
  }
  if (chat && name !== 'WhatsApp contact' && chat.name !== name) await (await chats()).updateOne({ _id: phone }, { $set: { name } });
  return { saved: true, updated: Boolean(existing) };
}

/* ------------------------- enquiry questions (shared) ------------------------- */
// The AI and the guided bot (lib/wa-bot.ts) keep one record of the questions
// answered so far on the chat (wa_chats.bot), so a chat can switch between them.

type Bot = typeof import('./wa-bot');
const bot = (): Promise<Bot> => import('./wa-bot');
const QUESTION_LABEL: Record<string, string> = {
  name: 'name', phone: 'mobile number', email: 'email ID', config: 'configuration', location: 'location / area',
  sqft: 'area in sq. ft', possession: 'project timeline / possession', budget: 'budget',
};

async function enquiryState(phone: string) {
  const chat = await getChat(phone);
  const st = { ...(((chat as { bot?: import('./wa-bot').BotState } | null)?.bot) || {}) };
  // A chat that already had a lead before the questions flow carries on as before.
  if (!st.v) { st.v = 2; if (st.searched || chat?.lead_id) st.done = true; }
  return { chat, st };
}

/** Merges the AI's save_lead input into the chat's answers; creates / updates the CRM lead once the contact details are in. */
async function saveAnswers(phone: string, input: LeadInput) {
  const b = await bot();
  const { parseBhk, parseBudget, parseEmail, parsePhone, parsePossession, parseSqft, isSame, isSkip } = await import('./wa-text');
  const { chat, st } = await enquiryState(phone);
  const ans = { ...(st.ans || {}) };
  const c = (v?: string) => String(v ?? '').trim().slice(0, 80);
  if (c(input.name)) { st.name = c(input.name); ans.name = st.name; }
  if (c(input.phone)) {
    const alt = parsePhone(c(input.phone));
    if (alt) { st.alt_phone = alt; ans.phone = `+${alt}`; } else if (isSame(c(input.phone)) || /same|whatsapp/i.test(c(input.phone))) ans.phone = 'Same as WhatsApp';
  }
  if (c(input.email)) {
    const e = parseEmail(c(input.email));
    if (e) { st.email = e; ans.email = e; } else if (isSkip(c(input.email)) || /skip|not|no/i.test(c(input.email))) ans.email = 'Not shared';
  }
  if (c(input.bhk)) { ans.config = c(input.bhk); st.bhk = parseBhk(c(input.bhk)) || undefined; }
  if (c(input.locality) || c(input.city)) {
    ans.location = [c(input.locality), c(input.city)].filter(Boolean).join(', ');
    st.area = b.findArea(ans.location, await loadProjects()) || c(input.locality) || c(input.city);
  }
  if (c(input.sqft)) { ans.sqft = c(input.sqft); st.sqft = parseSqft(c(input.sqft), true)?.sqft; }
  if (c(input.possession)) { ans.possession = c(input.possession); st.possession = parsePossession(c(input.possession)) || undefined; }
  if (c(input.budget)) { ans.budget = c(input.budget); const bu = parseBudget(c(input.budget)); st.budget = bu?.text || c(input.budget); st.budget_lakh = bu?.lakh; }
  if (c(input.project)) st.projects = [...new Set([...(st.projects || []), c(input.project)])];
  if (c(input.request)) st.request = c(input.request);
  st.ans = ans;

  let saved = false;
  const named = !!st.name && st.name !== 'WhatsApp contact';
  if (b.contactDone(st) || (named && st.request) || chat?.lead_id) {
    const base = b.leadFromState(st, chat?.wa_name);
    await saveLead(phone, { ...base, city: input.city, timeline: input.timeline, summary: input.summary || base.summary, project: input.project || base.project });
    saved = true;
  }
  await (await chats()).updateOne({ _id: phone }, { $set: { bot: st, updated_at: new Date().toISOString() } } as never);
  const next = st.done ? null : b.nextStep(st);
  return {
    saved, lead_created: saved,
    next_question: st.done ? 'none — the enquiry is complete; help as usual' : next ? QUESTION_LABEL[next] : 'none — all questions answered: reply with one short line only; the system sends the matching projects and the thank-you message',
  };
}

/** One line for the AI on what is known and which question comes next. */
async function progressNote(phone: string): Promise<string> {
  const b = await bot();
  const { st } = await enquiryState(phone);
  if (st.done) return 'Enquiry progress: all questions answered and matching projects already sent — help as usual.';
  const known = Object.entries(st.ans || {}).map(([k, v]) => `${QUESTION_LABEL[k] || k}: ${v}`).join('; ');
  const next = b.nextStep(st);
  return `Enquiry progress: ${known ? `known — ${known}` : 'nothing yet'}. Next question to ask: ${next ? QUESTION_LABEL[next] : 'none (all answered)'}.`;
}

/** Once every question is answered: the matching project cards, then the thank-you (sent once). */
async function finishEnquiry(phone: string): Promise<void> {
  const b = await bot();
  const { THANK_YOU } = await import('./wa-text');
  const { st } = await enquiryState(phone);
  if (st.done || b.nextStep(st)) return;
  st.done = true;
  st.shown = [...(st.shown || [])];
  const fresh = b.matchProjects(await loadProjects(), st).filter((p) => !st.shown!.includes(Number(p.number))).slice(0, 3);
  st.searched = [st.area, st.bhk, st.budget_lakh, st.sqft, st.possession].join('|');
  for (const p of fresh) st.shown.push(Number(p.number));
  await (await chats()).updateOne({ _id: phone }, { $set: { bot: st, updated_at: new Date().toISOString() } } as never);
  if (fresh.length) {
    for (const p of fresh) await sendProjectCard(phone, Number(p.number));
    await whatsappText(phone, 'Reply with a *project name* for full details, *more* for more options, or *call* and our advisor will call you with the latest price & offers.', 'ai');
  } else {
    await whatsappText(phone, 'I couldn\'t find a listed project for all of these right now. Our advisor will share the best options with you shortly.', 'ai');
  }
  await whatsappText(phone, THANK_YOU, 'ai');
}

async function runTool(phone: string, name: string, input: unknown, live: boolean): Promise<string> {
  try {
    const i = (input || {}) as Record<string, unknown>;
    const out = name === 'search_projects' ? await searchProjects(i as never)
      : name === 'get_project' ? await getProject(i as never)
        : name === 'send_project_card' ? (live ? await sendProjectCard(phone, Number(i.number)) : { sent: false, note: 'Draft for staff review: cards are not sent from drafts. Put the project name, price and link in your text instead.' })
          : name === 'save_lead' ? await saveAnswers(phone, i as LeadInput)
            : { error: `Unknown tool ${name}` };
    return JSON.stringify(out);
  } catch (e) {
    console.error('[wa-ai] tool failed', name, (e as Error).message);
    return JSON.stringify({ error: 'Temporarily unavailable — tell the customer the team will follow up.' });
  }
}

/* --------------------------------- replies --------------------------------- */

const client = () => new Anthropic();

/**
 * Writes the AI reply for this chat (without sending it). Null when there is
 * nothing to answer (last message isn't from the customer) or the model declined.
 */
export async function draftReply(phone: string, live = false): Promise<string | null> {
  const history = await chatMessages(phone, 40);
  const messages = toTurns(history);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  const chat = await getChat(phone);
  const context = `Customer's WhatsApp number: ${prettyPhone(phone)}${chat?.name ? `. Name: ${chat.name}` : chat?.wa_name ? `. WhatsApp profile name: ${chat.wa_name}` : ''}${chat?.lead_id ? '. A CRM lead already exists for them (save_lead updates it).' : ''}. Today: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}.\n${await progressNote(phone).catch(() => '')}`;

  for (let step = 0; step < 8; step++) {
    const res = await client().beta.messages.create({
      model: MODEL(),
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: context }],
      tools: TOOLS,
      messages,
    });
    if (res.stop_reason === 'refusal') {
      console.warn('[wa-ai] declined', res.stop_details?.category);
      return null;
    }
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason === 'tool_use' && uses.length) {
      messages.push({ role: 'assistant', content: res.content });
      const results = await Promise.all(uses.map(async (u) => ({
        type: 'tool_result' as const, tool_use_id: u.id, content: await runTool(phone, u.name, u.input, live),
      })));
      messages.push({ role: 'user', content: results });
      continue;
    }
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    return text || null;
  }
  return null;
}

/**
 * Answers the customer's latest message if auto-reply is on for their chat.
 * Skips when a newer customer message arrived meanwhile (that one's webhook
 * call answers both) or staff already replied.
 */
export async function autoReply(phone: string): Promise<void> {
  const chat = await getChat(phone);
  if (!chat || chat.auto_reply === false) return;
  // No ANTHROPIC_API_KEY: the free guided bot answers instead (name → mobile → email → lead, then configuration → location → sq ft → possession → budget → project cards → thank-you).
  if (!aiConfigured()) { const { botReply } = await import('./wa-bot'); await botReply(phone); return; }
  const before = chat.last_in_at;
  let text: string | null = null;
  try {
    text = await draftReply(phone, true);
  } catch (e) {
    // Out of credit, key revoked, outage… the customer still gets the guided bot's answer.
    console.error('[wa-ai] reply failed — using the guided bot', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message);
    const { botReply } = await import('./wa-bot');
    await botReply(phone);
    return;
  }
  if (!text) return;
  // Project cards sent while drafting are logged as 'ai', so only a newer customer message or a staff reply stops it.
  const now = await getChat(phone);
  if (!now || now.auto_reply === false || now.last_in_at !== before || now.last_author === 'staff') return;
  await whatsappText(phone, text, 'ai');
  // All questions answered in this turn: the matching projects and the thank-you.
  try { await finishEnquiry(phone); } catch (e) { console.error('[wa-ai] sending the matches failed', (e as Error).message); }
}
