'use client';

import { useEffect, useState, useCallback } from 'react';
import { useOrganization } from '@clerk/nextjs';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  BarChart3,
  Users,
  Eye,
  UserPlus,
  GitBranch,
  Trophy,
  XCircle,
  Coins,
  DollarSign,
  Clock,
  Download,
  Loader2,
  ArrowUpDown,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatCurrencyCompact } from '@/lib/utils';

interface WeeklyTrend {
  week: string;
  pipelineCreated: number;
  dealsWon: number;
  wonValue: number;
}

interface UserBreakdown {
  userId: string;
  userName: string;
  email: string | null;
  propertiesViewed: number;
  contactsDiscovered: number;
  pipelineCreated: number;
  dealsWon: number;
  creditsUsed: number;
}

interface MetricsData {
  propertiesViewed: number;
  contactsDiscovered: number;
  activeUsers: number;
  pipelineCreated: number;
  stageTransitions: number;
  dealsWon: number;
  dealsWonValue: number;
  dealsLost: number;
  creditsUsed: number;
  enrichmentSpend: number;
  avgDaysToWon: number | null;
  weeklyTrends: WeeklyTrend[];
  userBreakdown?: UserBreakdown[];
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className="h-10 w-10 rounded-full bg-green-50 flex items-center justify-center">
            <Icon className="h-5 w-5 text-green-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MetricsPage() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState('month');
  const [view, setView] = useState<'personal' | 'org'>('personal');
  const [exporting, setExporting] = useState(false);
  const { membership } = useOrganization();

  const isAdmin = membership?.role === 'org:admin' || membership?.role === 'org:manager';

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ timeframe, view });
      const res = await fetch(`/api/metrics?${params}`);
      if (!res.ok) throw new Error('Failed to fetch metrics');
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [timeframe, view]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ timeframe, view });
      const res = await fetch(`/api/metrics/export?${params}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `metrics-${timeframe}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  const chartData = data?.weeklyTrends.map(t => ({
    week: new Date(t.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    'Pipeline Created': t.pipelineCreated,
    'Deals Won': t.dealsWon,
  })) || [];

  return (
    <AppSidebar>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-2xl font-bold">Metrics</h1>
          <div className="flex items-center gap-3">
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="quarter">This Quarter</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>

            {isAdmin && (
              <Select value={view} onValueChange={(v) => setView(v as 'personal' | 'org')}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">My Metrics</SelectItem>
                  <SelectItem value="org">Organization</SelectItem>
                </SelectContent>
              </Select>
            )}

            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || loading}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
              Export
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-500">{error}</div>
        ) : data ? (
          <>
            {/* KPI Row 1 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Properties Viewed" value={data.propertiesViewed.toLocaleString()} icon={Eye} />
              <KpiCard title="Contacts Discovered" value={data.contactsDiscovered.toLocaleString()} icon={UserPlus} />
              <KpiCard title="Active Users" value={data.activeUsers.toLocaleString()} icon={Users} />
              <KpiCard title="Pipeline Created" value={data.pipelineCreated.toLocaleString()} icon={BarChart3} />
            </div>

            {/* KPI Row 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Stage Transitions" value={data.stageTransitions.toLocaleString()} icon={ArrowUpDown} />
              <KpiCard
                title="Deals Won"
                value={data.dealsWon.toLocaleString()}
                subtitle={formatCurrencyCompact(data.dealsWonValue)}
                icon={Trophy}
              />
              <KpiCard title="Deals Lost" value={data.dealsLost.toLocaleString()} icon={XCircle} />
              <KpiCard
                title="Credits Used"
                value={data.creditsUsed.toLocaleString()}
                subtitle={`$${data.enrichmentSpend.toFixed(2)} spend`}
                icon={Coins}
              />
            </div>

            {/* Trend Chart */}
            {chartData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Weekly Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="week" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Pipeline Created" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Deals Won" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Avg Days to Won */}
            {data.avgDaysToWon !== null && (
              <Card className="max-w-xs">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
                      <Clock className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Avg Days to Won</p>
                      <p className="text-2xl font-bold">{data.avgDaysToWon}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* User Breakdown Table (org view only) */}
            {data.userBreakdown && data.userBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">User Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4">User</th>
                          <th className="pb-2 pr-4 text-right">Properties</th>
                          <th className="pb-2 pr-4 text-right">Contacts</th>
                          <th className="pb-2 pr-4 text-right">Pipeline</th>
                          <th className="pb-2 pr-4 text-right">Won</th>
                          <th className="pb-2 text-right">Credits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.userBreakdown.map((u) => (
                          <tr key={u.userId} className="border-b last:border-0">
                            <td className="py-2 pr-4">
                              <div>
                                <p className="font-medium">{u.userName}</p>
                                {u.email && <p className="text-xs text-muted-foreground">{u.email}</p>}
                              </div>
                            </td>
                            <td className="py-2 pr-4 text-right">{u.propertiesViewed}</td>
                            <td className="py-2 pr-4 text-right">{u.contactsDiscovered}</td>
                            <td className="py-2 pr-4 text-right">{u.pipelineCreated}</td>
                            <td className="py-2 pr-4 text-right">{u.dealsWon}</td>
                            <td className="py-2 text-right">{u.creditsUsed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : null}
      </div>
    </AppSidebar>
  );
}
