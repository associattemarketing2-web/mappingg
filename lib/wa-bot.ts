import { loadProjects } from './api-platform/data';
import { serializeProjectSummary, type PinRow } from './api-platform/serializers';
import { chatMessages, chats, getChat, type WaChat } from './wa-store';
import { whatsappText } from './whatsapp';
import { saveLead, sendProjectCard } from './wa-ai';
import { extractName, isSame, isSkip, parseBhk, parseBudget, parseEmail, parseIntent, parsePhone, parsePossession, parseSqft, priceLakh, THANK_YOU } from './wa-text';

// Guided WhatsApp bot — answers when there is no ANTHROPIC_API_KEY (or the AI
// call fails). It is not an AI: it follows a fixed flow, but uses the live
// project list for everything it shares.
//   1. Greets, then takes the customer's contact details: name → mobile number
//      (or "same" for this WhatsApp number) → email ID. The CRM lead is created
//      as soon as these are in.
//   2. Asks the enquiry questions in order: configuration → location → sq. ft →
//      project timeline / possession → budget (whatever they already said is
//      skipped; an answer it can't read is kept as typed, for the team).
//   3. Sends up to 3 matching project cards (photo + details + link), then
//      "Thank you for enquiring at mappingg.com…".
//   4. A project named in any message gets its card straight away.
//   5. "call", "site visit", "brochure", "more" are understood at any point.
//   6. Keeps the CRM lead up to date with every answer.
// Its progress is kept on the chat row (wa_chats.bot).

/** The questions, in the order they are asked. */
export const STEPS = ['name', 'phone', 'email', 'config', 'location', 'sqft', 'possession', 'budget'] as const;
export type Step = (typeof STEPS)[number];

export interface BotState {
  /** 2 = the contact + enquiry-questions flow. Older chats (no v) that already got results count as done. */
  v?: number;
  greeted?: boolean;
  name?: string;
  asked_name?: number;
  asked_budget?: boolean;
  /** Each question's answer as the team should read it (parsed, or typed as-is, or "Not shared"). */
  ans?: Partial<Record<Step, string>>;
  /** How often each question was asked without an answer. */
  asks?: Partial<Record<Step, number>>;
  /** The question waiting for an answer. */
  asking?: Step;
  /** Contact number other than this WhatsApp number (digits). */
  alt_phone?: string;
  email?: string;
  area?: string;
  bhk?: string;
  sqft?: number;
  possession?: string;
  budget?: string;
  budget_lakh?: number;
  /** The questions are done and the matching projects + thank-you were sent. */
  done?: boolean;
  projects?: string[];
  request?: string;
  shown?: number[];
  searched?: string;
  lead_sig?: string;
  hint_at?: string;
}

