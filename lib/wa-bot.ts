import { loadProjects } from './api-platform/data';
import { serializeProjectSummary, type PinRow } from './api-platform/serializers';
import { chatMessages, chats, getChat, type WaChat } from './wa-store';
import { whatsappText } from './whatsapp';
import { saveLead, sendProjectCard } from './wa-ai';
import { extractName, parseBhk, parseBudget, parseIntent, priceLakh } from './wa-text';

// Guided WhatsApp bot — answers when there is no ANTHROPIC_API_KEY (or the AI
// call fails). It is not an AI: it follows a fixed flow, but uses the live
// project list for everything it shares.
//   1. Greets, asks the customer's name.
//   2. Asks area / BHK, then budget (whatever they already said is skipped).
//   3. Sends up to 3 matching project cards (photo + details + link).
//   4. A project named in any message gets its card straight away.
//   5. "call", "site visit", "brochure", "more" are understood at any point.
//   6. Saves / updates the CRM lead as soon as it has a name + one requirement.
// Its progress is kept on the chat row (wa_chats.bot).

export interface BotState {
  greeted?: boolean;
  name?: string;
  asked_name?: number;
  asked_budget?: boolean;
  area?: string;
  bhk?: string;
  budget?: string;
  budget_lakh?: number;
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
function findArea(text: string, projects: PinRow[]): string | null {
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

/** Projects in the area, with the BHK, within budget (+10%). Priced matches first; unpriced ones after. */
export function matchProjects(projects: PinRow[], st: Pick<BotState, 'area' | 'bhk' | 'budget_lakh'>): PinRow[] {
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
  return [...hits.filter((p) => priceLakh(p.price) != null), ...hits.filter((p) => priceLakh(p.price) == null)];
}

const first = (st: BotState) => (st.name && st.name !== 'WhatsApp contact' ? st.name.split(' ')[0] : '');

/** Works out the replies for the customer's latest message and the bot's new state. Pure apart from the project list. */
export async function plan(text: string, prev: BotState, chat: Pick<WaChat, 'wa_name'>, projects: PinRow[]): Promise<{ out: Out[]; st: BotState }> {
  const st: BotState = { ...prev, shown: [...(prev.shown || [])], projects: [...(prev.projects || [])] };
  const out: Out[] = [];
  const msg = /^\[(image|video|document|audio|sticker|location)\]/.test(text) ? '' : text;

  const bhk = parseBhk(msg); if (bhk) st.bhk = bhk;
  const budget = parseBudget(msg); if (budget) { st.budget = budget.text; st.budget_lakh = budget.lakh; }
  const area = findArea(msg, projects); if (area) st.area = area;
  const named = findProjects(msg, projects);
  const intent = parseIntent(msg);
  const request = intent.call ? 'Call back' : intent.visit ? 'Site visit' : intent.brochure ? 'Brochure / price sheet' : intent.human ? 'Talk to an advisor' : '';
  if (request) st.request = request;

  let gotName = false;
  if (!st.name) {
    const inline = /(?:my name is|mera naam|mera name|i am|i'm|myself|this is)\s+([\p{L}]{2,20}(?:\s+[\p{L}]{2,20})?)/iu.exec(msg)?.[1];
    const n = (inline && extractName(inline)) || (!bhk && !budget && !area && !named.length && !request ? extractName(msg) : null);
    if (n) { st.name = n; gotName = true; }
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

  // Ask for the name (twice at most), then carry on with their WhatsApp name.
  if (!st.name) {
    st.asked_name = (st.asked_name || 0) + 1;
    if (st.asked_name <= 2) {
      out.push({ text: named.length || request ? 'May I know your *name*, please?' : 'To help you better, may I know your *name*?' });
      return { out, st };
    }
    st.name = chat.wa_name || 'WhatsApp contact';
  }

  const hi = first(st) ? `${first(st)}` : '';
  const key = [st.area, st.bhk, st.budget_lakh].join('|');
  const namedOnly = named.length > 0 && !budget && !bhk && !area && !intent.more;

  if (!st.area && !st.bhk && !named.length && !request) {
    out.push({ text: `${gotName ? `Nice to meet you ${hi}! ` : ''}Which *area* are you looking in, and how many *BHK*?
(e.g. _Baner 2 BHK_, _Wakad 3 BHK_, _Thane 1 BHK_)` });
  } else if (!st.budget && !st.asked_budget && !named.length && !request) {
    st.asked_budget = true;
    out.push({ text: `Great${hi ? ` ${hi}` : ''}! What is your *budget*? (e.g. _80 lakh_, _1.2 Cr_)` });
  } else if ((st.area || st.bhk) && (st.budget || st.asked_budget) && (key !== st.searched || intent.more) && !namedOnly) {
    st.asked_budget = true;
    const fresh = matchProjects(projects, st).filter((p) => !st.shown!.includes(Number(p.number))).slice(0, 3);
    st.searched = key;
    const want = [st.bhk, st.area && `in ${st.area}`, st.budget && `under ${st.budget}`].filter(Boolean).join(' ');
    if (fresh.length) {
      out.push({ text: `Here ${fresh.length === 1 ? 'is a project' : `are ${fresh.length} projects`} for ${want} 👇` });
      for (const p of fresh) { out.push({ card: Number(p.number) }); st.shown!.push(Number(p.number)); }
      out.push({ text: `Reply with a *project name* for full details, *more* for more options, or *call* and our advisor will call you with the latest price & offers.` });
    } else {
      out.push({ text: intent.more
        ? `That's all the matching projects I have right now${hi ? `, ${hi}` : ''}. Our advisor will share a few more options with you shortly.`
        : `I couldn't find a listed project for ${want} right now. Our advisor will share the best options with you shortly — or try another area or budget.` });
    }
  } else if (named.length && !request) {
    out.push({ text: `Our advisor can share the latest price, offers and a site visit for ${named.length > 1 ? 'these' : 'this'} — just reply *call*. Want similar options? Tell me your area, BHK and budget.` });
  } else if (!request && !gotName && !budget && !bhk && !area) {
    // Nothing the bot understood: say it once every few hours, then let the team answer.
    const recent = st.hint_at && Date.now() - Date.parse(st.hint_at) < 6 * 3_600_000;
    if (!recent) {
      st.hint_at = new Date().toISOString();
      out.push({ text: `Thanks${hi ? ` ${hi}` : ''}! Our Mappingg advisor will reply to you here shortly. 🙏\nMeanwhile you can type a *project name*, or an *area + BHK + budget* (e.g. _Hinjewadi 2 BHK under 70 lakh_).` });
    }
  }
  return { out, st };
}

/** Answers the customer's latest message with the guided flow. */
export async function botReply(phone: string): Promise<void> {
  const chat = await getChat(phone);
  if (!chat || chat.auto_reply === false) return;
  const hist = await chatMessages(phone, 3);
  const last = hist[hist.length - 1];
  if (!last || last.author !== 'customer') return;

  const projects = await loadProjects();
  const prev = ((chat as WaChat & { bot?: BotState }).bot || {}) as BotState;
  const { out, st } = await plan(last.body || '', prev, chat, projects);

  // Lead: once there is a name and one requirement / project / request; updated whenever something new is learnt.
  const named = st.name && st.name !== 'WhatsApp contact';
  if ((named || st.request) && (st.area || st.bhk || st.budget || st.projects?.length || st.request)) {
    const lead = {
      name: st.name || chat.wa_name || 'WhatsApp contact', locality: st.area, bhk: st.bhk, budget: st.budget,
      project: st.projects?.join(', ') || undefined, request: st.request,
      summary: `WhatsApp bot: ${[st.bhk, st.area && `in ${st.area}`, st.budget && `budget ${st.budget}`].filter(Boolean).join(' ') || 'enquiry'}${st.projects?.length ? `; asked about ${st.projects.join(', ')}` : ''}${st.request ? `; wants ${st.request.toLowerCase()}` : ''}.`,
    };
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
