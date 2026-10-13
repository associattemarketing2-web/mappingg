# Pune & Mumbai Business Prospect Research

**File:** `pune_mumbai_business_prospects.xlsx`
**Research date:** 11 Oct 2026. All records were last verified on this date.

This is a research dataset of real, source-backed people. Nothing in it was invented. Where evidence was missing, the cell is left blank or marked "Not publicly verified".

## Counts (from the programmatic validation of the saved workbook)

| Metric | Count |
|---|---|
| Total unique records | 204 |
| Pune / Mumbai | 46 / 158 |
| **Individually verified net worth ≥ ₹5 crore** (sheet "Verified Wealth Evidence") | **83** |
| Business prospects, net worth unverified (sheet "Business Prospects") | 121 |
| Records with a verified public business phone | 30 |
| Records with a verified public professional email | 24 |
| Records with an official website | 171 (143 reachable by script on 11 Oct 2026) |
| Property Interest Filter (signals A + B + C) | 49 |
| Research confidence High / Medium / Low | 37 / 147 / 20 |
| Records flagged for manual review | 92 |
| Logged exclusions (sheet "Exclusions Log") | 57 rows |

## Worksheets

1. **All Prospects.** Every record, with 32 columns: the 21 requested columns plus separate evidence columns covering identity and affiliation source, city evidence, website and contact verification status, property signal, property evidence and source, data currency, and a manual-review flag.
2. **Pune** and 3. **Mumbai.** City subsets.
4. **Verified Wealth Evidence.** Only people whose net worth is published individually, or for the individual and family, by:
   - Forbes Real-Time Billionaires (75 people). Residence is Mumbai or Pune per Forbes. Figures are in USD, converted at ₹96.73/USD (ECB reference rate, 9 Oct 2026).
   - Press reports of the M3M Hurun India Rich List 2025 and the GROHE-Hurun Real Estate Rich List 2026 (8 people).

   Every figure here is above ₹1,000 crore.
5. **Business Prospects.** Founders, promoters, directors and executives with credible business-scale evidence (Wikipedia, exchange filings, official board pages, or reported property purchases). **They are not confirmed ₹5 crore+ individuals.**
6. **Property Interest Filter.** Your extra request ("people interested in buying property"). Read the signals carefully:
   - **A – Publicly reported residential/property purchase** (18 people). A news report, usually citing IGR registration data via Zapkey, IndexTap, Square Yards or CRE Matrix, says the person (or their family or trust) bought property.
   - **B – Reported luxury lease** (1 person).
   - **C – Leads a real-estate business** (30 people). This is a business interest, not personal buying intent.
   - Nothing here proves a *current* intention to buy, and nobody has consented to be contacted about property. No public, lawful source records personal "interest in buying property". Producing a list of 200 people "interested in property" would have meant inventing it.
7. **Sources and Methodology.** Source inventory, reliability, usage limits and method.
8. **Exclusions Log.** Every excluded candidate and why: deceased, legal proceedings, outside Pune/Mumbai, no verifiable source, ambiguous Wikipedia match, unreliable source, and so on.

## Verification method

- **Wealth:** taken only from Forbes and Hurun as published. Net worth is never inferred from revenue, valuation, market cap, funding, AUM or property prices. Property values appear only in the property columns.
- **Identity, company and city:** checked through the Wikipedia API (the title must match the person; the text must mention the company and Mumbai/Pune), exchange filings (NSE/BSE), official company board pages, or the transaction report itself. Where only the company's headquarters supports the city, the record is marked "personal residence not documented" and flagged.
- **Contacts:** robots.txt was checked first, then one homepage request was made per company domain. Only `tel:`/`mailto:` links published by the organisation were kept, and careers, security and personal-looking entries were dropped. **These are company channels, not the individual's personal contacts.** No emails were guessed, no numbers generated, and no data brokers, leaked data, social media or CAPTCHA/paywall bypassing were used.
- **Deduplication:** by normalised name. The validator reopens the saved workbook and checks sheet names, row subsets, column types, duplicates, URL formats, missing evidence, and that no unverified record carries a net-worth figure.

## Known limitations and remaining manual work

- **Titles** were not machine-verified for the Forbes and Wikipedia records. Confirm them on each company's current board page.
- **Low-confidence and city-from-HQ records** (see "City Evidence"): confirm Pune/Mumbai residence.
- **Nine Forbes records have no company name** (Alpana Dangi, Chaitanya and Kushal Desai, Girdhari Lal and Banwari Lal Bawri, Rajesh Sharma, Naresh Jain, Nanu Gupta, Sanjeev Shah). Forbes gives only an industry; identify the company manually.
- **Forbes figures are real-time** and change daily. The Hurun 2025 figures are from October 2025.
- **hurun.net returned HTTP 503**, so the full Hurun India list (465 Mumbai and about 66 Pune entrants) could not be used. Retrying it would add many more verified records.
- **Property-news sources:** several publishers block automated fetching (HTTP 403), so some articles were read through search-engine summaries. Lifestyle and blog sources are flagged. Check them against IGR Maharashtra records.
- **Conflicting figures** (e.g. ₹230 vs ₹240 crore, 23 vs 28 units) are noted in "Data Quality Notes".
- **Contacts:** 170+ records have no captured company phone or email. Check investor-relations pages manually.

## Use restrictions

For internal research only. Before any outreach, comply with India's Digital Personal Data Protection Act 2023 and its rules, TRAI/DND rules for calls and SMS, and the source sites' terms. Do not republish Forbes or Hurun data. Contact people only through company channels and honour opt-outs. This folder has **not** been committed or uploaded anywhere.