type Out = { text: string } | { card: number };

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim()} `;
const CITIES = ['Pune', 'Mumbai', 'Navi Mumbai', 'Thane', 'PCMC', 'Pimpri Chinchwad', 'Chennai', 'Noida', 'Greater Noida', 'Gurgaon', 'Bangalore', 'Hyderabad', 'Nashik', 'Nagpur'];

/** The longest locality / city from our projects that the message mentions. */
export function findArea(text: string, projects: PinRow[]): string | null {
  const t = norm(text);
  const names = new Set<string>(CITIES);
  for (const p of projects) {
    const s = serializeProjectSummary(p);
    if (s.locality?.name) names.add(s.locality.name);
  }
  let best: string | null = null;
  for (const n of names) {
    if (n.length < 3) continue;
    if (t.includes(norm(n)) && (!best || n.length > best.length)) best = n;
  }
  return best;
}

/** Projects the customer names ("Godrej Woodsville", "project 123"). */
function findProjects(text: string, projects: PinRow[]): PinRow[] {
  const t = norm(text);
  const byNum = /(?:#|project\s*(?:no\.?|number)\s*)(\d{1,5})\b/i.exec(text)?.[1];
  if (byNum) { const p = projects.find((x) => Number(x.number) === Number(byNum)); if (p) return [p]; }
  const hits = projects
    .map((p) => ({ p, title: norm(String(p.title || '')) }))
    .filter(({ title }) => title.trim().length >= 6 && t.includes(title))
    .sort((a, b) => b.title.length - a.title.length);
  return hits.slice(0, 2).map((h) => h.p);
}

/** BHK sizes a configuration offers: "2, 3 BHK" / "2BHK & 3BHK" / "2.5 BHK" → ["2", "3"] / ["2.5"]. */
export function bhkSizes(conf: string): string[] {
  if (!/bhk/i.test(conf)) return [];
  return [...conf.replace(/\d+(\.\d+)?\s*(sq|sqft|sq\.?\s*ft|cr|l|lakh|%)/gi, ' ').matchAll(/(?<![\d.])(\d(?:\.5)?)(?![\d.])/g)].map((m) => m[1]);
}

/** The sq ft numbers a project lists ("650 - 1100", "850, 1,200 sq ft"). */
const sqftsOf = (v: unknown) => [...String(v ?? '').replace(/,/g, '').matchAll(/\d{3,5}/g)].map((m) => Number(m[0])).filter((n) => n >= 150 && n <= 50_000);

/** How well a project fits the wanted size and possession (higher first; never filters a project out — this data is often missing). */
function fit(p: PinRow, st: Pick<BotState, 'sqft' | 'possession'>): number {
  let score = 0;
  if (st.sqft) {
    const s = sqftsOf(p.sqft);
    if (s.length && Math.min(...s) <= st.sqft * 1.2 && Math.max(...s) >= st.sqft * 0.8) score += 2;
  }
  if (st.possession) {
    const when = `${p.possession_timeline || ''} ${p.status || ''}`.toLowerCase();
    const year = /By (\d{4})/.exec(st.possession)?.[1];
    const within = /Within (\d+) (year|month)/.exec(st.possession);
    const upto = year ? Number(year) : within ? new Date().getFullYear() + (within[2] === 'year' ? Number(within[1]) : Math.ceil(Number(within[1]) / 12)) : null;
    const theirs = Number(/\b(20[2-4]\d)\b/.exec(when)?.[1]) || null;
    const ok = st.possession === 'Ready to move' ? /ready|completed|rtm/.test(when)
      : st.possession === 'Under construction' ? /under construction|ongoing/.test(when)
        : st.possession === 'New launch' ? /launch/.test(when)
          : upto != null && (/ready|completed/.test(when) || (theirs != null && theirs <= upto));
    if (ok) score += 1;
  }
  return score;
}

/** Projects in the area, with the BHK, within budget (+10%); closest size / possession next; priced matches first, unpriced after. */
export function matchProjects(projects: PinRow[], st: Pick<BotState, 'area' | 'bhk' | 'budget_lakh' | 'sqft' | 'possession'>): PinRow[] {
  const area = st.area ? norm(st.area) : '';
  const n = /^(\d(?:\.5)?) BHK$/.exec(st.bhk || '')?.[1];
  const kind = st.bhk === 'Commercial' ? /office|shop|commercial|retail/i : st.bhk === 'Plot' ? /plot|land/i : st.bhk === '1 RK' ? /1\s*rk/i : st.bhk?.startsWith('Villa') ? /villa|bungalow|row ?house/i : null;
  const hits = projects.filter((p) => {
    const s = serializeProjectSummary(p);
    if (area && !norm([p.location, s.locality?.name, s.city.name].join(' ')).includes(area)) return false;
    const conf = `${p.configuration || ''} ${p.type || ''}`;
    if (n && !bhkSizes(conf).includes(n)) return false;
    if (kind && !kind.test(conf)) return false;
    const lakh = priceLakh(p.price);
    return !(st.budget_lakh && lakh != null && lakh > st.budget_lakh * 1.1);
  });
  const ranked = (list: PinRow[]) => (st.sqft || st.possession
    ? list.map((p, i) => ({ p, i, f: fit(p, st) })).sort((a, b) => b.f - a.f || a.i - b.i).map((x) => x.p)
    : list);
  return [...ranked(hits.filter((p) => priceLakh(p.price) != null)), ...ranked(hits.filter((p) => priceLakh(p.price) == null))];
}

const first = (st: BotState) => (st.name && st.name !== 'WhatsApp contact' ? st.name.split(' ')[0] : '');

/** The next question still to ask, or null when all are answered. */
export function nextStep(st: BotState): Step | null {
  return STEPS.find((k) => (k === 'name' ? !st.name : !st.ans?.[k])) ?? null;
}

/** The contact details are in (name, number, email answered or skipped) — time to create the lead. */
export const contactDone = (st: BotState) => !!st.name && !!st.ans?.phone && !!st.ans?.email;

function question(step: Step, hi: string, gotName: boolean): string {
  switch (step) {
    case 'name': return 'To help you better, may I know your *name*?';
    case 'phone': return `${gotName ? `Nice to meet you${hi ? ` ${hi}` : ''}! ` : `Thanks${hi ? ` ${hi}` : ''}! `}Please share your *mobile number* so our advisor can call you.\n(Reply *same* to use this WhatsApp number.)`;
    case 'email': return 'And your *email ID*, please?\n(Reply *skip* if you\'d rather not share it.)';
    case 'config': return 'Which *configuration* are you looking for?\n(e.g. _1 BHK_, _2 BHK_, _3 BHK_, _Villa_, _Office_)';
    case 'location': return 'Which *location / area* do you prefer?\n(e.g. _Baner_, _Wakad_, _Hinjewadi_, _Thane West_)';
    case 'sqft': return 'How much *area (sq. ft)* do you need?\n(e.g. _650 sq ft_, _900–1100 sq ft_)';
    case 'possession': return 'What *project timeline / possession* are you looking for?\n(e.g. _Ready to move_, _Within 2 years_, _By 2028_)';
    case 'budget': return 'And what is your *budget*?\n(e.g. _80 lakh_, _1.2 Cr_)';
  }
}

/** Up to 3 matching projects not shown yet, as replies; `more` says so when there are none left. */
function results(st: BotState, projects: PinRow[], more: boolean, hi: string): Out[] {
  const out: Out[] = [];
  const fresh = matchProjects(projects, st).filter((p) => !st.shown!.includes(Number(p.number))).slice(0, 3);
  st.searched = [st.area, st.bhk, st.budget_lakh, st.sqft, st.possession].join('|');
  const want = [st.bhk, st.area && `in ${st.area}`, st.budget && `under ${st.budget}`].filter(Boolean).join(' ');
  if (fresh.length) {
    out.push({ text: `Here ${fresh.length === 1 ? 'is a project' : `are ${fresh.length} projects`} for ${want || 'you'} 👇` });
    for (const p of fresh) { out.push({ card: Number(p.number) }); st.shown!.push(Number(p.number)); }
    out.push({ text: 'Reply with a *project name* for full details, *more* for more options, or *call* and our advisor will call you with the latest price & offers.' });
  } else {
    out.push({ text: more
      ? `That's all the matching projects I have right now${hi ? `, ${hi}` : ''}. Our advisor will share a few more options with you shortly.`
      : `I couldn't find a listed project${want ? ` for ${want}` : ''} right now. Our advisor will share the best options with you shortly — or try another area or budget.` });
  }
  return out;
}

