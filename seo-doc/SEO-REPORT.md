# Mappingg Website — SEO Report & Plan

10 Oct 2026

Live doc: https://claude.ai/code/artifact/ad78a97e-c14f-4cb6-b0ad-437b9a4d68ec

## Summary

Mappingg ki technical SEO foundation lagbhag poori ho chuki hai: live sitemap me **504 indexable URLs** hain, har page ka unique title, canonical aur JSON-LD schema hai. Ab ranking ka kaam **content, backlinks aur performance** par tika hai, jo abhi shuru hi hua hai.

| Area | Status | Ek line me |
| --- | --- | --- |
| Technical SEO (meta, canonical, robots, sitemap) | Done | Live site par verify kiya, sab sahi |
| Structured data (schema) | Done | Organization, WebSite, Breadcrumb, Residence, FAQ, Video, BlogPosting |
| Programmatic pages | Done | ~273 project, 83 locality, 104 developer, city/status/type pages |
| Blog content | Shuruaat | Sirf 12 posts live; target 30–45 posts in 3 months |
| Social share image (OG) | Baaki | Abhi logo icon use ho raha hai, 1200×630 image nahi |
| Core Web Vitals / speed | Partial | Map bundle optimize hua; clustering, images, LCP abhi baaki |
| Backlinks / local SEO | Baaki | Google Business Profile, directories, PR shuru nahi hue |
| Tracking (GSC, GA4) | Partial | GSC verify + admin dashboard bana; GA4/GTM aur sitemap submit confirm karna hai |

Sabse bada next lever: **har hafte 2–4 quality blog posts + Google Business Profile + backlinks**, saath me performance fixes.

## Abhi tak kya kya kiya

2 Oct se 10 Oct 2026 ke beech SEO ka poora technical base aur pehla content batch live hua. Dates git history me file add hone ki date se li gayi hain (commit messages me detail nahi hai).

| Date | Kaam | Kahan (file) |
| --- | --- | --- |
| 8 Oct | Website traffic analytics admin "SEO & Health" tab me | `components/admin/TrafficPanel.tsx`, `lib/site-analytics.ts` |
| 8 Oct | 12 blog posts ke cover images (v2/v3) | `public/img/blog/`, `migration/blog-covers.mjs` |
| 7 Oct | Google Search Console live data admin panel me (service account se) | `lib/search-console.ts`, `SearchConsolePanel.tsx` |
| 7 Oct | Khaali project SEO fields bhare: location, developer, price, description (bina overwrite) | `migration/fill-pin-seo.mjs` |
| 7 Oct | Cookie consent + Google Consent Mode, PWA manifest | `CookieConsent.tsx`, `app/manifest.webmanifest` |
| 6 Oct | 12 SEO blog articles seed kiye (locality, RERA, stamp duty, home loan) | `migration/seed-blogs.mjs` |
| 4 Oct | Programmatic pages: project, locality, developer, city, status, property-type | `app/projects`, `app/locations`, `app/developers`, `app/cities`, `app/status`, `app/property` |
| 4 Oct | Central metadata builder: unique title, description, canonical, OG, Twitter | `lib/seo/metadata.ts`, `lib/seo/config.ts` |
| 4 Oct | JSON-LD schema: Organization, WebSite, Breadcrumb, ItemList, Residence, FAQ, Video | `lib/seo/schema.ts` |
| 4 Oct | Project images DB (base64) se files me migrate karne ki script | `migration/migrate-project-images.mjs` |
| 4 Oct | SEO Playbook document (strategy, keyword map, routine) | `docs/SEO-PLAYBOOK.md` |
| 3 Oct | Performance audit + map bundle optimization (lazy popup cards, lighter payload) | `PERFORMANCE_AUDIT.md`, `PERFORMANCE_OPTIMIZATION_REPORT.md` |
| 2 Oct | Dynamic `sitemap.xml` (real lastModified) aur `robots.txt` (admin/API blocked) | `app/sitemap.ts`, `app/robots.ts` |
| 2 Oct | SEO health charts admin dashboard me | `components/admin/SeoCharts.tsx` |

Iske alawa:

- Canonical domain `www.mappingg.com` fix kiya; apex `mappingg.com` 308 redirect karta hai (live check kiya).
- Search Console verification aur GTM/GA4 ID admin Settings se edit hote hain; GTM consent ke baad lazy-load hota hai taaki speed na gire.
- Project images ke alt text me naam + developer + locality auto aata hai.
- Har detail page ISR (10 min) par hai: naya pin add karte hi naya SEO page aur sitemap entry apne aap ban jaati hai.

## Technical SEO audit (live site, 10 Oct 2026)

