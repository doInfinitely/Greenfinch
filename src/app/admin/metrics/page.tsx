'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Building2,
  Users,
  Eye,
  DollarSign,
  BarChart3,
  Trophy,
  XCircle,
  UserPlus,
  Download,
  Loader2,
  Clock,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatCurrencyCompact } from '@/lib/utils';

interface WeeklyTrend {
  week: string;
  pipelineCreated: number;
  dealsWon: number;
  wonValue: number;
}

interface OrgBreakdown {
  orgId: string;
  orgName: string;
  activeUsers: number;
  propertiesViewed: number;
  pipelineCreated: number;
  dealsWon: number;
  enrichmentSpend: number;
}

interface CrossOrgMetrics {
  totalOrgs: number;
  activeUsers: number;
  propertiesViewed: number;
  contactsDiscovered: number;
  pipelineCreated: number;
  stageTransitions: number;
  dealsWon: number;
  dealsWonValue: number;
  dealsLost: number;
  creditsUsed: number;
  enrichmentSpend: number;
  avgDaysToWon: number | null;
  weeklyTrends: WeeklyTrend[];
  orgBreakdown: OrgBreakdown[];
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

export default function AdminMetricsPage() {
  const [data, setData] = useState<CrossOrgMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState('month');
  const [exporting, setExporting] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ timeframe });
      const res = await fetch(`/api/admin/metrics?${params}`);
      if (!res.ok) {
        if (res.status === 403) throw new Error('Access denied');
        throw new Error('Failed to fetch metrics');
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ timeframe });
      const res = await fetch(`/api/admin/metrics/export?${params}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `platform-metrics-${timeframe}-${new Date().toISOString().split('T')[0]}.csv`;
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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Platform Metrics</h1>
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
            <KpiCard title="Total Orgs" value={data.totalOrgs} icon={Building2} />
            <KpiCard title="Active Users" value={data.activeUsers.toLocaleString()} icon={Users} />
            <KpiCard title="Properties Viewed" value={data.propertiesViewed.toLocaleString()} icon={Eye} />
            <KpiCard
              title="Enrichment Spend"
              value={`$${data.enrichmentSpend.toFixed(2)}`}
              icon={DollarSign}
            />
          </div>

          {/* KPI Row 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Pipeline Created" value={data.pipelineCreated.toLocaleString()} icon={BarChart3} />
            <KpiCard
              title="Deals Won"
              value={data.dealsWon.toLocaleString()}
              subtitle={formatCurrencyCompact(data.dealsWonValue)}
              icon={Trophy}
            />
            <KpiCard title="Deals Lost" value={data.dealsLost.toLocaleString()} icon={XCircle} />
            <KpiCard title="Contacts Discovered" value={data.contactsDiscovered.toLocaleString()} icon={UserPlus} />
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

          {/* Org Breakdown Table */}
          {data.orgBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Organization Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Organization</th>
                        <th className="pb-2 pr-4 text-right">Users</th>
                        <th className="pb-2 pr-4 text-right">Properties</th>
                        <th className="pb-2 pr-4 text-right">Pipeline</th>
                        <th className="pb-2 pr-4 text-right">Won</th>
                        <th className="pb-2 text-right">Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orgBreakdown.map((o) => (
                        <tr key={o.orgId} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium">{o.orgName}</td>
                          <td className="py-2 pr-4 text-right">{o.activeUsers}</td>
                          <td className="py-2 pr-4 text-right">{o.propertiesViewed}</td>
                          <td className="py-2 pr-4 text-right">{o.pipelineCreated}</td>
                          <td className="py-2 pr-4 text-right">{o.dealsWon}</td>
                          <td className="py-2 text-right">${o.enrichmentSpend.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
          {/* County Data Quality */}
          <CountyQualitySection />
        </>
      ) : null}
    </div>
  );
}

interface CountyQuality {
  countyCode: string;
  countyName: string;
  total: number;
  addressQualityPercent: number;
  geocodedPercent: number;
  avgContactsPerProperty: number;
  revenueEstimateCoveragePercent: number;
}

function CountyQualitySection() {
  const [counties, setCounties] = useState<CountyQuality[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/metrics/county-quality')
      .then(res => res.json())
      .then(json => setCounties(json.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || counties.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>County Data Quality</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left pb-2 pr-4">County</th>
                <th className="text-right pb-2 px-4">Properties</th>
                <th className="text-right pb-2 px-4">Address %</th>
                <th className="text-right pb-2 px-4">Geocoded %</th>
                <th className="text-right pb-2 px-4">Avg Contacts</th>
                <th className="text-right pb-2 pl-4">Revenue Est %</th>
              </tr>
            </thead>
            <tbody>
              {counties.map((c) => (
                <tr key={c.countyCode} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{c.countyName}</td>
                  <td className="py-2 px-4 text-right">{c.total.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right">{c.addressQualityPercent}%</td>
                  <td className="py-2 px-4 text-right">{c.geocodedPercent}%</td>
                  <td className="py-2 px-4 text-right">{c.avgContactsPerProperty}</td>
                  <td className="py-2 pl-4 text-right">{c.revenueEstimateCoveragePercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
