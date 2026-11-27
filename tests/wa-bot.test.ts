import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractName, parseBhk, parseBudget, parseEmail, parseIntent, parsePhone, parsePossession, parseSqft, projectCaption, THANK_YOU } from '../lib/wa-text';
import { bhkSizes, contactDone, leadFromState, matchProjects, plan, type BotState } from '../lib/wa-bot';
import type { PinRow } from '../lib/api-platform/serializers';

const P = (number: number, title: string, location: string, configuration: string, price: string): PinRow =>
  ({ number, title, location, configuration, price, type: 'Residential', status: 'Under Construction' }) as unknown as PinRow;

const PROJECTS = [
  P(1, 'Skyline Heights', 'Baner, Pune', '2, 3 BHK', '₹ 85 L onwards'),
  P(2, 'Green Valley', 'Baner, Pune', '3 BHK', '₹ 1.4 Cr'),
  P(3, 'Lake Vista', 'Wakad, Pune', '2 BHK', '₹ 72 L'),
  P(4, 'Orchid Park', 'Baner, Pune', '2BHK & 3BHK', 'Price on request'),
  P(5, 'Sunrise Towers', 'Thane West, Thane', '1, 2 BHK', '₹ 65 L'),
];

test('parseBhk / parseBudget / extractName / parseIntent', () => {
  assert.equal(parseBhk('looking for 2bhk flat'), '2 BHK');
  assert.equal(parseBhk('3 BHK in Baner'), '3 BHK');
  assert.equal(parseBhk('need an office'), 'Commercial');
  assert.equal(parseBhk('hello'), null);
  assert.deepEqual(parseBudget('budget 80 lakh'), { lakh: 80, text: '₹80 L' });
  assert.deepEqual(parseBudget('1.2 cr'), { lakh: 120, text: '₹1.2 Cr' });
  assert.equal(parseBudget('50-60L')?.lakh, 60);
  assert.equal(parseBudget('2 BHK'), null);
  assert.equal(extractName('Rahul'), 'Rahul');
  assert.equal(extractName('my name is priya sharma'), 'Priya Sharma');
  assert.equal(extractName('mera naam Amit hai'), 'Amit');
  assert.equal(extractName('hi'), null);
  assert.equal(extractName('2 bhk baner'), null);
  assert.equal(extractName('ok thanks'), null);
  assert.equal(parseIntent('please call me').call, true);
  assert.equal(parseIntent('send brochure').brochure, true);
  assert.equal(parseIntent('more').more, true);
});

test('projectCaption has the key facts and link, within 1,024 chars', () => {
  const c = projectCaption({ name: 'Skyline Heights', developer: 'ABC Developers', locality: 'Baner', city: 'Pune', configuration: '2, 3 BHK', price: '₹ 85 L onwards', possession: 'Dec 2027', rera_number: 'P52100012345', highlights: 'x'.repeat(2000), link: 'https://www.mappingg.com/projects/skyline-1' });
  assert.match(c, /\*Skyline Heights\*/);
  assert.match(c, /85 L/);
  assert.match(c, /RERA: P52100012345/);
  assert.match(c, /https:\/\/www\.mappingg\.com\/projects\/skyline-1$/);
  assert.ok(c.length <= 1024);
});

test('bhkSizes and matchProjects filter by area, BHK and budget', () => {
  assert.deepEqual(bhkSizes('2, 3 BHK'), ['2', '3']);
  assert.deepEqual(bhkSizes('2BHK & 3BHK, 950 sq ft'), ['2', '3']);
  assert.deepEqual(bhkSizes('Shops'), []);
  const m = matchProjects(PROJECTS, { area: 'Baner', bhk: '2 BHK', budget_lakh: 90 }).map((p) => p.number);
  assert.deepEqual(m, [1, 4]); // priced first; 2 is 3 BHK only, 3 is in Wakad
  assert.deepEqual(matchProjects(PROJECTS, { area: 'Baner', bhk: '3 BHK', budget_lakh: 100 }).map((p) => p.number), [1, 4]);
});

const texts = (out: unknown[]) => out.filter((o): o is { text: string } => typeof o === 'object' && o !== null && 'text' in o).map((o) => o.text);
const cards = (out: unknown[]) => out.filter((o): o is { card: number } => typeof o === 'object' && o !== null && 'card' in o).map((o) => o.card);