Live www.mappingg.com par har page type ka ek sample check kiya: sab pages 200 dete hain, ek H1, sahi canonical aur valid schema hai. Asli problem **content ki gehraai** hai, technical setup nahi.

| Page type | Sitemap URLs | Title / Canonical | Schema | Mili problem |
| --- | --- | --- | --- | --- |
| Home `/` | 1 | Sahi | Organization, WebSite | OG image sirf logo icon hai; HTML 218 KB aur 82 images |
| Live map `/map` | 1 | Sahi | ItemList (200 projects) | Map JS se banta hai; crawlable text bahut kam |
| Project `/projects/...` | 273 | Sahi | Residence, FAQ, Video, Breadcrumb | Sirf ~275 words; pehli load 2–3.3 sec (cache ke baad 0.6 sec) |
| Locality `/locations/...` | 83 | Sahi | ItemList, FAQ, Breadcrumb | 45 pages me sirf 1 project; intro text sab pages pe same template |
| Developer `/developers/...` | 104 | Sahi | ItemList, FAQ, Breadcrumb | 67 pages me sirf 1 project; kuch naam CAPS me ("KOHINOOR GROUP") |
| City / Status / Type | 3 / 3 / 7 | Sahi | ItemList | Theek |
| Blog `/blog/...` | 12 posts | Sahi | BlogPosting, ImageObject | Content accha (1,400+ words); bas quantity kam |
| Info pages (about, faq…) | 13 | Sahi | Organization | About page me content kam (E-E-A-T ke liye team/office info chahiye) |

Baaki checks:

- `robots.txt` admin, dashboard, API sahi block karta hai; sitemap linked hai.
- Galat URL par sahi 404 status aata hai.
- Sab images me alt text hai (sample pages me 0 missing).
- Kuch non-project pins bhi project pages ban gaye, jaise "Associatte - Your Real Estate Advisory" (Magarpatta). Ye thin aur irrelevant hai.
- PageSpeed Insights (LCP, CLS, INP) aaj nahi chal paya: public API ki daily quota khatam thi. Isko GSC ke Core Web Vitals report ya pagespeed.web.dev se manually check karna hai.

## Kya kya baaki hai (gaps)

Sabse badi kami: **~110 thin pages** (1 project wali locality aur developer pages) aur **project pages par kam content**. Google inhe low-quality maan sakta hai, jisse poori site ki ranking dab sakti hai.

| # | Gap | Asar | Mehnat |
| --- | --- | --- | --- |
| 1 | 45 locality + 67 developer pages me sirf 1 project (thin content) | High | Kam (noindex rule) |
| 2 | Project pages ~275 words; RERA number, amenities, price range, nearby places nahi dikhte | High | Medium |
| 3 | Locality pages ka intro sab jagah same template text | High | Medium (har area ka unique guide) |
| 4 | Blog sirf 12 posts; playbook target 30–45 posts in 12 weeks | High | Ongoing |
| 5 | Google Business Profile nahi bana (local search + Maps) | High | Kam |
| 6 | Backlinks ka koi kaam shuru nahi (directories, PR, builder partners) | High | Ongoing |
| 7 | OG share image 1200×630 nahi; WhatsApp/Facebook share par logo icon dikhta hai | Medium | Kam |
| 8 | Non-project pins (advisory office jaise) project pages ban rahe hain | Medium | Kam |
| 9 | Project page pehli load 2–3 sec; map me clustering/viewport loading baaki | Medium | Medium |
| 10 | Core Web Vitals measure nahi hue (PSI quota), images WebP/CDN par nahi | Medium | Medium |
| 11 | Developer naam formatting (CAPS) inconsistent | Low | Kam |
| 12 | About page me team, office address, founding story kam (E-E-A-T) | Medium | Kam |
| 13 | GA4/GTM ID set hai ya nahi, aur GSC me sitemap submit hua ya nahi — confirm karna hai | Medium | Kam |
| 14 | Schema me Dubai "areaServed" hai par Dubai ka koi page nahi | Low | Kam |

## Aage ka plan (90 din)

Pehle 30 din thin pages aur basic gaps fix karo, taaki naya content strong base par aaye; uske baad content aur speed, phir authority (backlinks, PR).

| Phase | Dates | Kaam | Gate (aage badhne ki shart) |
| --- | --- | --- | --- |
| Din 1–30 · Fix aur foundation | 10 Oct – 9 Nov 2026 | Thin pages par noindex rule · Non-project pins hatao · OG image 1200×630 lagao · GSC sitemap + GA4 confirm · Google Business Profile banao · Project page: RERA, amenities · 8–12 blog posts publish | GSC me 0 indexing errors |
| Din 31–60 · Content aur speed | 10 Nov – 9 Dec 2026 | Top 15 locality guides likho · 8–12 aur blog posts · Map clustering + lazy load · Images WebP/CDN, CWV fix · Directories: Justdial, Sulekha · Builder backlink outreach · About page: team, office | CWV sab URLs Good |
| Din 61–90 · Authority | 10 Dec 2026 – 8 Jan 2027 | Monthly Pune launch report · PR pitch: 5 news portals · Guest posts: 2 per month · Comparison blog cluster · Purane posts refresh · YouTube walkthroughs embed · KPI review, next quarter plan | 40+ posts, 20+ domains |

