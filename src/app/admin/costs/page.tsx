'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ENRICHMENT_PROVIDER_LABELS } from '@/lib/schema';
import { ArrowLeft, TrendingUp, DollarSign, Zap, AlertTriangle, RefreshCw, Building2, Hash } from 'lucide-react';
import Link from 'next/link';

interface ProviderSummary {
  provider: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalCredits: string | null;
  totalCostUsd: string | null;
  totalInputTokens: string | null;
  totalOutputTokens: string | null;
  totalThinkingTokens: string | null;
}

interface TrendItem {
  date: string;
  provider: string;
  calls: number;
  costUsd: string | null;
}

interface CostEvent {
  id: string;
  provider: string;
  endpoint: string;
  creditsUsed: number;
  estimatedCostUsd: number;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  entityType: string | null;
  entityId: string | null;
  triggeredBy: string | null;
  statusCode: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

interface PropertyCost {
  entityId: string | null;
  propertyName: string;
  totalCalls: number;
  totalCostUsd: string | null;
  totalInputTokens: string | null;
  totalOutputTokens: string | null;
  totalThinkingTokens: string | null;
  providers: string | null;
}

interface CostData {
  period: string;
  days: number;
  totals: {
    totalCalls: number;
    totalCostUsd: string | null;
    totalCredits: string | null;
    totalInputTokens: string | null;
    totalOutputTokens: string | null;
    totalThinkingTokens: string | null;
  };
  byProvider: ProviderSummary[];
  trend: TrendItem[];
  recentEvents: CostEvent[];
  byProperty: PropertyCost[];
}

function formatCurrency(value: string | number | null): string {
  if (value === null || value === undefined) return '$0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  if (num < 0.01 && num > 0) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
}

function formatNumber(value: string | number | null): string {
  if (value === null || value === undefined) return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return Math.round(num).toLocaleString();
}

function formatTokens(value: string | number | null): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseInt(value, 10) : value;
  if (isNaN(num) || num === 0) return '—';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function getProviderLabel(provider: string): string {
  return (ENRICHMENT_PROVIDER_LABELS as Record<string, string>)[provider] || provider;
}

function getProviderColor(provider: string): string {
  const colors: Record<string, string> = {
    pdl: 'bg-blue-100 text-blue-800',
    apollo: 'bg-orange-100 text-orange-800',
    hunter: 'bg-red-100 text-red-800',
    findymail: 'bg-purple-100 text-purple-800',
    crustdata: 'bg-teal-100 text-teal-800',
    zerobounce: 'bg-green-100 text-green-800',
    gemini: 'bg-indigo-100 text-indigo-800',
    mapbox: 'bg-cyan-100 text-cyan-800',
    serp: 'bg-yellow-100 text-yellow-800',
    leadmagic: 'bg-pink-100 text-pink-800',
  };
  return colors[provider] || 'bg-gray-100 text-gray-800';
}

export default function EnrichmentCostsPage() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('30');
  const [period, setPeriod] = useState('daily');
  const [providerFilter, setProviderFilter] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period, days });
      if (providerFilter !== 'all') {
        params.set('provider', providerFilter);
      }
      const response = await fetch(`/api/admin/enrichment-costs?${params}`);
      const result = await response.json();
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch cost data:', error);
    } finally {
      setLoading(false);
    }
  }, [days, period, providerFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <Link href="/admin" className="flex items-center text-gray-600 hover:text-gray-900 transition-colors" data-testid="link-back-admin">
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Admin
        </Link>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900" data-testid="text-page-title">Enrichment Costs</h1>
            <p className="text-sm text-gray-500 mt-1">Track API spend across all enrichment providers</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-32" data-testid="select-days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>

            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-28" data-testid="select-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="week">Weekly</SelectItem>
                <SelectItem value="month">Monthly</SelectItem>
              </SelectContent>
            </Select>

            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-36" data-testid="select-provider">
                <SelectValue placeholder="All Providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                {Object.entries(ENRICHMENT_PROVIDER_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={fetchData} disabled={loading} data-testid="button-refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {loading && !data ? (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
                <div className="h-8 bg-gray-200 rounded w-32" />
              </div>
            ))}
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="card-total-spend">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium text-gray-500">Total Spend</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.totals.totalCostUsd)}</p>
                <p className="text-xs text-gray-400 mt-1">Last {data.days} days</p>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="card-total-calls">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-500">API Calls</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(data.totals.totalCalls)}</p>
                <p className="text-xs text-gray-400 mt-1">{formatNumber(data.totals.totalCredits)} credits used</p>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="card-total-tokens">
                <div className="flex items-center gap-2 mb-1">
                  <Hash className="w-4 h-4 text-indigo-600" />
                  <span className="text-sm font-medium text-gray-500">Gemini Tokens</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{formatTokens(data.totals.totalInputTokens)}<span className="text-sm font-normal text-gray-400"> in</span> / {formatTokens(data.totals.totalOutputTokens)}<span className="text-sm font-normal text-gray-400"> out</span></p>
                <p className="text-xs text-gray-400 mt-1">{formatTokens(data.totals.totalThinkingTokens)} thinking tokens</p>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="card-providers-active">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-medium text-gray-500">Active Providers</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{data.byProvider.length}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {data.byProvider.filter(p => Number(p.failedCalls) > 0).length > 0
                    ? `${data.byProvider.filter(p => Number(p.failedCalls) > 0).length} with errors`
                    : 'All healthy'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="card-by-provider">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Spend by Provider</h2>
                {data.byProvider.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No enrichment costs recorded yet</p>
                ) : (
                  <div className="space-y-3">
                    {data.byProvider.map((p) => {
                      const totalCost = parseFloat(String(p.totalCostUsd || '0'));
                      const maxCost = Math.max(...data.byProvider.map(bp => parseFloat(String(bp.totalCostUsd || '0'))), 1);
                      const widthPct = Math.max((totalCost / maxCost) * 100, 2);
                      const hasTokens = p.totalInputTokens || p.totalOutputTokens;

                      return (
                        <div key={p.provider} data-testid={`provider-row-${p.provider}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getProviderColor(p.provider)}`}>
                                {getProviderLabel(p.provider)}
                              </span>
                              {Number(p.failedCalls) > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                                  <AlertTriangle className="w-3 h-3" />
                                  {p.failedCalls} failed
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-medium text-gray-900">{formatCurrency(p.totalCostUsd)}</span>
                              <span className="text-xs text-gray-400 ml-2">{formatNumber(p.totalCalls)} calls</span>
                            </div>
                          </div>
                          {hasTokens && (
                            <div className="text-xs text-gray-400 mb-1">
                              {formatTokens(p.totalInputTokens)} in / {formatTokens(p.totalOutputTokens)} out
                              {p.totalThinkingTokens && parseInt(String(p.totalThinkingTokens)) > 0 && (
                                <span> · {formatTokens(p.totalThinkingTokens)} thinking</span>
                              )}
                            </div>
                          )}
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full transition-all"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="card-daily-trend">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  {period === 'daily' ? 'Daily' : period === 'week' ? 'Weekly' : 'Monthly'} Trend
                </h2>
                {data.trend.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No trend data available</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Provider</th>
                          <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Calls</th>
                          <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.trend.slice(0, 20).map((t, i) => (
                          <tr key={i}>
                            <td className="py-2 text-gray-600">{t.date}</td>
                            <td className="py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getProviderColor(t.provider)}`}>
                                {getProviderLabel(t.provider)}
                              </span>
                            </td>
                            <td className="py-2 text-right text-gray-900">{formatNumber(t.calls)}</td>
                            <td className="py-2 text-right text-gray-900">{formatCurrency(t.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6" data-testid="card-by-property">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Cost per Property</h2>
              </div>
              {(!data.byProperty || data.byProperty.length === 0) ? (
                <p className="text-sm text-gray-400 text-center py-8">No per-property cost data available</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Property</th>
                        <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Calls</th>
                        <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Input Tokens</th>
                        <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Output Tokens</th>
                        <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Thinking</th>
                        <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Cost</th>
                        <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Providers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.byProperty.map((p, i) => (
                        <tr key={i} data-testid={`property-cost-row-${i}`}>
                          <td className="py-2 text-gray-900 max-w-[250px] truncate" title={p.propertyName}>
                            {p.propertyName}
                          </td>
                          <td className="py-2 text-right text-gray-600">{formatNumber(p.totalCalls)}</td>
                          <td className="py-2 text-right text-gray-600">{formatTokens(p.totalInputTokens)}</td>
                          <td className="py-2 text-right text-gray-600">{formatTokens(p.totalOutputTokens)}</td>
                          <td className="py-2 text-right text-gray-600">{formatTokens(p.totalThinkingTokens)}</td>
                          <td className="py-2 text-right font-medium text-gray-900">{formatCurrency(p.totalCostUsd)}</td>
                          <td className="py-2 text-gray-500 text-xs">{p.providers || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="card-recent-events">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent API Calls</h2>
              {data.recentEvents.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No enrichment events recorded yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Time</th>
                        <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Provider</th>
                        <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Endpoint</th>
                        <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Tokens</th>
                        <th className="text-right py-2 text-xs font-medium text-gray-500 uppercase">Cost</th>
                        <th className="text-center py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.recentEvents.map((event) => {
                        const hasTokens = event.inputTokens || event.outputTokens;
                        return (
                          <tr key={event.id} data-testid={`event-row-${event.id}`}>
                            <td className="py-2 text-gray-500 whitespace-nowrap">
                              {new Date(event.createdAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getProviderColor(event.provider)}`}>
                                {getProviderLabel(event.provider)}
                              </span>
                            </td>
                            <td className="py-2 text-gray-900 font-mono text-xs">{event.endpoint}</td>
                            <td className="py-2 text-right text-gray-600 text-xs whitespace-nowrap">
                              {hasTokens ? (
                                <span title={`In: ${event.inputTokens?.toLocaleString() || 0} / Out: ${event.outputTokens?.toLocaleString() || 0}${event.thinkingTokens ? ` / Think: ${event.thinkingTokens.toLocaleString()}` : ''}`}>
                                  {formatTokens(event.inputTokens)}<span className="text-gray-400">/</span>{formatTokens(event.outputTokens)}
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-2 text-right text-gray-900">{formatCurrency(event.estimatedCostUsd)}</td>
                            <td className="py-2 text-center">
                              {event.success ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">OK</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800" title={event.errorMessage || ''}>Fail</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
