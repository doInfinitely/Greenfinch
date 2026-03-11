import { db } from '../src/lib/db';
import { eq } from 'drizzle-orm';
import { creditTiers, creditActionCosts, creditPacks } from '../src/lib/schema';

async function seed() {
  console.log('Seeding credit system...');

  // Seed credit tiers
  const tiers = [
    {
      name: 'starter',
      displayName: 'Starter',
      monthlyCredits: 500,
      rolloverCap: 250,
      monthlyPriceUsd: 4900, // $49/mo
      seatsIncluded: 2,
      features: ['500 credits/month', '2 seats included', 'Email support'],
      sortOrder: 0,
    },
    {
      name: 'pro',
      displayName: 'Pro',
      monthlyCredits: 2000,
      rolloverCap: 1000,
      monthlyPriceUsd: 14900, // $149/mo
      seatsIncluded: 5,
      features: ['2,000 credits/month', '5 seats included', 'Priority support', 'Advanced analytics'],
      sortOrder: 1,
    },
    {
      name: 'enterprise',
      displayName: 'Enterprise',
      monthlyCredits: 10000,
      rolloverCap: 5000,
      monthlyPriceUsd: 49900, // $499/mo
      seatsIncluded: 20,
      features: ['10,000 credits/month', '20 seats included', 'Dedicated support', 'Custom integrations', 'SSO'],
      sortOrder: 2,
    },
  ];

  for (const tier of tiers) {
    await db
      .insert(creditTiers)
      .values(tier)
      .onConflictDoUpdate({
        target: creditTiers.name,
        set: {
          displayName: tier.displayName,
          monthlyCredits: tier.monthlyCredits,
          rolloverCap: tier.rolloverCap,
          monthlyPriceUsd: tier.monthlyPriceUsd,
          seatsIncluded: tier.seatsIncluded,
          features: tier.features,
          sortOrder: tier.sortOrder,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ Tier: ${tier.displayName}`);
  }

  // Seed action costs
  const actions = [
    { action: 'contact_enrich', displayName: 'Contact Research', creditCost: 5, category: 'enrichment', description: 'Full contact enrichment via cascade pipeline' },
    { action: 'email_lookup', displayName: 'Email Discovery', creditCost: 3, category: 'enrichment', description: 'Email waterfall lookup (Findymail + Hunter)' },
    { action: 'phone_lookup', displayName: 'Phone Lookup', creditCost: 3, category: 'enrichment', description: 'Phone waterfall lookup (multiple providers)' },
    { action: 'property_enrich', displayName: 'Property AI Enrichment', creditCost: 10, category: 'research', description: 'AI-powered property analysis and enrichment' },
    { action: 'org_enrich', displayName: 'Organization Enrichment', creditCost: 3, category: 'enrichment', description: 'Organization data enrichment via SerpAPI + LLM' },
  ];

  for (const a of actions) {
    await db
      .insert(creditActionCosts)
      .values(a)
      .onConflictDoUpdate({
        target: creditActionCosts.action,
        set: {
          displayName: a.displayName,
          creditCost: a.creditCost,
          category: a.category,
          description: a.description,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ Action: ${a.displayName} (${a.creditCost} credits)`);
  }

  // Seed credit packs
  const packs = [
    { name: 'Starter Pack', credits: 500, priceUsd: 3900, sortOrder: 0 },    // $39 = $0.078/credit
    { name: 'Growth Pack', credits: 2000, priceUsd: 12900, sortOrder: 1 },   // $129 = $0.065/credit
    { name: 'Scale Pack', credits: 5000, priceUsd: 24900, sortOrder: 2 },    // $249 = $0.050/credit
  ];

  // Use upsert by checking existing packs
  for (const pack of packs) {
    const existing = await db
      .select()
      .from(creditPacks)
      .where(eq(creditPacks.name, pack.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(creditPacks).values(pack);
      console.log(`  ✓ Pack: ${pack.name} (${pack.credits} credits, $${(pack.priceUsd / 100).toFixed(2)})`);
    } else {
      console.log(`  - Pack: ${pack.name} already exists, skipping`);
    }
  }

  console.log('\nSeed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
