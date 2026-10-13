# Mappingg — SEO Status Report & Pending Work

**Date:** 13 Oct 2026 · **Website:** www.mappingg.com
Pichhli report: `seo-doc/SEO-REPORT.md` (10 Oct 2026). Ye report usi ka update hai: live site ka naya audit, 10 Oct ke baad kya hua, aur kya kya baaki hai.

## 1. Summary

Website ki **technical SEO bahut achhi hai**: har tested page par Lighthouse SEO, Accessibility aur Best Practices **100/100** hain. Sitemap 504 se **738 URLs** par pahunch gaya hai aur blog 12 se **16 posts** par.

Asli kami 4 jagah hai:
1. **Thin pages:** 212 locality/developer pages par 3 se kam project.
2. **Adhoora project data:** aadhe projects mein price, BHK ya RERA nahi hai.
3. **Search Console API band hai.** Isliye clicks, impressions aur keywords ka data nahi mil raha.
4. **Backlinks aur Google Business Profile** abhi tak shuru nahi hue.

| Area | Status | Ek line mein |
| --- | --- | --- |
| Technical SEO (title, canonical, robots, sitemap, schema) | Done | Live verify kiya, sab sahi |
| Lighthouse SEO score | 100/100 | Home, blog, locality, projects, contact (mobile) |
| Blog | 16 posts live | 4 naye aaj publish hue; pagination tayyar hai (deploy baaki) |
| Speed (mobile) | Mixed | Blog/locality 93–97; home 74, contact 64 (inline JS bhari hai) |
| Thin pages | Badhi | 71 locality + 141 developer pages par 3 se kam project |
| Project data | Adhoora | 415 mein se 219 bina price, 222 bina BHK, 183 bina RERA |
| Search Console data | Band | Google Cloud mein Search Console API enable nahi hai |
| Social share image (OG) | Baaki | Abhi bhi logo icon, 1200×630 image nahi |
| Backlinks / Google Business Profile | Shuru nahi | — |

## 2. Live audit (13 Oct 2026)

### Sitemap: 738 URLs (10 Oct: 504)

| Type | URLs |
| --- | --- |
| Projects `/projects/...` | 416 |
| Developers `/developers/...` | 175 |
| Localities `/locations/...` | 103 |
| Blog (index + posts) | 13, 10 minute ke cache refresh ke baad 17 hoga |
| Property type / Status / Cities | 10 / 3 / 3 |
| Info pages (home, map, about, contact, faq…) | 15 |

Baaki checks:
- `robots.txt`: admin, dashboard, API, sign-in aur intake blocked hain. Sitemap linked hai. Sahi.
- Search Console verification meta tag live hai. GTM `GTM-59Q6QBP6` live hai, consent ke baad load hota hai.
- `http://mappingg.com` redirect karta hai (308) aur canonical `https://www.mappingg.com` hai.
- OG (share) image abhi bhi `mappingg-icon-mark.png` (logo) hai. WhatsApp/Facebook par chhota logo dikhta hai.

### Lighthouse (mobile, lab test, 13 Oct)

Google ki PageSpeed API ki daily quota khatam thi, isliye wahi Lighthouse 12.8 is computer par Edge mein chalaya. Lab numbers hain, real-user (field) data nahi.

| Page | Performance | SEO | Accessibility | Best practices | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home `/` | 74 | 100 | 100 | 100 | 1.9 s | 0 | 1,350 ms |
| Blog post `/blog/3-bhk-flats-in-pune` | 93 | 100 | 100 | 100 | 2.3 s | 0 | 180 ms |
| Locality `/locations/kharadi` | 97 | 100 | 100 | 100 | 1.5 s | 0 | 180 ms |
| Projects list `/projects` | 89 | 100 | 100 | 100 | 1.6 s | 0 | 420 ms |
| Contact `/contact` | 64 | 100 | 100 | 100 | 3.8 s | 0 | 1,300 ms |