Har phase ka gate poora hone par hi agle phase ka focus shift karo; content aur blog teeno phase me chalta rahega.

### Pehle 30 din ki detailed checklist

- [ ] Locality/developer page par rule: 3 se kam projects ho to `noIndex: true` aur sitemap se hatao (`lib/seo/metadata.ts`, `app/sitemap.ts`)
- [ ] Non-project pins (advisory office jaise) ko public project list se exclude karo (`lib/seo/entities.ts`)
- [ ] `public/og/default.png` 1200×630 banao aur `SITE.ogFallback` usse point karo (`lib/seo/config.ts`)
- [ ] Project page par RERA number, amenities, price range, possession date, nearby places dikhao (data ho to)
- [ ] Developer naam Title Case me normalize karo ("KOHINOOR GROUP" → "Kohinoor Group")
- [ ] GSC me `https://www.mappingg.com/sitemap.xml` submit confirm karo; Pages report me errors check karo
- [ ] Admin Settings me GTM/GA4 ID set hai confirm karo; organic leads track karo
- [ ] pagespeed.web.dev par home, map, ek project, ek locality page ka mobile score note karo (baseline)
- [ ] Google Business Profile banao aur verify karo
- [ ] 8–12 naye blog posts (locality guides + buyer/legal)

## Content, local aur off-page plan + KPIs

Technical base ready hai, isliye agle 3 mahine ka 70% time content aur backlinks par jaana chahiye.

### Content (blog + pages)

- **Cadence:** pehle 12 hafte 2–4 posts/week (30–45 posts), phir 1–2/week. Har post 1,200–2,000 words, 2–4 internal links locality/project pages par.
- **Locality guides (top 15 areas):** Kharadi, Mundhwa, Wagholi, Hinjewadi, Baner, Balewadi, Hadapsar, Viman Nagar, Magarpatta, Kothrud, Wakad, PCMC, Thane, Navi Mumbai, Andheri. Har guide = connectivity, price trend, schools/hospitals, upcoming infra.
- **Buyer/legal cluster:** documents checklist, possession delay rights, carpet vs built-up area, GST on flats, PMAY subsidy, NRI buying guide.
- **Comparison cluster:** "Kharadi vs Wagholi", "Pune vs Navi Mumbai", "Hinjewadi vs Baner for IT professionals".
- **Data-led content (link magnet):** monthly "Pune new launches report" Mappingg ke apne 270+ project data se. Yahi backlinks laayega.
- Purane posts har 3 mahine refresh karo (date, prices, naye projects).

### Local SEO

- Google Business Profile banao: naam, address, phone footer jaisa hi (NAP same), category "Real estate consultant", photos, weekly posts.
- Real customers se genuine Google reviews maango (fake reviews bilkul nahi).
- Justdial, Sulekha, IndiaMART, 99acres/MagicBricks agent profile, Housing.com par same NAP ke saath listing.

### Off-page / backlinks

- Builder partners: har listed developer se "View on Mappingg" link unki site par maango (104 developers = 104 outreach).
- PR: local news/real estate portals ko data report pitch karo (Pune Mirror, Hindustan Times Estates, Moneycontrol real estate).
- Guest posts: real estate aur finance blogs par 2/month.
- Social: Instagram reels, YouTube project walkthroughs (VideoObject schema already ready), LinkedIn posts — har ek website ke page par link kare.
- Quora / Reddit (r/pune) par genuine answers jahan relevant ho.

### Track karne wale KPIs (monthly)

| KPI | Kahan dekhe | 3 mahine ka realistic target |
| --- | --- | --- |
| Indexed pages | GSC → Pages | 350+ (thin pages hata ke) |
| Organic clicks | GSC → Performance | Month-on-month growth |
| Impressions + avg position | GSC → Performance | Locality queries top 20 me |
| Core Web Vitals | GSC → Experience | Sab URLs "Good" |
| Referring domains | GSC → Links / Ahrefs free | 20–30 genuine domains |
| Leads from organic | GA4 + admin leads panel | Track source wise |
| Blog posts live | Admin blog manager | 40+ |

Numbers ke targets abhi ka baseline nahi pata isliye approximate hain; GSC ka pehla month data aate hi set karo.
