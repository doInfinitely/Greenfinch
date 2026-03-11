'use client';

import { useEffect, useState, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, DollarSign, TrendingUp, AlertTriangle, Activity } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import CurrentPlanCard from '@/components/billing/CurrentPlanCard';
import PlanComparisonCards from '@/components/billing/PlanComparisonCards';
import UpgradeDialog from '@/components/billing/UpgradeDialog';
import DowngradeDialog from '@/components/billing/DowngradeDialog';
import CancelSubscriptionFlow from '@/components/billing/CancelSubscriptionFlow';

// --- Types ---

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

interface AllocationData {
  planName: string;
  monthlyCredits: number;
  rolloverCredits: number;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
}

interface UsageData {
  allocation: AllocationData | null;
  currentPeriod: {
    creditsUsed: number;
    estimatedCostUsd: number;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
  };
  creditsRemaining: number;
  usagePercentage: number;
  isWarning: boolean;
  byProvider: Array<{
    provider: string;
    providerLabel: string;
    totalCalls: number;
    creditsUsed: number;
    estimatedCostUsd: number;
  }>;
  byActionType: Array<{
    endpoint: string;
    provider: string;
    totalCalls: number;
    creditsUsed: number;
  }>;
  trend: Array<{
    date: string;
    creditsUsed: number;
    calls: number;
  }>;
}

interface UserUsageData {
  byUser: Array<{
    triggeredBy: string | null;
    userName: string;
    totalCalls: number;
    creditsUsed: number;
    estimatedCostUsd: number;
    lastActivity: string;
  }>;
}

interface HistoryData {
  months: Array<{
    month: string;
    creditsUsed: number;
    estimatedCostUsd: number;
    totalCalls: number;
    topProvider: string;
  }>;
}

// --- Helpers ---

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// --- Component ---

