# PDL vs Browser-Use Contact Enrichment — Fair Comparison (v2)

**Date:** March 10, 2026
**Sample:** 2 runs of 20 contacts randomly selected from 337 candidates (name + company domain)
**Contact profile:** Dallas-area commercial real estate contacts (property managers, owners, executives)

## Methodology

Both sources start from **name + company only** — neither is given a LinkedIn URL:

- **PDL:** Person Enrich API (`/v5/person/enrich`) with first name, last name, and company derived from domain
- **Browser-Use:** DuckDuckGo search for LinkedIn URL → local Playwright agent scrapes the profile → **post-scrape person verification** (name + company fuzzy match)

This is a **fairer test** than v1, where Browser-Use was given the known LinkedIn URL directly.

Known LinkedIn URLs (where available) are used **only for validation** — to check whether each source found the correct person.

---

## Run 1: Without Person Verification

### Hit Rates

| Metric | Count | Rate |
|---|---|---|
| PDL found | 5/20 | 25% |
| Browser-Use found (unverified) | 10/20 | 50% |
| Both found | 2/20 | 10% |
| PDL only | 3/20 | 15% |
| BU only | 8/20 | 40% |
| Neither found | 7/20 | 35% |

**Combined coverage:** 13/20 (65%)

### The Wrong-Person Problem

Browser-Use's DDG search found *a* LinkedIn profile 85% of the time (17/20), but only 47% of those were the correct person. Examples:

| Searched For | Found Instead |
|---|---|
| Steve Bailey @ S2 Capital | Steven Bailey, CFO @ Match Group |
| Ginger Schmidt @ Willow Bridge | Allen England @ Willow Bridge |
| Natalie Cole @ Harkinson Dewan | Samantha S Dewan @ Harkinson Dewan |
| Mike Flores @ S2 Residential | Michele Flores @ Brazos Residential |
| Patrick Conner @ Pennybacker | Patrick Murray @ Pennybacker |

The DDG search returns results matching the company name but not necessarily the person.

---

## Run 2: With Person Verification

Added a post-scrape verification step that checks:
1. **Name match** — at least 2 token overlap, or matching last name + first name (with nickname support: Steve/Steven, Mike/Michael, Bob/Robert, etc.)
2. **Company match** — key words from the searched company must appear in the found company name or headline

Results where verification fails are rejected (marked as not found).

### Hit Rates (verified)

| Metric | Count | Rate |
|---|---|---|
| PDL found | 5/20 | 25% |
| Browser-Use found (verified) | 3/20 | 15% |
| Both found | 0/20 | 0% |
| PDL only | 5/20 | 25% |
| BU only | 3/20 | 15% |
| Neither found | 12/20 | 60% |

**Combined coverage:** 8/20 (40%)

### Verification Impact

| Metric | Before Verification | After Verification |
|---|---|---|
| BU "found" rate | 50% | 15% |
| BU accuracy (correct person) | ~50% | ~100% |
| Combined coverage | 65% | 40% |

The verification correctly rejected 4 wrong-person results:
- "Cole Stephens" → rejected "Adam Jaffe" (name mismatch)
- "Byron Ford" → rejected "Charles Massey III" (name mismatch)
- "Lisa Yockey" → rejected due to company mismatch (Avion Hospitality vs Doubletree Hotel)
- "Tanner Sinclair" → rejected "Tanner Hamilton" (name mismatch)

One false negative: Lisa Yockey actually was the right person but lists her hotel property rather than the management company as her employer.

---

## Browser-Use Failure Breakdown (Run 2, n=20)

| Stage | Count | Rate |
|---|---|---|
| DDG search found no LinkedIn URL | 8/20 | 40% |
| Found URL but wrong person (rejected by verification) | 2/12 | 17% |
| Found URL but extraction failed (no data scraped) | 4/12 | 33% |
| Found URL, wrong person but extraction failed (no data to verify) | 3/12 | 25% |
| **Successfully found, extracted, and verified** | **3/12** | **25%** |

The biggest bottleneck is DDG search not finding the person (40%), followed by the browser-use agent failing to extract data from the LinkedIn profile (33% of found URLs).

---

## Data Richness

### PDL (when found, n=5)

| Field | Available |
|---|---|
| Work email | 3/5 (60%) |
| Mobile phone | 2/5 (40%) |
| Location | 5/5 (100%) |
| LinkedIn URL | 4/5 (80%) |

### Browser-Use (when found & verified, n=3)

| Field | Available |
|---|---|
| Experiences list | 3/3 (100%) |
| Education | 3/3 (100%) |
| Location | 3/3 (100%) |
| Headline | 3/3 (100%) |

---

## Performance

| Metric | PDL | Browser-Use |
|---|---|---|
| Avg response time | ~1s | ~60s (search + scrape) |
| Total run time (20 contacts) | ~20s | ~14 min |
| Cost per lookup | ~$0.01 (enrich credit) | ~$0.03 (LLM + compute) |

---

## Comparison Across All Runs

| Metric | v1 (URL given) | v2 (no URL, no verify) | v2 (no URL, verified) |
|---|---|---|---|
| PDL hit rate | 30% | 25% | 25% |
| BU hit rate | 35% | 50% | 15% |
| BU correct person | 100% | ~50% | ~100% |
| Combined coverage | 55% | 65% | 40% |

---

## Conclusions

1. **Person verification is essential.** Without it, Browser-Use returns the wrong person ~50% of the time. With it, accuracy goes to ~100% but hit rate drops from 50% to 15%.

2. **PDL wins on precision.** 25% hit rate with high accuracy, structured data (email, phone), and fast response. It's the best primary source.

3. **Browser-Use adds marginal value as a fallback.** After verification, it only finds 3 additional contacts that PDL missed (15%). The combination yields 40% coverage vs 25% from PDL alone.

4. **The main bottlenecks for Browser-Use are:**
   - DDG search miss (40%) — many niche CRE contacts don't have prominent LinkedIn profiles
   - Profile extraction failure (33% of found URLs) — LinkedIn blocking headless scraping or agent timeout
   - Wrong-person matches (17% of found URLs) — mitigated by verification

5. **For this contact population (Dallas CRE), overall enrichment coverage is low** regardless of source. These are property managers, maintenance technicians, and school employees who are underrepresented in data enrichment databases.

### Recommendations

1. **PDL first** — fast, cheap, best accuracy. Use for all contacts.
2. **Browser-Use with verification for PDL misses** — adds ~15% incremental coverage with ~100% accuracy after verification.
3. **Consider PDL Search API** as a middle tier — broader matching than Enrich at lower confidence, may catch more candidates.
4. **Improve Browser-Use reliability** — the biggest gains would come from reducing profile extraction failures (currently 33%). Options:
   - Retry failed extractions with a simpler prompt
   - Use a non-headless browser or different browser fingerprint
   - Cache and reuse successful LinkedIn sessions
5. **Accept the coverage ceiling.** For niche CRE contacts, 40-55% coverage may be the practical limit from LinkedIn + PDL alone. Consider additional sources (company websites, industry directories, public records).