**Speed ki wajah:** home aur contact page ke HTML ke andar ka JavaScript main thread ko rokta hai. Home par ~4.4 s aur contact par ~2.7 s ka script kaam hota hai, aur page ka HTML 218 KB ka hai jismein 26 inline scripts hain. Page ka size theek hai (485–600 KB).

### Project data ki quality (415 public pins)

| Kami | Projects | Asar |
| --- | --- | --- |
| Price nahi | 219 | Project page aur blog tables mein "Price on request" dikhta hai; CTR kam |
| Configuration (BHK) nahi | 222 | "3 BHK in Kharadi" jaisi searches mein page nahi aata |
| MahaRERA number nahi | 183 | Bharosa (E-E-A-T) kam; ziyada tar Mumbai/registry imports |
| Photo nahi | 189 | Project card aur image search mein kamzor |
| Location khaali | 40 | Locality page aur breadcrumbs nahi bante |
| Developer naam CAPS mein | 12 | Jaise "KRISALA DEVELOPERS"; "SANTAIGO REALTY" aur "SANTIAGO REALITY" jaise duplicate bhi |

### Thin pages

| Page type | Kul | 3 se kam project | Sirf 1 project |
| --- | --- | --- | --- |
| Localities | 101 | **71** | 51 |
| Developers | 174 | **141** | 108 |

Ye ~212 pages (sitemap ka ~29%) Google ko kam-quality lag sakte hain, jisse poori site ki ranking dab sakti hai.

## 3. 10 Oct ke baad kya kiya (11–13 Oct)

| Kaam | Kahan |
| --- | --- |
| Blog 12 → **16 posts** live: "2 BHK Flats in Pune", "Luxury Flats & Villas", **"New Projects in Navi Mumbai"**, **"New Projects in Kalyan, Dombivli, Palava & Thane"** (pehle Mumbai/MMR guides) | `migration/seed-blogs.mjs` |
| Blog pagination: 9 blogs per page, `/blog?page=2`, har page ka apna canonical, galat page par 404 | `app/blog/page.tsx`, `app/blog/blog.css` (deploy baaki) |
| Locality, city, developer, project pages ka font aur header overlap bug fix (Times New Roman → Inter) | `app/seo.css` (live) |
| Contact page redesign: buyer details (city, locality, budget, BHK, timeline) aur call/WhatsApp ke alag, pehle se untick consent boxes | `components/ContactForm.tsx`, `app/api/contact/route.ts` (live) |
| Contact page par asli website ka "How Mappingg works" demo video | `components/MappinggExplainer.tsx`, `public/video/` (live) |
| YouTube buyer guide video (3:14, 1080p) + thumbnail + chapters | `C:\Users\Pushkar\Videos\` |
| s-admin leads mein naye status: Call not answered, Call back, Spam (dropdown) | `components/admin/AdminApp.tsx` |
| Blog cover generator: MMR covers ke liye custom pins aur tagline | `migration/blog-covers.mjs` |

**10 Oct ke "pehle 30 din" checklist ka status:**

| Item | Status |
| --- | --- |
| Thin pages par noindex rule | Baaki |
| Non-project pins hatana | Baaki |
| OG image 1200×630 | Baaki |
| Developer naam Title Case | Baaki |
| GSC sitemap submit + GA4 confirm | GTM live hai; GSC API band hone se sitemap status check nahi ho saka |
| PageSpeed baseline | Done (Lighthouse lab, upar ki table) |
| Google Business Profile | Baaki |
| 8–12 naye blog posts | 4 ho gaye (12 → 16) |

## 4. Kya kya kaam baaki hai

### A. SEO: ye kaam main code mein kar sakta hoon (aapki haan chahiye)

| # | Kaam | Asar | Mehnat |
| --- | --- | --- | --- |
| 1 | Thin pages (3 se kam project) ko `noindex` karna aur sitemap se hatana | High | Kam |
| 2 | 1200×630 OG share image banana, `SITE.ogFallback` update karna | Medium | Kam |
| 3 | Home aur contact page ka inline JavaScript halka karna (TBT 1.3 s → <300 ms) | Medium | Medium |
| 4 | Developer naam Title Case mein, duplicate developer naam merge karna | Low | Kam |
| 5 | Non-project pins (jaise advisory office) ko project pages se hatana | Medium | Kam |
| 6 | Blog page ka heading "Pune real estate, made clear" → Pune & Mumbai (ab MMR blogs bhi hain) | Low | Kam |
| 7 | Locality pages ke intro mein har area ka alag text (abhi sab par ek hi template) | High | Medium |
| 8 | Buyers ke liye "How it works" page/section (abhi home aur `/how-it-works` developer-focused hain) | Medium | Medium |

### B. SEO: ye kaam aapko (ya team ko) karne honge

| # | Kaam | Kyun |
| --- | --- | --- |
| 1 | **Google Cloud project 847257037149 mein "Google Search Console API" enable karo:** https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=847257037149 | Iske bina admin SEO tab aur ye report clicks, impressions aur keywords nahi dikha sakte |
| 2 | Search Console mein `https://www.mappingg.com/sitemap.xml` submit/confirm karo | 738 URLs index hone ke liye |
| 3 | Google Business Profile banao (NAP footer jaisa hi) | Local search aur Maps |
| 4 | Projects ka data poora karo: price, BHK, RERA, photo (sabse pehle Mumbai/MMR imports) | Project pages aur blog tables strong honge |
| 5 | Backlinks: developers se "View on Mappingg" link, Justdial/Sulekha listing, local PR | Ranking ka sabse bada lever |
| 6 | YouTube video upload karo aur blog/contact page par link do | Video search + brand |
| 7 | Har hafte 2–4 naye blog posts (main likh sakta hoon, topics confirm karo) | Content target 30–45 posts |

