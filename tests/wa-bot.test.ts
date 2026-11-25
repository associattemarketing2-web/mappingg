import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractName, parseBhk, parseBudget, parseIntent, projectCaption } from '../lib/wa-text';
import { bhkSizes, matchProjects, plan, type BotState } from '../lib/wa-bot';
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

test('guided flow: greet → name → area/BHK → budget → cards', async () => {
  let st: BotState = {};
  const chat = { wa_name: 'Rahul K' };
  let r = await plan('Hi', st, chat, PROJECTS);
  assert.match((r.out[0] as { text: string }).text, /Welcome to \*Mappingg\*/);
  assert.match((r.out[1] as { text: string }).text, /name/);
  st = r.st;
  r = await plan('Rahul', st, chat, PROJECTS);
  assert.equal(r.st.name, 'Rahul');
  assert.match((r.out[0] as { text: string }).text, /area.*BHK/s);
  st = r.st;
  r = await plan('Baner 2bhk', st, chat, PROJECTS);
  assert.equal(r.st.area, 'Baner');
  assert.match((r.out[0] as { text: string }).text, /budget/);
  st = r.st;
  r = await plan('90 lakh', st, chat, PROJECTS);
  assert.deepEqual(r.out.filter((o) => 'card' in o).map((o) => (o as { card: number }).card), [1, 4]);
  st = r.st;
  r = await plan('more', st, chat, PROJECTS);
  assert.equal(r.out.filter((o) => 'card' in o).length, 0);
  assert.match((r.out[0] as { text: string }).text, /all the matching projects/);
});

test('everything in one message, a named project, and a call request', async () => {
  const chat = { wa_name: '' };
  let r = await plan('Hi I am Priya, need 2 BHK in Wakad under 75 lakh', {}, chat, PROJECTS);
  assert.equal(r.st.name, 'Priya');
  assert.deepEqual(r.out.filter((o) => 'card' in o).map((o) => (o as { card: number }).card), [3]);
  r = await plan('Tell me about Sunrise Towers', r.st, chat, PROJECTS);
  assert.deepEqual(r.out.filter((o) => 'card' in o).map((o) => (o as { card: number }).card), [5]);
  assert.deepEqual(r.st.projects, ['Sunrise Towers']);
  r = await plan('please call me', r.st, chat, PROJECTS);
  assert.equal(r.st.request, 'Call back');
  assert.match((r.out[0] as { text: string }).text, /call back/);
});
