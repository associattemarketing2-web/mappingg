# Mappingg SEO Playbook & Documentation

> Full SEO documentation for **mappingg.com** — what is built, how it works, how
> to run it every day, how long ranking takes, and exactly what to do next.
> Hinglish notes are added where they help the team. **No fake promises** — only
> what genuinely moves rankings.

Last updated: 2026-10-03

---

## 0. TL;DR (seedha kaam ki baat)

- SEO ki **technical foundation ban chuki hai** (metadata, canonical, sitemap,
  robots, JSON-LD, project/location/developer/city/status/property pages).
- Ab **ranking = content + consistency + authority (backlinks)**. Ye roz/weekly
  kaam se aata hai, overnight nahi.
- Realistic timeline:
  - **Long-tail (project name, "projects in Kharadi")** → 3–8 weeks me dikhne lagta hai.
  - **Medium ("real estate projects in Pune")** → 3–6 months.
  - **High-competition ("property in Pune")** → 6–12+ months + backlinks.
- **Blog target:** pehle 8–12 hafte **2–4 posts/week**, phir **1–2 posts/week**.
- Roz ~30–45 min ka routine (Section 6). Weekly ~2–3 ghante. Monthly ~half day.

---

## 1. What is already implemented ✅

### 1.1 Technical foundation
| Item | Status | Where |
|---|---|---|
| Per-page unique title + description | ✅ | `lib/seo/metadata.ts` → `buildMetadata()` |
| Self-canonical on every page | ✅ | same |
| Open Graph + Twitter cards | ✅ | same |
| `robots.txt` (admin/API/dashboard blocked) | ✅ | `app/robots.ts` |
| Dynamic `sitemap.xml` (all public + entities + blog) | ✅ | `app/sitemap.ts` |
| Organization + WebSite JSON-LD (sitelinks search) | ✅ | `app/layout.tsx` + `lib/seo/schema.ts` |
| Breadcrumbs (visible + JSON-LD) | ✅ | `components/seo/Breadcrumbs.tsx` |
| error / loading / not-found pages | ✅ | `app/error.tsx`, `app/loading.tsx`, `app/not-found.tsx` |
| PWA manifest | ✅ | `app/manifest.ts` |
| Search Console verify + GTM (admin-editable) | ✅ | admin Settings → `search_console_verification`, `gtm_container_id` |

### 1.2 Crawlable entity pages (server-rendered HTML, indexable)
Derived from real project data (224 `pins`) — **no thin/fake pages**:

- `/projects` and `/projects/[slug]` — every public project, full details + `Residence` JSON-LD + FAQ.
- `/locations` and `/locations/[slug]` — locality landing pages (Kharadi, Mundhwa…).
- `/developers` and `/developers/[slug]` — developer-wise listings.
- `/cities` and `/cities/[city]` — Pune / Mumbai-MMR hubs.
- `/status/[status]` — upcoming / under-construction / ready-to-move.
- `/property` and `/property/[type]` — by property type.

All detail pages use **ISR** (`revalidate = 600`): first crawl generates the page,
then it's cached 10 min and refreshes. Sitemap lists every URL so Google finds them.

### 1.3 Internal linking (SEO ka "juice" flow)
```
Home → Cities → Locations → Projects
                       ↘ Developers ↗
          Status / Property-type ← cross-links
Blog → (links back to) Locations / Projects / Developers
```

---

## 2. How ranking actually works (samajhna zaroori hai)

Google 3 cheezein dekhti hai:

1. **Crawl & Index** — kya Google page padh/samajh pa rahi hai? → *Done* (technical foundation).
2. **Relevance** — page us search ke liye best answer hai? → *Content quality + keywords + structure*.
3. **Authority** — doosri sites is page/site pe bharosa karti hain? → *Backlinks + brand signals + time*.

