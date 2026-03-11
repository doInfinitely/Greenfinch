'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ExternalLink, CreditCard } from 'lucide-react';

interface SubscriptionData {
  status: string;
  tierId: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  seatCount: number;
  pendingTierId: string | null;
  pendingChangeEffectiveAt: string | null;
  pendingTierName: string | null;
}

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

interface BalanceData {
  currentBalance: number;
  rolloverBalance: number;
  purchasedBalance: number;
  totalAvailable: number;
}

interface CurrentPlanCardProps {
  subscription: SubscriptionData;
  tier: TierData;
  balance: BalanceData | null;
  onChangePlan: () => void;
  onCancelSubscription: () => void;
  onCancelPendingChange: () => void;
  onReactivate: () => void;
  cancellingPending: boolean;
  reactivating: boolean;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusBadge(status: string, cancelAtPeriodEnd: boolean) {
  if (cancelAtPeriodEnd) {
    return <Badge variant="destructive">Canceling</Badge>;
  }
  switch (status) {
    case 'active':
      return <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>;
    case 'past_due':
      return <Badge variant="destructive">Past Due</Badge>;
    case 'trialing':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Trial</Badge>;
    case 'canceled':
      return <Badge variant="secondary">Canceled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function CurrentPlanCard({
  subscription,
  tier,
  balance,
  onChangePlan,
  onCancelSubscription,
  onCancelPendingChange,
  onReactivate,
  cancellingPending,
  reactivating,
}: CurrentPlanCardProps) {
  const openPortal = async () => {
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank');
      }
    } catch {
      // Portal error handled silently
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-3">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Current Plan</CardTitle>
        </div>
        {statusBadge(subscription.status, subscription.cancelAtPeriodEnd)}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Plan</p>
            <p className="text-lg font-semibold">{tier.displayName}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Monthly Price</p>
            <p className="text-lg font-semibold">${(tier.monthlyPriceUsd / 100).toFixed(0)}/mo</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Credits</p>
            <p className="text-lg font-semibold">
              {balance ? balance.totalAvailable.toLocaleString() : '-'}
              <span className="text-sm font-normal text-muted-foreground"> / {tier.monthlyCredits.toLocaleString()}</span>
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Seats</p>
            <p className="text-lg font-semibold">
              {subscription.seatCount} / {tier.seatsIncluded}
            </p>
          </div>
        </div>

        {subscription.currentPeriodEnd && (
          <p className="text-sm text-muted-foreground">
            Current billing period ends {formatDate(subscription.currentPeriodEnd)}
          </p>
        )}

        {/* Pending downgrade banner */}
        {subscription.pendingTierId && subscription.pendingTierName && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">
                Your plan will change to <strong>{subscription.pendingTierName}</strong> on{' '}
                {formatDate(subscription.pendingChangeEffectiveAt)}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onCancelPendingChange}
              disabled={cancellingPending}
            >
              {cancellingPending ? 'Canceling...' : 'Keep Current Plan'}
            </Button>
          </div>
        )}

        {/* Cancel at period end banner */}
        {subscription.cancelAtPeriodEnd && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">
                Your subscription ends on {formatDate(subscription.currentPeriodEnd)}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onReactivate}
              disabled={reactivating}
            >
              {reactivating ? 'Reactivating...' : 'Reactivate'}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {subscription.status !== 'canceled' && !subscription.cancelAtPeriodEnd && (
            <Button onClick={onChangePlan}>Change Plan</Button>
          )}
          <Button variant="outline" onClick={openPortal}>
            <ExternalLink className="h-4 w-4 mr-1" />
            Manage Billing
          </Button>
          {subscription.status !== 'canceled' && !subscription.cancelAtPeriodEnd && (
            <Button variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={onCancelSubscription}>
              Cancel Subscription
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
