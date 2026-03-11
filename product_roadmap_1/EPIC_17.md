# Seat-based licensing
**Epic ID:** GF-45 | **Phase:** Phase II: Expanded Pilot | **Priority:** P1 — High | **Swim Lane:** Billing & Monetization | **Owner:** Remy | **Build Status:** NEW

**Description:** Per-seat pricing layered on top of the base subscription. Orgs pay a base fee plus an additional charge for each user seat ($39-$79/seat depending on tier). Admins can add and remove seats with prorated billing — adding a seat mid-cycle charges proportionally, removing one credits the balance. This is standard SaaS billing mechanics but critical for scaling revenue as orgs grow their teams on the platform.

**Success Criteria:** Seat additions/removals are reflected in billing immediately with correct proration. Seat count enforced — org can't exceed their seat limit without purchasing more. Admin sees per-seat cost breakdown in billing dashboard. Seat changes trigger appropriate Stripe subscription updates.

**Comment (Remy):** Per-seat pricing on top of base subscription. Add/remove seats with prorated billing.