Foundation (#1) ho gaya. Ab **#2 aur #3 roz ke kaam se** banta hai. Isliye
"kitne din me rank karega" ka honest jawab: **content + backlinks + consistency
ka function hai, fixed din nahi.** Niche realistic estimate (Section 5).

---

## 3. Keyword strategy & keyword map

### 3.1 Rule
- **1 page = 1 primary intent.** Har page ka alag target.
- **Keyword stuffing mat karo.** Natural likho, user ke liye likho.
- Long-tail pehle (easy wins), head terms baad me.

### 3.2 Keyword map (intent → URL)
| Search intent | Example keyword | Target page |
|---|---|---|
| Brand / discovery | "mappingg", "real estate project map pune" | `/` |
| City level | "real estate projects in pune" | `/cities/pune` |
| City level (MMR) | "new projects in navi mumbai / thane" | `/cities/mumbai` |
| **Locality (highest ROI)** | "projects in kharadi", "flats in mundhwa" | `/locations/<area>` |
| Status | "upcoming projects in pune" | `/status/upcoming` |
| Property type | "commercial projects pune" | `/property/commercial` |
| Developer | "<developer> projects pune" | `/developers/<name>` |
| **Project (easiest)** | "<project name> kharadi price" | `/projects/<slug>` |
| Informational | "best area to invest in pune" | `/blog/<slug>` |
| Comparison | "kharadi vs wagholi investment" | `/blog/<slug>` |

### 3.3 Keyword database (maintain this)
Ek simple sheet/table rakho (Google Sheet ya `docs/keywords.csv`):

```
primary_keyword | secondary_keywords | intent | target_url | content_type | priority | status
```
Example row:
```
projects in kharadi | kharadi flats, kharadi new launch | commercial-local | /locations/kharadi | location | high | live
```

### 3.4 Code me keyword kaise add kare
Har page already `buildMetadata()` use karta hai. Keywords pass karo:

```ts
// example: app/locations/[slug]/page.tsx already does this
return buildMetadata({
  title: `Real Estate Projects in ${g.label}`,
  description: `... ${g.count} projects in ${g.label} ...`,
  path: `/locations/${g.slug}`,
  keywords: [`real estate ${g.label}`, `property in ${g.label}`, `projects in ${g.label}`],
});
```

- **Entity pages** (projects/locations/etc.) ke keywords **auto-generate** hote
  hain data se — naya project/locality add karte hi naya SEO page + keywords ban jaate hain.
- **Static pages** (about, features, how-it-works) me `export const metadata`
  edit karke keyword/description improve karo.

### 3.5 Naya SEO page kaise banta hai (no code needed)
- **Naya project page** → map editor me ek **pin add karo** (public/non-hidden).
  Uska `/projects/<slug>` page + sitemap entry automatically ban jaata hai.
- **Nayi locality cover karni hai** → pin ke `location` field me us area ka naam
  likho jo `lib/locality.ts` ki `KNOWN` list me ho. Agar naya area hai to us list
  me ek regex line add karni padegi (chhota dev task).

---

## 4. Blog plan (organic traffic ka engine)

### 4.1 Cadence (kitne din me kitne)
| Phase | Duration | Posts/week | Goal |
|---|---|---|---|
| Launch push | Week 1–12 (~3 months) | **2–4** | Topical authority banao, ~30–45 articles |
| Steady | Month 4+ | **1–2** | Consistency, freshness |
| Maintain | ongoing | update + 1 new | Purane posts refresh karo |

> Quality > quantity. Ek accha 1200+ word useful article > 5 patle AI articles.
> Thin/AI-spam se **ranking girti hai**.

### 4.2 Blog kaise publish kare (already built)
- Super-admin → **Blog manager** (`/dashboard/s-admin`, `app/api/admin/blogs`).
- Fields: `title`, `slug`, `excerpt`, `content` (HTML), `cover_image`, `tags`,
  `seo_title`, `seo_description`, `status` (draft/published).
- `status = published` karte hi post **/blog pe aur sitemap me** apne aap aa jaata hai.
- Har article me `seo_title` + `seo_description` **zaroor** bharo.

### 4.3 Har blog me ye rakho
1. 1 clear `H1`, logical `H2/H3`.
2. 1200–2000 words, real useful info (RERA, stamp duty, locality guide, etc.).
3. **Internal links**: 2–4 links to relevant `/locations/...`, `/projects/...`, `/developers/...`.
4. Cover image (1200×630), alt text.
5. FAQ section (3–5 Q&A) — ye already `BlogPosting` JSON-LD ke saath render hota hai.

### 4.4 Topic bank (content clusters)
**Cluster: Pune localities** (har ek 1 article, locality page se link):
- "Kharadi Real Estate Guide 2026", "Mundhwa vs Magarpatta", "Wagholi investment", "Hinjewadi IT-park housing", "Baner/Balewadi premium homes"…

**Cluster: Buying & legal** (high informational volume):
- "Stamp Duty & Registration Charges in Maharashtra 2026"
- "What is RERA & how to check MahaRERA registration"
- "Ready-to-Move vs Under-Construction — pros & cons"
- "Documents to check before buying a flat"
- "Home loan eligibility & process in India"

**Cluster: Investment / comparison:**
- "Best areas to invest in Pune 2026"
- "Pune vs Navi Mumbai for property investment"
- "Top upcoming projects in Pune" (link to `/status/upcoming`)

Har cluster article **topic page (locality/city) se internally link** karo — isse
Google ko topical authority ka signal jaata hai.

---

## 5. Ranking timeline — honest expectations

> Koi bhi "#1 in 30 days" ka promise **jhooth** hai. Ye realistic range hai
> (depends on competition, content, backlinks, domain age):

| Query type | First visibility | Meaningful ranking |
|---|---|---|
| Project name (long-tail) | 2–4 weeks | 1–3 months |
| "projects in <locality>" | 1–2 months | 3–6 months |
| "real estate projects in Pune" | 3–4 months | 6–9 months |
| "property in Pune" (head term) | 6+ months | 9–18 months (+ backlinks) |
| Blog informational | 3–8 weeks | 2–5 months |

**Jaldi karne ke lever:** (a) regular quality content, (b) strong internal links,
(c) real backlinks (local directories, PR, partnerships), (d) fast site (CWV),
(e) Search Console me naye pages ka URL inspection + index request (selectively).

---

## 6. DAILY ROUTINE (~30–45 min) — roz kya kare

> Checklist. Ek banda roz ye kare:

1. **Google Search Console (GSC) → check** (5 min)
   - Page indexing errors? Coverage issues? Fix karo.
2. **Performance report** (5 min) — kaunse queries pe impressions aa rahe,
   kaunse pages pe clicks. Note "impressions high but CTR low" pages.
3. **1 content action** (15–20 min) — ya to naya blog draft aage badhao, ya ek
   purana page improve karo (better title/description, add internal links).
4. **Data freshness** (5 min) — koi naya project aaya? Pin add/update karo →
   naya SEO page auto-ban jaata hai.
5. **1 internal link add** (5 min) — kisi blog/project/locality page se ek
   relevant doosre page ka link add karo.
6. **Low-CTR fix** (5 min) — jis page pe impressions hain par click nahi, uska
   `title`/`seo_description` zyada attractive banao.

### Weekly (~2–3 ghante)
- [ ] GSC: top queries review, naye keyword opportunities note karo.
- [ ] 1–2 naye blog publish (Phase ke hisaab se).
- [ ] Broken links / 404 check (GSC + manual).
- [ ] Core Web Vitals report dekho (GSC → Experience).
- [ ] 1 backlink outreach (directory, portal, PR, partnership).
- [ ] Competitor ne kya naya kiya — 10 min dekho.

### Monthly (~half day)
- [ ] Full technical crawl (Screaming Frog / Sitebulb free tier).
- [ ] Duplicate title/description audit.
- [ ] Purane top-5 blogs ko refresh/update karo (freshness signal).
- [ ] Backlink profile review.
- [ ] Keyword map update + next month ka content calendar banao.
- [ ] GA4 me organic traffic + leads/conversions review.

---

## 7. Roadmap — aage kya implement karna hai (priority order)

### Phase A — Finish technical polish (1–2 days dev)
- [ ] **Static OG image** `public/og/default.png` (1200×630) + `SITE.ogFallback` point karo.
      (Dynamic `next/og` Node 24 pe fail hota hai, isliye static.)
- [ ] Per-project / per-locality OG images (optional, nice-to-have).

### Phase B — Performance & Core Web Vitals (2–4 days dev) ⚠️ important
- [ ] **Pin images abhi base64 me DB ke andar hain** — ye sabse bada CWV risk.
      Inhe real files/CDN pe move karo, `width/height` + WebP/AVIF ke saath.
- [ ] Map bundle (Leaflet/MapLibre) lazy-load — initial paint block na ho.
- [ ] Lighthouse + PageSpeed Insights pe LCP/INP/CLS measure karke fix karo.

### Phase C — Data / DB (1–2 days dev)
- [ ] `pins.doc->>'location'` aur `->>'developer'` pe index (agar grouping slow ho).
- [ ] Ensure listing pages sirf zaroori fields fetch karein (already done — no base64 in lists).

### Phase D — Content & authority (ongoing) — ye hamesha chalta rahega
- [ ] Blog cadence (Section 4).
- [ ] Backlinks: local real-estate directories, Justdial/Sulekha type listings,
      guest posts, PR, builder partnerships.
- [ ] **Google Business Profile** set karo (NAP consistent with footer) — local SEO ke liye.
- [ ] Social profiles + `sameAs` links schema me add karo.

### Phase E — Measurement & ops
- [ ] GA4 connect via GTM (admin Settings me `gtm_container_id` set karo).
- [ ] GSC me sitemap submit: `https://mappingg.com/sitemap.xml`.
- [ ] Track: organic users, top landing pages, leads, phone/WhatsApp clicks.

---

## 8. First 30 days — day-by-day execution

| Days | Focus |
|---|---|
| **1–2** | GSC + GA4 setup, sitemap submit, verify all public pages crawlable. Static OG image. |
| **3–5** | Keyword map banao (Section 3.3). Top 10 locality pages ke titles/descriptions polish. |
| **6–10** | Blog cluster start: 4–6 locality + legal articles likho & publish. Internal links add. |
| **11–15** | Performance pass (Phase B) — pin images optimize, map lazy-load, Lighthouse fix. |
| **16–20** | 6–8 aur blog posts. Developer/project pages ke descriptions improve. Breadcrumb/schema verify (Rich Results Test). |
| **21–25** | Backlinks start (GBP, directories, 2–3 outreach). Broken-link + duplicate audit. |
| **26–30** | Full crawl, mobile/desktop/responsive test, GSC coverage clean, next month calendar banao. |

---

## 9. SEO QA checklist (naya page live karne se pehle)

- [ ] 200 status, unique URL (lowercase, hyphen).
- [ ] Unique `title` + useful `description`.
- [ ] Self-canonical correct.
- [ ] Indexable (admin/private → noindex).
- [ ] Ek `H1`, logical `H2/H3`.
- [ ] Real useful content (patla nahi).
- [ ] 2+ internal links in + out.
- [ ] Images: alt + width/height + optimized.
- [ ] Structured data valid ([Rich Results Test](https://search.google.com/test/rich-results)).
- [ ] Sitemap me hai.
- [ ] Mobile pe theek, fast load.

---

## 10. Tools (mostly free)

- **Google Search Console** — indexing, queries, CWV (must).
- **Google Analytics 4** — traffic + conversions.
- **PageSpeed Insights / Lighthouse** — performance.
- **Rich Results Test / Schema validator** — JSON-LD check.
- **Screaming Frog (free 500 URLs)** — site crawl, broken links, duplicates.
- **Google Business Profile** — local SEO.

---

## 11. DON'Ts (ye bilkul mat karo — penalty aa sakti hai)

- ❌ Thin/AI-spam pages sirf URL count badhane ke liye.
- ❌ Fake reviews / fake ratings schema.
- ❌ Hidden text / keyword stuffing / doorway pages.
- ❌ Har page pe same title/description.
- ❌ Fake localities ya projects.
- ❌ Har URL roz "index request" spam karna.
- ❌ Secrets ko `NEXT_PUBLIC_*` me daalna.

---

## 12. Key files reference (team ke liye)

| Kaam | File |
|---|---|
| Site config / domain | `lib/seo/config.ts` |
| Metadata builder | `lib/seo/metadata.ts` |
| JSON-LD builders | `lib/seo/schema.ts` |
| Entity data (pins → SEO) | `lib/seo/entities.ts` |
| Slugs | `lib/seo/slug.ts` |
| Sitemap | `app/sitemap.ts` |
| Robots | `app/robots.ts` |
| Breadcrumbs | `components/seo/Breadcrumbs.tsx` |
| Project/locality/etc pages | `app/projects`, `app/locations`, `app/developers`, `app/cities`, `app/status`, `app/property` |
| Locality recognition | `lib/locality.ts` |
| Blog backend | `lib/blog.ts`, `app/api/admin/blogs` |
| SEO insights (admin) | `app/api/admin/seo-insights`, `components/admin/SeoCharts.tsx` |

---

*Ye living document hai — har mahine update karo (keyword map, calendar, results).*
