'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import { PLAN_TIERS, getPlanDirection, type PlanTier } from '@/lib/plan-config';

interface TierData {
  id: string;
  name: string;
  displayName: string;
  monthlyCredits: number;
  rolloverCap: number;
  monthlyPriceUsd: number;
  seatsIncluded: number;
  features: string[] | null;
  sortOrder: number | null;
}

interface PlanComparisonCardsProps {
  tiers: TierData[];
  currentTierId: string | null;
  currentSortOrder: number;
  onSelectTier: (tierId: string, direction: 'upgrade' | 'downgrade') => void;
}

export default function PlanComparisonCards({
  tiers,
  currentTierId,
  currentSortOrder,
  onSelectTier,
}: PlanComparisonCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {tiers.map((tier) => {
        const isCurrent = tier.id === currentTierId;
        const planMeta = PLAN_TIERS[tier.name as PlanTier];
        const direction = getPlanDirection(currentSortOrder, tier.sortOrder ?? 0);
        const isEnterprise = tier.name === 'enterprise';
        const highlighted = planMeta?.highlighted;

        return (
          <Card
            key={tier.id}
            className={`relative ${highlighted ? 'border-primary shadow-md' : ''} ${isCurrent ? 'border-green-500' : ''}`}
          >
            {highlighted && !isCurrent && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
              </div>
            )}
            {isCurrent && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-green-100 text-green-800 border-green-200">Current Plan</Badge>
              </div>
            )}

            <CardHeader className="text-center pt-6">
              <CardTitle className="text-xl">{tier.displayName}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {planMeta?.description ?? ''}
              </p>
              <div className="mt-4">
                <span className="text-3xl font-bold">
                  ${(tier.monthlyPriceUsd / 100).toFixed(0)}
                </span>
                <span className="text-muted-foreground">/mo</span>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="text-sm text-center text-muted-foreground">
                {tier.monthlyCredits.toLocaleString()} credits/mo
                {' | '}
                {tier.seatsIncluded === 1 ? '1 seat' : `${tier.seatsIncluded} seats`}
              </div>

              <ul className="space-y-2">
                {(planMeta?.features ?? tier.features ?? []).map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-2">
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Current Plan
                  </Button>
                ) : isEnterprise ? (
                  <Button
                    variant={highlighted ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => window.open('mailto:sales@greenfinch.ai?subject=Enterprise Plan Inquiry', '_blank')}
                  >
                    Contact Sales
                  </Button>
                ) : (
                  <Button
                    variant={direction === 'upgrade' ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => onSelectTier(tier.id, direction as 'upgrade' | 'downgrade')}
                  >
                    {direction === 'upgrade' ? 'Upgrade' : 'Downgrade'} to {tier.displayName}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