### C. Website / CRM / compliance: baaki kaam (is session mein mile)

| # | Kaam | Kyun / kahan |
| --- | --- | --- |
| 1 | **Blog pagination deploy karna** (2 files commit baaki) | `app/blog/page.tsx`, `app/blog/blog.css` |
| 2 | Live map enquiry form ka consent box **pehle se tick** hai, use untick karna | DPDP Act ke hisaab se pre-ticked consent valid nahi; `public/legacy/public-map.json` |
| 3 | Signed-in "Enquire now" `consent: true` apne aap save karta hai | `app/api/my/enquire/route.ts` |
| 4 | Sign-up par sirf WhatsApp ki permission hai; call ke liye alag, untick option aur har user ka consent record nahi hai | `components/landing/body.ts`, signup API |
| 5 | s-admin mein "Do not contact" / opt-out list nahi hai | Lead import spec: `Developer_Projects/Lead_Generation_Research/` |
| 6 | Production lead tables mein staff ki test entries ("Divya Test" etc.) | Reports aur counts bigadti hain |
| 7 | Contact form ka spam honeypot request ko chupchaap accept karne ke bajaye 400 error deta hai | `app/api/contact/route.ts` (chhota bug) |
| 8 | Buyer leads: abhi 0 call-ready leads; 500 ke liye Google/Meta ads aur consent fix pehle | `Buyer_Leads/`, `Developer_Projects/Lead_Generation_Research/` |

## 5. Agle 2 hafte ka suggested order

1. **Aaj/kal:** blog pagination deploy · Search Console API enable · sitemap confirm.
2. **Is hafte (main code karunga, aapki haan par):** thin pages noindex · OG image · developer naam cleanup · blog heading · map form consent untick.
3. **Agle hafte:** home/contact speed fix · locality intro text (top 15 areas) · 4 naye blog posts · Google Business Profile (aap) · project data bharna (team).

## Data sources aur limitations

- Sitemap, robots, tags: live www.mappingg.com se 13 Oct ko fetch kiye.
- Lighthouse: local lab test (mobile emulation, simulated throttling), real-user data nahi. Google PageSpeed API ki daily quota khatam thi.
- Thin pages aur data gaps: live database ke 415 public pins se, site ke apne locality/slug logic ke saath gine (read-only).
- Search Console: data nahi mila, kyunki API Google Cloud project mein disabled hai. Clicks, impressions, keywords aur indexed pages ki ginti is report mein **nahi** hai.
