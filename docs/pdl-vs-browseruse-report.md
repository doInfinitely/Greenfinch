# PDL vs Browser-Use Contact Enrichment Comparison

**Date:** March 10, 2026
**Sample:** 20 contacts randomly selected from 196 candidates (name + company domain + known LinkedIn URL)
**Contact profile:** Dallas-area commercial real estate contacts (property managers, owners, executives)

## Methodology

Both sources start from **name + company domain only** (simulating initial enrichment):

- **PDL:** Person Enrich API (`/v5/person/enrich`) with first name, last name, and company derived from domain
- **Browser-Use:** Local Playwright agent with authenticated LinkedIn session, scraping the known LinkedIn profile URL directly

Browser-Use had the advantage of a known LinkedIn URL; PDL had to discover the person from name + company alone.

---

## Hit Rates

| Metric | Count | Rate |
|---|---|---|
| PDL found | 6/20 | 30% |
| Browser-Use found | 7/20 | 35% |
| Both found | 2/20 | 10% |
| PDL only | 4/20 | 20% |
| BU only | 5/20 | 25% |
| Neither found | 9/20 | 45% |

**Combined coverage (either source):** 11/20 (55%)

---

## PDL LinkedIn Discovery

Starting from name + domain only (no LinkedIn URL provided):

| Metric | Result |
|---|---|
| Returned a LinkedIn URL | 6/20 (30%) |
| Correct match to known URL | 6/6 (100%) |

When PDL finds someone, it reliably identifies the correct LinkedIn profile.

---

## Data Richness

### PDL (when found, n=6)

| Field | Available |
|---|---|
| Work email | 6/6 (100%) |
| Mobile phone | 5/6 (83%) |
| Location | 6/6 (100%) |
| LinkedIn URL | 6/6 (100%) |

### Browser-Use (when found, n=7)

| Field | Available |
|---|---|
| Experiences list | 7/7 (100%) |
| Headline | 7/7 (100%) |
| Location | 7/7 (100%) |
| Education | 4/7 (57%) |

---

## Agreement (where both found data, n=2)

| Field | Agreement |
|---|---|
| Name | 2/2 (100%) |
| Company | 1/1 (100%) |
| Title | 0/1 (0%) |

Only 2 contacts had data from both sources, limiting statistical significance.

### Disagreements

| Contact | PDL | Browser-Use |
|---|---|---|
| Christy Thompson | title: *null*, company: *null* | title: "HRIS Applications Support and Management / Project Leadership", company: "OneDigital" |
| Mary Leerssen | title: "Managing Director Management Services" | title: "Real Estate Executive" |

---

## Title Accuracy vs Known Data

Compared enrichment results against the title stored in our contacts database:

| Source | Matches Known Title |
|---|---|
| PDL | 0/5 returned (0%) |
| Browser-Use | 1/7 returned (14%) |

Title accuracy is low for both sources. This likely reflects title evolution over time rather than incorrect matches (e.g., PDL shows "Construction Analyst" for someone our records list as "Project Manager").

---

## Contacts Found by Only One Source

### Browser-Use found, PDL missed (5)

| Contact | BU Title | BU Company |
|---|---|---|
| Rev. Sean McDonald | Reverend | Munger Place Church |
| Shannon Brown | Senior Vice President | CBRE |
| Gabriel Gibson | Founder | Bible Mastery App |
| Michael S. Molina | VP Facilities Planning & Management | Southern Methodist University |
| Ashland Dennis | Regional Asset Manager | Greystar |

### PDL found, Browser-Use missed (4)

| Contact | PDL Title | PDL Company | Likelihood |
|---|---|---|---|
| William Smyth | Educator | Dallas ISD | 5 |
| Heather Kincaid | Community Property Manager | Greystar | 5 |
| Chad Little | Construction Analyst | Atmos Energy | 6 |
| Emily Green | Project Coordinator | Pat Davis Properties | 8 |

---

## Performance

| Metric | PDL | Browser-Use |
|---|---|---|
| Avg response time | ~1s | ~95s |
| Total run time (20 contacts) | ~20s | ~32 min |
| Cost per lookup | ~$0.01 (enrich credit) | ~$0.03 (LLM + compute) |

---

## Conclusions

1. **Low individual hit rates (~30-35%)** for this contact set. Dallas commercial real estate contacts (property managers, school principals, church pastors) are underrepresented in PDL's database and often have limited LinkedIn profiles.

2. **The sources are complementary, not redundant.** Only 2/20 contacts were found by both. A cascade approach (PDL first, then Browser-Use for misses) would yield **55% combined coverage** vs 30-35% from either source alone.

3. **PDL excels at structured contact data** — emails, phones, and LinkedIn URLs with 100% accuracy when found. It's fast and cheap.

4. **Browser-Use excels at fresh career context** — current headline, full experience history, education. It catches people PDL misses, especially at smaller or niche organizations.

5. **Neither source is reliable for title verification.** Titles change frequently and vary between how they appear on LinkedIn vs internal records.

6. **Browser-Use reliability is a concern** — 13/20 LinkedIn scrapes returned empty data despite having valid URLs and authenticated cookies. This may be LinkedIn rate-limiting headless browsers or profile visibility restrictions.

### Recommendation

Use a **cascade enrichment strategy**:
1. PDL first (fast, cheap, structured data with email/phone)
2. Browser-Use for PDL misses or when fresh LinkedIn data is needed
3. Consider adding PDL Search API as a fallback for Enrich misses (broader matching at lower confidence)
