# Plan management (upgrade/downgrade/cancel)
**Epic ID:** GF-48 | **Phase:** Phase II: Expanded Pilot | **Priority:** P1 — High | **Swim Lane:** Billing & Monetization | **Owner:** Remy | **Build Status:** NEW

**Description:** Self-service flows for orgs to upgrade their plan (e.g., Starter → Team), downgrade, or cancel their subscription. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of the current billing cycle. Cancellation includes a brief exit survey and a retention offer. This removes the need for founder involvement in every plan change and is essential for scaling beyond founder-led sales.

**Success Criteria:** Upgrade completes instantly with correct proration. Downgrade scheduled correctly for end of cycle with clear confirmation. Cancellation flow captures reason and offers retention incentive. Zero plan changes require manual admin intervention. Stripe subscription state always matches Greenfinch plan state.

**Comment (Remy):** Self-service upgrade, downgrade, and cancellation flows.
