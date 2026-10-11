# SEO Task Report — Mappingg

**Date:** 10 Oct 2026 (Saturday)
**Website:** www.mappingg.com

Aaj SEO ke 4 code fixes live hue, poori website ka SEO audit kiya gaya, aur SEO report + 90 din ka plan tayyar hua.

## 1. SEO code changes (commit `bce6ed5`)

| # | Kaam | File | Fayda |
| --- | --- | --- | --- |
| 1 | Sitemap ka `lastModified` ab real update date se aata hai (pehle har URL par "abhi ka time" jaata tha) | `app/sitemap.ts` | Google lastmod par bharosa karega, naye/updated pages jaldi crawl honge |
| 2 | Project page ki meta description behtar: price add hota hai, chhote notes ("Flexi Payment 25x4") description replace nahi karte, 160 characters par word boundary par cut | `app/projects/[slug]/layout.tsx` | Search result me saaf, poori description; CTR badhega |
| 3 | `/cookies` page ka apna title, description aur canonical | `app/cookies/layout.tsx` (naya) | Duplicate/khaali meta khatam |
| 4 | Blog cover image par `width`/`height` (1200×630) | `app/blog/[slug]/page.tsx` | Layout shift (CLS) kam, Core Web Vitals behtar |

## 2. SEO audit

- Live site ka audit kiya: sitemap me **504 URLs** (273 project, 104 developer, 83 locality, 12 blog, baaki static/hub pages).
- Har page type ka sample check: status 200, ek H1, sahi canonical, valid schema, images me alt text — sab theek.
- Apex `mappingg.com` → `www.mappingg.com` 308 redirect aur 404 handling verify kiya.
- **Mili problems:** ~110 thin pages (45 locality + 67 developer pages me sirf 1 project), project pages par ~275 words, non-project pin ka project page, OG image sirf logo icon, project page ki pehli load 2–3 sec.

## 3. SEO report aur plan

- Poori SEO report banayi: abhi tak kya kiya, audit, gaps, 90 din ka plan, content/backlink plan aur KPIs.
    - Online doc: https://claude.ai/code/artifact/ad78a97e-c14f-4cb6-b0ad-437b9a4d68ec
    - File: `seo-doc/SEO-REPORT.md`

## 4. Pending / blocked

- PageSpeed Insights score nahi nikal paya — Google API ki daily limit khatam thi. Kal pagespeed.web.dev se manually check karna hai.
- Thin pages par decision baaki: noindex karna hai ya unique content likhna hai.

## 5. Kal ka SEO plan (11 Oct 2026)

- [ ] Home, map, ek project aur ek locality page ka mobile PageSpeed score note karna (baseline)
- [ ] Thin pages (3 se kam projects) par noindex rule lagana — decision ke baad
- [ ] Non-project pins ko project pages se hatana
- [ ] 1200×630 OG share image banana aur `SITE.ogFallback` update karna
- [ ] GSC me sitemap submit aur GA4/GTM ID confirm karna
- [ ] 2 naye blog posts draft karna (locality guide + buyer guide)
