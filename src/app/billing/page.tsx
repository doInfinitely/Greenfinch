'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useCreditBalance } from '@/hooks/useCreditBalance';

interface Subscription {
  subscription: {
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    seatCount: number;
  } | null;
  tier: {
    name: string;
    displayName: string;
    monthlyCredits: number;
    rolloverCap: number;
    monthlyPriceUsd: number;
    seatsIncluded: number;
    features: string[] | null;
  } | null;
  balance: {
    currentBalance: number;
    rolloverBalance: number;
    purchasedBalance: number;
    totalAvailable: number;
  } | null;
}

interface SeatInfo {
  seatCount: number;
  seatsIncluded: number;
  perSeatPriceUsd: number;
  maxSeats: number | null;
  activeMemberCount: number;
  pendingInvitations: number;
  totalUsed: number;
  available: number;
}

interface PlanTier {
  id: string;
  name: string;
  displayName: string;
  monthlyCredits: number;
  rolloverCap: number;
  monthlyPriceUsd: number;
  seatsIncluded: number;
  perSeatPriceUsd: number;
  maxSeats: number | null;
  features: string[] | null;
}

interface Transaction {
  id: string;
  type: string;
  action: string | null;
  amount: number;
  balanceAfter: number;
  pool: string | null;
  userId: string | null;
  description: string | null;
  createdAt: string;
}

interface CreditPack {
  id: string;
  name: string;
  credits: number;
  priceUsd: number;
}

interface ActionCost {
  action: string;
  displayName: string;
  creditCost: number;
  category: string;
}

const CANCEL_REASONS = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'missing_features', label: 'Missing features' },
  { value: 'switching', label: 'Switching to another product' },
  { value: 'other', label: 'Other' },
];