/** Works out the replies for the customer's latest message and the bot's new state. Pure apart from the project list. */
export async function plan(text: string, prev: BotState, chat: Pick<WaChat, 'wa_name'>, projects: PinRow[]): Promise<{ out: Out[]; st: BotState }> {
  const st: BotState = { ...prev, ans: { ...(prev.ans || {}) }, asks: { ...(prev.asks || {}) }, shown: [...(prev.shown || [])], projects: [...(prev.projects || [])] };
  // A chat from before the questions flow that already got its project cards carries on as before.
  if (!st.v) { st.v = 2; if (prev.searched) st.done = true; }
  const ans = st.ans!, asks = st.asks!;
  const out: Out[] = [];
  const msg = /^\[(image|video|document|audio|sticker|location)\]/.test(text) ? '' : text;
  const asking = st.done ? undefined : st.asking;

  const bhk = parseBhk(msg); if (bhk) { st.bhk = bhk; ans.config = bhk; }
  const budget = parseBudget(msg); if (budget) { st.budget = budget.text; st.budget_lakh = budget.lakh; ans.budget = budget.text; }
  const area = findArea(msg, projects); if (area) { st.area = area; ans.location = area; }
  const sqft = parseSqft(msg, asking === 'sqft'); if (sqft) { st.sqft = sqft.sqft; ans.sqft = sqft.text; }
  const possession = parsePossession(msg); if (possession) { st.possession = possession; ans.possession = possession; }
  const email = parseEmail(msg); if (email) { st.email = email; ans.email = email; }
  const phone = parsePhone(msg); if (phone) { st.alt_phone = phone; ans.phone = `+${phone}`; }
  const named = findProjects(msg, projects);
  const intent = parseIntent(msg);
  const request = intent.call ? 'Call back' : intent.visit ? 'Site visit' : intent.brochure ? 'Brochure / price sheet' : intent.human ? 'Talk to an advisor' : '';
  if (request) st.request = request;
  const parsedAny = !!(bhk || budget || area || sqft || possession || email || phone);

  let gotName = false;
  if (!st.name) {
    const inline = /(?:my name is|mera naam|mera name|i am|i'm|myself|this is)\s+([\p{L}]{2,20}(?:\s+[\p{L}]{2,20})?)/iu.exec(msg)?.[1];
    const n = (inline && extractName(inline)) || (!parsedAny && !named.length && !request ? extractName(msg) : null);
    if (n) { st.name = n; ans.name = n; gotName = true; }
  }

  // The reply to the question we asked, when nothing above could read it: kept as typed, for the team.
  const answer = msg.trim().replace(/\s+/g, ' ');
  if (asking && asking !== 'name' && !ans[asking] && answer && !named.length && !request) {
    if (asking === 'phone') { if (isSame(answer) || isSkip(answer)) ans.phone = 'Same as WhatsApp'; }
    else if (asking === 'email') { if (isSkip(answer)) ans.email = 'Not shared'; }
    else ans[asking] = isSkip(answer) || /^(any|anything|koi bhi|kuch bhi|flexible|not sure)$/i.test(answer) ? 'Any' : answer.slice(0, 80);
  }

  if (!st.greeted) {
    st.greeted = true;
    out.push({ text: `Namaste${chat.wa_name ? ` ${chat.wa_name.split(' ')[0]}` : ''} 🙏 Welcome to *Mappingg* — verified new projects in Pune & Mumbai on one live map.` });
  }

  for (const p of named) {
    out.push({ card: Number(p.number) });
    if (!st.shown!.includes(Number(p.number))) st.shown!.push(Number(p.number));
    const t = String(p.title || '').trim();
    if (t && !st.projects!.includes(t)) st.projects!.push(t);
  }

  if (request) {
    const what = request === 'Call back' ? 'a *call back*' : request === 'Site visit' ? 'a *site visit*' : request === 'Brochure / price sheet' ? 'the *brochure & price sheet*' : 'an *advisor*';
    out.push({ text: `Sure${first(st) ? ` ${first(st)}` : ''}! I've noted your request for ${what}. Our Mappingg advisor will contact you on this number shortly. 👍` });
  }

  const hi = first(st);

  if (!st.done) {
    // The next question. One asked twice without an answer is skipped (the name falls back to the WhatsApp name).
    let step = nextStep(st);
    while (step && (asks[step] || 0) >= 2) {
      if (step === 'name') { st.name = chat.wa_name || 'WhatsApp contact'; ans.name = st.name; }
      else ans[step] = step === 'phone' ? 'Same as WhatsApp' : 'Not shared';
      step = nextStep(st);
    }
    if (step) {
      asks[step] = (asks[step] || 0) + 1;
      st.asking = step;
      out.push({ text: step === 'name' && (named.length || request) ? 'May I know your *name*, please?' : question(step, hi, gotName) });
      return { out, st };
    }
    // All answered: the matching projects, then the thank-you.
    st.asking = undefined;
    st.done = true;
    st.asked_budget = true;
    out.push(...results(st, projects, false, hi), { text: THANK_YOU });
    return { out, st };
  }

  const key = [st.area, st.bhk, st.budget_lakh, st.sqft, st.possession].join('|');
  const namedOnly = named.length > 0 && !budget && !bhk && !area && !intent.more;
  if ((st.area || st.bhk) && (key !== st.searched || intent.more) && !namedOnly) {
    out.push(...results(st, projects, intent.more, hi));
  } else if (named.length && !request) {
    out.push({ text: `Our advisor can share the latest price, offers and a site visit for ${named.length > 1 ? 'these' : 'this'} — just reply *call*. Want similar options? Tell me your area, BHK and budget.` });
  } else if (!request && !parsedAny) {
    // Nothing the bot understood: say it once every few hours, then let the team answer.
    const recent = st.hint_at && Date.now() - Date.parse(st.hint_at) < 6 * 3_600_000;
    if (!recent) {
      st.hint_at = new Date().toISOString();
      out.push({ text: `Thanks${hi ? ` ${hi}` : ''}! Our Mappingg advisor will reply to you here shortly. 🙏\nMeanwhile you can type a *project name*, or an *area + BHK + budget* (e.g. _Hinjewadi 2 BHK under 70 lakh_).` });
    }
  }
  return { out, st };
}

/** The CRM lead fields for the answers so far. */
export function leadFromState(st: BotState, waName?: string) {
  const a = st.ans || {};
  const real = (v?: string) => (v && v !== 'Not shared' && v !== 'Same as WhatsApp' ? v : undefined);
  const want = [real(a.config), real(a.location) && `in ${a.location}`, real(a.sqft), real(a.possession) && `possession ${a.possession}`, real(a.budget) && `budget ${a.budget}`].filter(Boolean).join(', ');
  return {
    name: st.name || waName || 'WhatsApp contact',
    phone: st.alt_phone, email: st.email,
    bhk: real(a.config), locality: real(a.location), sqft: real(a.sqft), possession: real(a.possession), budget: real(a.budget),
    project: st.projects?.join(', ') || undefined, request: st.request,
    summary: `WhatsApp bot: ${want || 'enquiry'}${st.projects?.length ? `; asked about ${st.projects.join(', ')}` : ''}${st.request ? `; wants ${st.request.toLowerCase()}` : ''}.`,
  };
}

/** Answers the customer's latest message with the guided flow. */
export async function botReply(phone: string): Promise<void> {
  const chat = await getChat(phone);
  if (!chat || chat.auto_reply === false) return;
  const hist = await chatMessages(phone, 3);
  const last = hist[hist.length - 1];
  if (!last || last.author !== 'customer') return;

  const projects = await loadProjects();
  let prev = ((chat as WaChat & { bot?: BotState }).bot || {}) as BotState;
  // A chat that already had a lead before the questions flow carries on as before.
  if (!prev.v && chat.lead_id) prev = { ...prev, v: 2, done: true };
  const { out, st } = await plan(last.body || '', prev, chat, projects);

  // Lead: created once the name, number and email are in (or at once on a call / visit request),
  // then updated whenever something new is learnt. Chats from before the questions flow keep the old rule.
  const named = !!st.name && st.name !== 'WhatsApp contact';
  const oldRule = !!prev.searched && !prev.v && (named || !!st.request) && !!(st.area || st.bhk || st.budget || st.projects?.length || st.request);
  if (contactDone(st) || (named && st.request) || oldRule || prev.lead_sig || chat.lead_id) {
    const lead = leadFromState(st, chat.wa_name);
    const sig = JSON.stringify(lead);
    if (sig !== st.lead_sig) {
      try { await saveLead(phone, lead); st.lead_sig = sig; } catch (e) { console.error('[wa-bot] lead save failed', (e as Error).message); }
    }
  }
  await (await chats()).updateOne({ _id: phone }, { $set: { bot: st, updated_at: new Date().toISOString() } } as never);

  for (const o of out) {
    // Staff took over (switch off) mid-way: stop.
    const now = await getChat(phone);
    if (!now || now.auto_reply === false) return;
    if ('card' in o) await sendProjectCard(phone, o.card);
    else await whatsappText(phone, o.text, 'ai');
  }
}
