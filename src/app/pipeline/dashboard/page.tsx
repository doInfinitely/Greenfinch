'use client';

import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3, DollarSign, TrendingUp, Target, Loader2 } from 'lucide-react';

interface DashboardData {
  totalPipelineValue: number;
  activeOpportunities: number;
  wonThisMonth: number;
  wonValue: number;
  conversionRate: number;
}

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

export default function PipelineDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/pipeline/dashboard');
        if (!response.ok) {
          throw new Error('Failed to fetch dashboard data');
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Pipeline Dashboard</h1>
          
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">{error}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <Card data-testid="card-pipeline-value">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Pipeline Value</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-pipeline-value">
                      {formatCurrency(data?.totalPipelineValue || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Across all active opportunities
                    </p>
                  </CardContent>
                </Card>
                
                <Card data-testid="card-active-opportunities">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Opportunities</CardTitle>
                    <Target className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-active-opportunities">
                      {data?.activeOpportunities || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Properties in pipeline
                    </p>
                  </CardContent>
                </Card>
                
                <Card data-testid="card-won-this-month">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Won This Month</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-won-count">
                      {data?.wonThisMonth || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(data?.wonValue || 0)} in deal value
                    </p>
                  </CardContent>
                </Card>
                
                <Card data-testid="card-conversion-rate">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-conversion-rate">
                      {data?.conversionRate || 0}%
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Qualified to won
                    </p>
                  </CardContent>
                </Card>
              </div>

              {(data?.activeOpportunities || 0) === 0 && (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">
                    Start qualifying properties to see your pipeline analytics here.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppSidebar>
  );
}
