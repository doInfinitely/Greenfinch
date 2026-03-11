export type PlanTier = 'starter' | 'team' | 'enterprise';

export interface PlanTierMeta {
  key: PlanTier;
  displayName: string;
  description: string;
  sortOrder: number;
  highlighted?: boolean;
  ctaLabel: string;
  features: string[];
  perSeatPriceUsd: number; // cents — 0 means no additional seat charge
  maxSeats: number | null; // null = unlimited
}

export const PLAN_TIERS: Record<PlanTier, PlanTierMeta> = {
  starter: {
    key: 'starter',
    displayName: 'Starter',
    description: 'For individual brokers getting started',
    sortOrder: 1,
    ctaLabel: 'Get Started',
    perSeatPriceUsd: 0,
    maxSeats: 1,
    features: [
      '1 seat included',
      'Basic enrichment credits',
      'Property search & filters',
      'Email discovery',
      'Standard support',
    ],
  },
  team: {
    key: 'team',
    displayName: 'Team',
    description: 'For growing brokerage teams',
    sortOrder: 2,
    highlighted: true,
    ctaLabel: 'Upgrade to Team',
    perSeatPriceUsd: 3900, // $39/seat/month
    maxSeats: 25,
    features: [
      '5 seats included',
      '$39/seat/mo for additional seats',
      'Everything in Starter',
      'Pipeline management',
      'Territory assignments',
      'Priority support',
    ],
  },
  enterprise: {
    key: 'enterprise',
    displayName: 'Enterprise',
    description: 'For large organizations with custom needs',
    sortOrder: 3,
    ctaLabel: 'Contact Sales',
    perSeatPriceUsd: 2900, // $29/seat/month (volume discount)
    maxSeats: null, // unlimited
    features: [
      'Unlimited seats',
      '$29/seat/mo for additional seats',
      'Everything in Team',
      'Dedicated account manager',
      'Custom integrations',
      'SLA & SSO',
    ],
  },
};

export type PlanDirection = 'upgrade' | 'downgrade' | 'same';

export function getPlanDirection(currentSortOrder: number, targetSortOrder: number): PlanDirection {
  if (targetSortOrder > currentSortOrder) return 'upgrade';
  if (targetSortOrder < currentSortOrder) return 'downgrade';
  return 'same';
}

export const CANCELLATION_REASONS = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'missing_features', label: 'Missing features I need' },
  { value: 'switching', label: 'Switching to another product' },
  { value: 'not_using', label: 'Not using it enough' },
  { value: 'temporary', label: 'Only needed it temporarily' },
  { value: 'other', label: 'Other' },
] as const;

export type CancellationReason = typeof CANCELLATION_REASONS[number]['value'];
