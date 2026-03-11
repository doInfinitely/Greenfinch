# People Data Labs Enrichment: Miss Rate Analysis

**Prepared for Greenfinch**
**Date: March 2026**

---

## Summary

We ran a real-world enrichment test against People Data Labs' Person Enrichment API using **1,391 person records** with name + company as input signals. **PDL matched 6.4% of records**, missing 93.6%.

For Greenfinch's use case — enriching contractor and landscaper leads — this miss rate is a critical concern. Our test population skewed toward knowledge workers, but contractors, tradespeople, and small business operators are *less* likely to appear in PDL's dataset than the researchers and engineers we tested against.

---

## Raw Numbers

| Metric | Value |
|---|---|
| Records submitted | 1,391 |
| Matches returned | 89 |
| No match (404) | 1,302 |
| **Hit rate** | **6.4%** |
| **Miss rate** | **93.6%** |

Misses don't burn credits — PDL only charges on successful matches. So the cost risk is low, but the *coverage gap* is the problem: if you're building a lead enrichment pipeline, 94% of your records come back empty.

## Match Rate Scales with Public Visibility

We bucketed our test population by how prominent each person is (measured by publication volume as a proxy for professional visibility):

| Visibility | Queried | Matched | Rate |
|---|---|---|---|
| Very high | 3 | 2 | 67% |
| High | 79 | 16 | 20% |
| Medium | 155 | 18 | 12% |
| Low | 534 | 45 | 8% |
| Very low | 620 | 8 | 1% |

PDL works best for people who have a significant digital footprint — LinkedIn profiles, corporate email domains, news mentions. The long tail of less-visible professionals drops to a ~1% match rate.

## What PDL Returns When It Hits

Of the 89 successful matches, data quality was strong:

| Field | Coverage |
|---|---|
| Location | 99% |
| LinkedIn URL | 93% |
| Job title | 90% |
| Current company | 90% |
| Work email | 75% |

When PDL finds someone, the data is rich and actionable. The problem isn't quality — it's coverage.

## Comparison: OpenAlex (Academic Source)

As a sanity check, we also ran a subset of 166 records through OpenAlex, a free open academic index. It returned a 98.8% hit rate — but only for institutional emails and affiliations. No LinkedIn, no phone, no job title. This confirms our test population *does* exist in databases; PDL's dataset simply doesn't index them.

## Implications for Greenfinch

Our test population was knowledge workers — engineers, researchers, scientists. These are people with LinkedIn profiles, corporate emails, and digital paper trails. PDL still missed 94% of them.

Contractors, landscapers, and tradespeople typically have:
- No LinkedIn presence
- Personal Gmail/Yahoo emails, not corporate domains
- LLCs or sole proprietorships, not indexed companies
- Local visibility (Google Business, Yelp, Nextdoor) rather than professional network visibility

**PDL's miss rate for Greenfinch's target demographic is likely higher than 94%.**

## Recommendations

1. **Do not use PDL as a primary enrichment source for contractor leads.** The miss rate makes it unreliable as a standalone pipeline.
2. **Consider PDL as a supplementary layer** — when it hits, the data is excellent. Since misses are free, there's no cost downside to trying, but don't build workflows that depend on it.
3. **Evaluate sources built for local/SMB data** — Google Places API, Yelp Fusion, state contractor license databases, and local business registries will have far better coverage for the Greenfinch persona.