test('parseSqft / parsePossession / parseEmail / parsePhone', () => {
  assert.deepEqual(parseSqft('around 1000 sqft'), { sqft: 1000, text: '1000 sq ft' });
  assert.deepEqual(parseSqft('900-1,100 sq ft'), { sqft: 1100, text: '900–1100 sq ft' });
  assert.equal(parseSqft('1000'), null);
  assert.equal(parseSqft('1000', true)?.sqft, 1000);
  assert.equal(parsePossession('ready to move'), 'Ready to move');
  assert.equal(parsePossession('2028 tak'), 'By 2028');
  assert.equal(parsePossession('within 2 years'), 'Within 2 years');
  assert.equal(parsePossession('2 BHK'), null);
  assert.equal(parseEmail('mail is Rahul.K@Gmail.com'), 'rahul.k@gmail.com');
  assert.equal(parsePhone('98765 43210'), '919876543210');
  assert.equal(parsePhone('+971 50 123 4567'), '971501234567');
  assert.equal(parsePhone('80 lakh'), null);
});

test('questions in order: name → number → email → configuration → location → sq ft → possession → budget → cards + thank you', async () => {
  const chat = { wa_name: 'Rahul K' };
  let r = await plan('Hi', {}, chat, PROJECTS);
  assert.match(texts(r.out)[0], /Welcome to \*Mappingg\*/);
  assert.match(texts(r.out)[1], /name/);
  const steps: [string, RegExp][] = [
    ['Rahul', /mobile number/],
    ['same', /email ID/],
    ['rahul@example.com', /configuration/],
    ['2 bhk', /location/],
    ['Baner', /sq\. ft/],
    ['1000 sq ft', /possession/],
    ['ready to move', /budget/],
  ];
  for (const [answer, next] of steps) {
    r = await plan(answer, r.st, chat, PROJECTS);
    assert.equal(cards(r.out).length, 0, answer);
    assert.match(texts(r.out).at(-1)!, next, answer);
  }
  assert.ok(contactDone(r.st));
  r = await plan('90 lakh', r.st, chat, PROJECTS);
  assert.deepEqual(cards(r.out), [1, 4]);
  assert.equal(texts(r.out).at(-1), THANK_YOU);
  assert.equal(r.st.done, true);
  const lead = leadFromState(r.st);
  assert.equal(lead.name, 'Rahul');
  assert.equal(lead.email, 'rahul@example.com');
  assert.equal(lead.bhk, '2 BHK');
  assert.equal(lead.locality, 'Baner');
  assert.equal(lead.sqft, '1000 sq ft');
  assert.equal(lead.possession, 'Ready to move');
  assert.equal(lead.budget, '₹90 L');
  // Afterwards it works as before.
  r = await plan('more', r.st, chat, PROJECTS);
  assert.equal(cards(r.out).length, 0);
  assert.match(texts(r.out)[0], /all the matching projects/);
});

test('answers given early are skipped; unreadable answers are kept as typed; another number and a skipped email', async () => {
  const chat = { wa_name: '' };
  let r = await plan('Hi I am Priya, need 2 BHK in Wakad under 75 lakh', {}, chat, PROJECTS);
  assert.equal(r.st.name, 'Priya');
  assert.match(texts(r.out).at(-1)!, /mobile number/);
  r = await plan('my number is 98765 43210', r.st, chat, PROJECTS);
  assert.equal(r.st.alt_phone, '919876543210');
  r = await plan('skip', r.st, chat, PROJECTS);
  assert.equal(r.st.ans?.email, 'Not shared');
  assert.match(texts(r.out).at(-1)!, /sq\. ft/); // configuration + location already known
  r = await plan('jitna mil jaye', r.st, chat, PROJECTS);
  assert.equal(r.st.ans?.sqft, 'jitna mil jaye');
  r = await plan('2027', r.st, chat, PROJECTS);
  assert.equal(r.st.possession, 'By 2027');
  assert.deepEqual(cards(r.out), [3]);
  assert.equal(texts(r.out).at(-1), THANK_YOU);
  assert.equal(leadFromState(r.st).phone, '919876543210');
});

test('a named project and a call request still work mid-questions', async () => {
  const chat = { wa_name: '' };
  let r = await plan('Hi', {}, chat, PROJECTS);
  r = await plan('Tell me about Sunrise Towers', r.st, chat, PROJECTS);
  assert.deepEqual(cards(r.out), [5]);
  assert.deepEqual(r.st.projects, ['Sunrise Towers']);
  assert.match(texts(r.out).at(-1)!, /name/);
  r = await plan('Amit', r.st, chat, PROJECTS);
  r = await plan('please call me', r.st, chat, PROJECTS);
  assert.equal(r.st.request, 'Call back');
  assert.match(texts(r.out)[0], /call back/);
  assert.match(texts(r.out).at(-1)!, /mobile number/);
});

test('a chat from before the questions flow carries on as before', async () => {
  const old: BotState = { greeted: true, name: 'Rahul', area: 'Baner', bhk: '2 BHK', budget: '₹90 L', budget_lakh: 90, searched: 'Baner|2 BHK|90', shown: [1, 4] };
  const r = await plan('3 bhk', old, { wa_name: '' }, PROJECTS);
  assert.equal(r.st.done, true);
  assert.ok(!texts(r.out).some((t) => /mobile number|email/.test(t)));
});