export default function BillingPage() {
  const { orgRole } = useAuth();
  const isAdmin = orgRole === 'org:admin';
  const { data: balance } = useCreditBalance();
  const queryClient = useQueryClient();

  const { data: subscription } = useQuery<Subscription>({
    queryKey: ['billing-subscription'],
    queryFn: async () => {
      const res = await fetch('/api/billing/subscription');
      const json = await res.json();
      return json.data;
    },
  });

  const [txPage, setTxPage] = useState(1);
  const { data: transactions } = useQuery<{ data: Transaction[]; meta: { total: number; totalPages: number } }>({
    queryKey: ['billing-transactions', txPage],
    queryFn: async () => {
      const res = await fetch(`/api/billing/transactions?page=${txPage}&limit=20`);
      return res.json();
    },
    enabled: isAdmin,
  });

  const { data: packs } = useQuery<CreditPack[]>({
    queryKey: ['billing-packs'],
    queryFn: async () => {
      const res = await fetch('/api/billing/packs');
      const json = await res.json();
      return json.data;
    },
  });

  const { data: actionCosts } = useQuery<ActionCost[]>({
    queryKey: ['billing-action-costs'],
    queryFn: async () => {
      const res = await fetch('/api/billing/action-costs');
      const json = await res.json();
      return json.data;
    },
  });

  const { data: seatInfo } = useQuery<SeatInfo>({
    queryKey: ['billing-seats'],
    queryFn: async () => {
      const res = await fetch('/api/billing/seats');
      const json = await res.json();
      return json.data;
    },
  });

  const { data: planData } = useQuery<{ tiers: PlanTier[]; currentTierId: string | null }>({
    queryKey: ['billing-tiers'],
    queryFn: async () => {
      const res = await fetch('/api/billing/change-plan');
      const json = await res.json();
      return json.data;
    },
    enabled: isAdmin,
  });

  const [cancelReason, setCancelReason] = useState('');
  const [cancelFeedback, setCancelFeedback] = useState('');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [planPreview, setPlanPreview] = useState<{ amountDue: number; currency: string } | null>(null);
  const [showSeatPreview, setShowSeatPreview] = useState(false);
  const [seatAction, setSeatAction] = useState<'add' | 'remove'>('add');
  const [seatPreviewData, setSeatPreviewData] = useState<{ preview: { amountDue: number; currency: string }; newCount: number } | null>(null);

  const seatPreviewMutation = useMutation({
    mutationFn: async (action: 'add' | 'remove') => {
      const res = await fetch('/api/billing/seats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', count: 1 }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const json = await res.json();
      return { ...json.data, requestedAction: action };
    },
    onSuccess: (data) => {
      setSeatPreviewData(data);
      setSeatAction(data.requestedAction);
      setShowSeatPreview(true);
    },
  });

  const seatMutation = useMutation({
    mutationFn: async (action: 'add' | 'remove') => {
      const res = await fetch('/api/billing/seats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, count: 1 }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      setShowSeatPreview(false);
      setSeatPreviewData(null);
      queryClient.invalidateQueries({ queryKey: ['billing-seats'] });
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: async ({ tierId, preview }: { tierId: string; preview?: boolean }) => {
      const res = await fetch('/api/billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId, preview }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data, variables) => {
      if (variables.preview) {
        setPlanPreview(data.data);
      } else {
        setShowPlanDialog(false);
        setPlanPreview(null);
        queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
        queryClient.invalidateQueries({ queryKey: ['billing-tiers'] });
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason, feedback: cancelFeedback }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      setShowCancelDialog(false);
      queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/cancel', { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing-subscription'] }),
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      const json = await res.json();
      return json.data.url;
    },
    onSuccess: (url: string) => {
      window.location.href = url;
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (packId: string) => {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, returnUrl: window.location.href }),
      });
      const json = await res.json();
      return json.data.url;
    },
    onSuccess: (url: string) => {
      window.location.href = url;
    },
  });

  const tier = subscription?.tier;
  const sub = subscription?.subscription;
  const totalUsed = tier ? tier.monthlyCredits - (balance?.currentBalance ?? 0) : 0;
  const usagePercent = tier ? Math.min(100, (totalUsed / tier.monthlyCredits) * 100) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing & Credits</h1>
        <p className="text-muted-foreground">Manage your subscription, view usage, and purchase credits.</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {isAdmin && <TabsTrigger value="usage">Usage History</TabsTrigger>}
          <TabsTrigger value="purchase">Purchase Credits</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Plan card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{tier?.displayName ?? 'No Plan'}</CardTitle>
                  <CardDescription>
                    {sub ? (
                      <>
                        {sub.status === 'active' ? 'Active' : sub.status}
                        {sub.cancelAtPeriodEnd && ' (cancels at period end)'}
                        {' · '}
                        Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                      </>
                    ) : 'No active subscription'}
                  </CardDescription>
                </div>
                {isAdmin && sub && (
                  <Button
                    variant="outline"
                    onClick={() => portalMutation.mutate()}
                    disabled={portalMutation.isPending}
                  >
                    Manage Subscription
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {tier && (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Monthly credits used</span>
                    <span className="font-medium">{totalUsed.toLocaleString()} / {tier.monthlyCredits.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usagePercent > 80 ? 'bg-amber-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Balance breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Current Period</CardDescription>
                <CardTitle className="text-2xl">{(balance?.currentBalance ?? 0).toLocaleString()}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Rollover</CardDescription>
                <CardTitle className="text-2xl">{(balance?.rolloverBalance ?? 0).toLocaleString()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Cap: {(balance?.rolloverCap ?? 0).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Purchased</CardDescription>
                <CardTitle className="text-2xl">{(balance?.purchasedBalance ?? 0).toLocaleString()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Never expires</p>
              </CardContent>
            </Card>
          </div>

          {/* Seat Management */}
          {seatInfo && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Seats</CardTitle>
                    <CardDescription>
                      {seatInfo.totalUsed} of {seatInfo.seatCount} seats used
                    </CardDescription>
                  </div>
                  {seatInfo.perSeatPriceUsd > 0 && (
                    <Badge variant="secondary">
                      ${(seatInfo.perSeatPriceUsd / 100).toFixed(0)}/seat/mo
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      seatInfo.available === 0 ? 'bg-amber-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, (seatInfo.totalUsed / seatInfo.seatCount) * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{seatInfo.activeMemberCount} members · {seatInfo.pendingInvitations} pending</span>
                  <span>{seatInfo.available} available</span>
                </div>

                {/* Per-seat cost breakdown */}
                {seatInfo.perSeatPriceUsd > 0 && seatInfo.seatCount > seatInfo.seatsIncluded && (
                  <div className="text-sm bg-gray-50 rounded-md p-3 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{seatInfo.seatsIncluded} seat{seatInfo.seatsIncluded !== 1 ? 's' : ''} included in plan</span>
                      <span className="font-medium">$0</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{seatInfo.seatCount - seatInfo.seatsIncluded} additional seat{seatInfo.seatCount - seatInfo.seatsIncluded !== 1 ? 's' : ''} x ${(seatInfo.perSeatPriceUsd / 100).toFixed(0)}</span>
                      <span className="font-medium">${((seatInfo.seatCount - seatInfo.seatsIncluded) * seatInfo.perSeatPriceUsd / 100).toFixed(0)}/mo</span>
                    </div>
                  </div>
                )}

                {/* Max seats warning */}
                {seatInfo.maxSeats !== null && seatInfo.seatCount >= seatInfo.maxSeats && (
                  <p className="text-sm text-amber-600 bg-amber-50 rounded-md px-3 py-2">
                    You&apos;ve reached the maximum of {seatInfo.maxSeats} seats on this plan. Upgrade to add more.
                  </p>
                )}

                {isAdmin && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => seatPreviewMutation.mutate('add')}
                      disabled={seatPreviewMutation.isPending || seatMutation.isPending || (seatInfo.maxSeats !== null && seatInfo.seatCount >= seatInfo.maxSeats)}
                    >
                      Add Seat
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => seatPreviewMutation.mutate('remove')}
                      disabled={seatPreviewMutation.isPending || seatMutation.isPending || seatInfo.seatCount <= seatInfo.seatsIncluded}
                    >
                      Remove Seat
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Seat Change Preview Dialog */}
          <Dialog open={showSeatPreview} onOpenChange={setShowSeatPreview}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{seatAction === 'add' ? 'Add' : 'Remove'} Seat</DialogTitle>
                <DialogDescription>
                  {seatPreviewData ? (
                    <>
                      {seatAction === 'add' ? 'Adding' : 'Removing'} 1 seat ({seatInfo?.seatCount} → {seatPreviewData.newCount}).{' '}
                      Prorated charge: <span className="font-medium">${(seatPreviewData.preview.amountDue / 100).toFixed(2)} {seatPreviewData.preview.currency.toUpperCase()}</span>
                    </>
                  ) : (
                    'Calculating proration...'
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowSeatPreview(false)}>Cancel</Button>
                <Button
                  onClick={() => seatMutation.mutate(seatAction)}
                  disabled={seatMutation.isPending || !seatPreviewData}
                >
                  Confirm
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Plan Comparison */}
          {isAdmin && planData && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Plans</CardTitle>
                <CardDescription>Compare plans and upgrade or downgrade.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {planData.tiers.map((t) => {
                    const isCurrent = t.id === planData.currentTierId;
                    return (
                      <div
                        key={t.id}
                        className={`p-4 rounded-lg border-2 ${isCurrent ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}
                      >
                        <h3 className="font-semibold">{t.displayName}</h3>
                        <p className="text-2xl font-bold mt-1">${(t.monthlyPriceUsd / 100).toFixed(0)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                        <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                          <li>{t.monthlyCredits.toLocaleString()} credits/mo</li>
                          <li>{t.seatsIncluded} seat{t.seatsIncluded !== 1 ? 's' : ''} included</li>
                          {t.perSeatPriceUsd > 0 && (
                            <li>${(t.perSeatPriceUsd / 100).toFixed(0)}/seat/mo for additional</li>
                          )}
                          {t.maxSeats !== null ? (
                            <li>Up to {t.maxSeats} seats</li>
                          ) : (
                            <li>Unlimited seats</li>
                          )}
                          <li>Rollover cap: {t.rolloverCap.toLocaleString()}</li>
                        </ul>
                        {isCurrent ? (
                          <Badge className="mt-3">Current Plan</Badge>
                        ) : (
                          <Button
                            size="sm"
                            className="mt-3 w-full"
                            variant="outline"
                            onClick={() => {
                              setSelectedTierId(t.id);
                              setPlanPreview(null);
                              setShowPlanDialog(true);
                              changePlanMutation.mutate({ tierId: t.id, preview: true });
                            }}
                          >
                            {t.monthlyPriceUsd > (tier?.monthlyPriceUsd ?? 0) ? 'Upgrade' : 'Downgrade'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Cancel / Reactivate */}
                <div className="mt-4 pt-4 border-t flex justify-end gap-2">
                  {sub?.cancelAtPeriodEnd ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => reactivateMutation.mutate()}
                      disabled={reactivateMutation.isPending}
                    >
                      Reactivate Subscription
                    </Button>
                  ) : sub ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => setShowCancelDialog(true)}
                    >
                      Cancel Subscription
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Plan Change Dialog */}
          <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Change Plan</DialogTitle>
                <DialogDescription>
                  {planPreview
                    ? `Prorated charge: $${(planPreview.amountDue / 100).toFixed(2)} ${planPreview.currency.toUpperCase()}`
                    : 'Calculating proration...'}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPlanDialog(false)}>Cancel</Button>
                <Button
                  onClick={() => selectedTierId && changePlanMutation.mutate({ tierId: selectedTierId })}
                  disabled={changePlanMutation.isPending || !planPreview}
                >
                  Confirm Change
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Cancel Dialog */}
          <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel Subscription</DialogTitle>
                <DialogDescription>Your subscription will remain active until the end of the current billing period.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="text-sm font-medium">Why are you canceling?</label>
                  <div className="mt-2 space-y-2">
                    {CANCEL_REASONS.map((r) => (
                      <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="cancelReason"
                          value={r.value}
                          checked={cancelReason === r.value}
                          onChange={(e) => setCancelReason(e.target.value)}
                          className="rounded-full"
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Additional feedback (optional)</label>
                  <textarea
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    rows={3}
                    value={cancelFeedback}
                    onChange={(e) => setCancelFeedback(e.target.value)}
                    placeholder="Tell us more..."
                  />
                </div>
                {planData && planData.tiers.length > 1 && (
                  <p className="text-sm text-muted-foreground bg-blue-50 p-3 rounded-md">
                    Consider downgrading to a lower plan instead of canceling.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCancelDialog(false)}>Keep Subscription</Button>
                <Button
                  variant="destructive"
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending || !cancelReason}
                >
                  Cancel Subscription
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Action costs */}
          {actionCosts && actionCosts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Credit Costs per Action</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {actionCosts.map((cost) => (
                    <div key={cost.action} className="flex items-center justify-between p-2 rounded-md bg-gray-50">
                      <span className="text-sm">{cost.displayName}</span>
                      <Badge variant="secondary">{cost.creditCost} cr</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="usage" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Transaction History</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead className="text-right">Balance After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions?.data?.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs">
                          {new Date(tx.createdAt).toLocaleDateString()}{' '}
                          {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={tx.type === 'debit' ? 'destructive' : 'default'} className="text-xs">
                            {tx.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{tx.action ?? '-'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{tx.description}</TableCell>
                        <TableCell className={`text-right font-medium ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount}
                        </TableCell>
                        <TableCell className="text-right">{tx.balanceAfter}</TableCell>
                      </TableRow>
                    ))}
                    {(!transactions?.data || transactions.data.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No transactions yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {transactions?.meta && transactions.meta.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Page {txPage} of {transactions.meta.totalPages} ({transactions.meta.total} total)
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={txPage <= 1} onClick={() => setTxPage(p => p - 1)}>
                        Previous
                      </Button>
                      <Button variant="outline" size="sm" disabled={txPage >= transactions.meta.totalPages} onClick={() => setTxPage(p => p + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="purchase" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {packs?.map((pack) => (
              <Card key={pack.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle>{pack.name}</CardTitle>
                  <CardDescription>{pack.credits.toLocaleString()} credits</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col justify-end">
                  <p className="text-2xl font-bold mb-4">${(pack.priceUsd / 100).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    ${((pack.priceUsd / 100) / pack.credits).toFixed(3)} per credit · Never expires
                  </p>
                  {isAdmin ? (
                    <Button
                      onClick={() => checkoutMutation.mutate(pack.id)}
                      disabled={checkoutMutation.isPending}
                      className="w-full"
                    >
                      Buy Now
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center">Ask an admin to purchase</p>
                  )}
                </CardContent>
              </Card>
            ))}
            {(!packs || packs.length === 0) && (
              <p className="text-muted-foreground col-span-3 text-center py-8">
                No credit packs available yet.
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