export default function BillingDashboard() {
  const { orgRole } = useAuth();
  const isAdmin = orgRole === 'org:admin' || orgRole === 'org:manager';

  // Subscription / plan state
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [tier, setTier] = useState<TierData | null>(null);
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [allTiers, setAllTiers] = useState<TierData[]>([]);

  // Usage state
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [userUsage, setUserUsage] = useState<UserUsageData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState('30');

  // Dialog state
  const [showPlanComparison, setShowPlanComparison] = useState(false);
  const [upgradeDialogTier, setUpgradeDialogTier] = useState<string | null>(null);
  const [downgradeDialogTier, setDowngradeDialogTier] = useState<string | null>(null);
  const [showCancelFlow, setShowCancelFlow] = useState(false);
  const [cancellingPending, setCancellingPending] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const fetchSubscriptionData = useCallback(async () => {
    const [subRes, tiersRes] = await Promise.all([
      fetch('/api/billing/subscription'),
      fetch('/api/billing/change-plan'),
    ]);
    if (subRes.ok) {
      const subData = await subRes.json();
      setSubscription(subData.data?.subscription ?? null);
      setTier(subData.data?.tier ?? null);
      setBalance(subData.data?.balance ?? null);
    }
    if (tiersRes.ok) {
      const tiersData = await tiersRes.json();
      setAllTiers(tiersData.data?.tiers ?? []);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [, usageRes, userRes, historyRes] = await Promise.all([
          fetchSubscriptionData(),
          fetch(`/api/org-admin/billing/usage?days=${days}`),
          fetch(`/api/org-admin/billing/usage-by-user?days=${days}`),
          fetch('/api/org-admin/billing/history'),
        ]);

        if (!usageRes.ok && usageRes.status === 403) {
          setError('Admin access required');
          return;
        }

        const [usageData, userData, historyData] = await Promise.all([
          usageRes.ok ? usageRes.json() : null,
          userRes.ok ? userRes.json() : { byUser: [] },
          historyRes.ok ? historyRes.json() : { months: [] },
        ]);

        if (usageData) setUsage(usageData);
        setUserUsage(userData);
        setHistory(historyData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [isAdmin, days, fetchSubscriptionData]);

  const handleSelectTier = (tierId: string, direction: 'upgrade' | 'downgrade') => {
    if (direction === 'upgrade') {
      setUpgradeDialogTier(tierId);
    } else {
      setDowngradeDialogTier(tierId);
    }
  };

  const handlePlanChanged = () => {
    fetchSubscriptionData();
    setShowPlanComparison(false);
  };

  const handleCancelPendingChange = async () => {
    setCancellingPending(true);
    try {
      const res = await fetch('/api/billing/change-plan', { method: 'DELETE' });
      if (res.ok) await fetchSubscriptionData();
    } finally {
      setCancellingPending(false);
    }
  };

  const handleReactivate = async () => {
    setReactivating(true);
    try {
      const res = await fetch('/api/billing/cancel', { method: 'DELETE' });
      if (res.ok) await fetchSubscriptionData();
    } finally {
      setReactivating(false);
    }
  };

  if (!isAdmin) {
    return (
      <AppSidebar>
        <div className="h-full bg-gray-50 p-6">
          <div className="max-w-2xl mx-auto text-center py-12">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h1>
            <p className="text-muted-foreground">
              You need admin permissions to access this page.
            </p>
          </div>
        </div>
      </AppSidebar>
    );
  }

  const successRate = usage?.currentPeriod
    ? usage.currentPeriod.totalCalls > 0
      ? Math.round((usage.currentPeriod.successfulCalls / usage.currentPeriod.totalCalls) * 100)
      : 0
    : 0;

  const progressColor = (usage?.usagePercentage ?? 0) >= 80 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Billing & Usage</h1>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-4">
              <Card><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <Card key={i}><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">{error}</div>
          ) : (
            <>
              {/* ===== PLAN MANAGEMENT SECTION ===== */}
              {subscription && tier && (
                <div className="space-y-6 mb-8">
                  <CurrentPlanCard
                    subscription={subscription}
                    tier={tier}
                    balance={balance}
                    onChangePlan={() => setShowPlanComparison(!showPlanComparison)}
                    onCancelSubscription={() => setShowCancelFlow(true)}
                    onCancelPendingChange={handleCancelPendingChange}
                    onReactivate={handleReactivate}
                    cancellingPending={cancellingPending}
                    reactivating={reactivating}
                  />

                  {showPlanComparison && allTiers.length > 0 && (
                    <PlanComparisonCards
                      tiers={allTiers}
                      currentTierId={subscription.tierId}
                      currentSortOrder={tier.sortOrder ?? 0}
                      onSelectTier={handleSelectTier}
                    />
                  )}
                </div>
              )}

              {/* ===== USAGE ANALYTICS SECTION ===== */}
              {usage?.isWarning && (
                <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">
                    You have used {usage.usagePercentage}% of your available credits.
                    {usage.allocation ? ` ${usage.creditsRemaining.toLocaleString()} credits remaining.` : ''}
                  </span>
                </div>
              )}

              <Tabs defaultValue="overview">
                <TabsList className="mb-6">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Credits Used</CardTitle>
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {(usage?.currentPeriod.creditsUsed ?? 0).toLocaleString()}
                          {usage?.allocation && (
                            <span className="text-sm font-normal text-muted-foreground">
                              {' '}/ {((usage.allocation.monthlyCredits ?? 0) + (usage.allocation.rolloverCredits ?? 0)).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {usage?.allocation && (
                          <div className="mt-2 h-2 rounded-full bg-gray-200">
                            <div
                              className={`h-full rounded-full transition-all ${progressColor}`}
                              style={{ width: `${Math.min(usage.usagePercentage, 100)}%` }}
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Credits Remaining</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {usage?.allocation
                            ? usage.creditsRemaining.toLocaleString()
                            : 'No plan'}
                        </div>
                        {usage?.allocation && usage.allocation.rolloverCredits > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Includes {usage.allocation.rolloverCredits.toLocaleString()} rollover
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Estimated Spend</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          ${(usage?.currentPeriod.estimatedCostUsd ?? 0).toFixed(2)}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">API Calls</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {(usage?.currentPeriod.totalCalls ?? 0).toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {successRate}% success rate
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Usage Trend Chart */}
                  {usage?.trend && usage.trend.length > 0 && (
                    <Card className="mb-8">
                      <CardHeader>
                        <CardTitle>Usage Trend</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <AreaChart data={usage.trend}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tickFormatter={formatDate} fontSize={12} />
                            <YAxis fontSize={12} />
                            <Tooltip
                              labelFormatter={(label) => formatDate(label as string)}
                              formatter={(value: number, name: string) => [
                                value.toLocaleString(),
                                name === 'creditsUsed' ? 'Credits' : 'Calls',
                              ]}
                            />
                            <Area
                              type="monotone"
                              dataKey="creditsUsed"
                              stroke="#16a34a"
                              fill="#16a34a"
                              fillOpacity={0.2}
                              name="creditsUsed"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Provider Breakdown */}
                  {usage?.byProvider && usage.byProvider.length > 0 && (
                    <Card className="mb-8">
                      <CardHeader>
                        <CardTitle>Provider Breakdown</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Provider</TableHead>
                              <TableHead className="text-right">Calls</TableHead>
                              <TableHead className="text-right">Credits</TableHead>
                              <TableHead className="text-right">Cost</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {usage.byProvider.map((row) => (
                              <TableRow key={row.provider}>
                                <TableCell className="font-medium">{row.providerLabel}</TableCell>
                                <TableCell className="text-right">{row.totalCalls.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{row.creditsUsed.toLocaleString()}</TableCell>
                                <TableCell className="text-right">${row.estimatedCostUsd.toFixed(2)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}

                  {/* Usage by Team Member */}
                  {userUsage?.byUser && userUsage.byUser.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Usage by Team Member</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Member</TableHead>
                              <TableHead className="text-right">Calls</TableHead>
                              <TableHead className="text-right">Credits</TableHead>
                              <TableHead className="text-right">Cost</TableHead>
                              <TableHead className="text-right">Last Active</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {userUsage.byUser.map((row, i) => (
                              <TableRow key={row.triggeredBy || `system-${i}`}>
                                <TableCell className="font-medium">{row.userName}</TableCell>
                                <TableCell className="text-right">{row.totalCalls.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{row.creditsUsed.toLocaleString()}</TableCell>
                                <TableCell className="text-right">${row.estimatedCostUsd.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {row.lastActivity ? formatDate(row.lastActivity) : '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="history">
                  <Card>
                    <CardHeader>
                      <CardTitle>Monthly Usage History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {history?.months && history.months.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Month</TableHead>
                              <TableHead className="text-right">Credits Used</TableHead>
                              <TableHead className="text-right">Spend</TableHead>
                              <TableHead className="text-right">API Calls</TableHead>
                              <TableHead>Top Provider</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {history.months.map((row) => (
                              <TableRow key={row.month}>
                                <TableCell className="font-medium">{formatMonth(row.month)}</TableCell>
                                <TableCell className="text-right">{row.creditsUsed.toLocaleString()}</TableCell>
                                <TableCell className="text-right">${row.estimatedCostUsd.toFixed(2)}</TableCell>
                                <TableCell className="text-right">{row.totalCalls.toLocaleString()}</TableCell>
                                <TableCell>{row.topProvider || '-'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="text-center py-12">
                          <p className="text-muted-foreground">
                            No billing history available yet. Usage data will appear here as your team uses enrichment services.
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>

      {/* Dialogs */}
      {upgradeDialogTier && (
        <UpgradeDialog
          open={!!upgradeDialogTier}
          onOpenChange={(open) => { if (!open) setUpgradeDialogTier(null); }}
          tierId={upgradeDialogTier}
          onConfirm={handlePlanChanged}
        />
      )}

      {downgradeDialogTier && (
        <DowngradeDialog
          open={!!downgradeDialogTier}
          onOpenChange={(open) => { if (!open) setDowngradeDialogTier(null); }}
          tierId={downgradeDialogTier}
          onConfirm={handlePlanChanged}
        />
      )}

      <CancelSubscriptionFlow
        open={showCancelFlow}
        onOpenChange={setShowCancelFlow}
        periodEndDate={subscription?.currentPeriodEnd ?? null}
        onComplete={() => {
          fetchSubscriptionData();
          setShowCancelFlow(false);
        }}
      />
    </AppSidebar>
  );
}
