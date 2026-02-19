'use client';

import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3, TrendingUp, Users, Building2, Loader2 } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { formatCurrencyCompact } from '@/lib/utils';

interface TeamMember {
  userId: string;
  userName: string;
  activityCount: number;
  lastActivity: string;
}

interface AnalyticsData {
  teamMemberCount: number;
  propertiesWorkedThisMonth: number;
  totalPipelineValue: number;
  valueGenerated: number;
  teamActivity: TeamMember[];
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function OrgAnalytics() {
  const { orgRole } = useAuth();
  const isAdmin = orgRole === 'org:admin';
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        const response = await fetch('/api/org-admin/analytics');
        if (!response.ok) {
          if (response.status === 403) {
            setError('Admin access required');
          } else {
            throw new Error('Failed to fetch analytics');
          }
          return;
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
  }, [isAdmin]);

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

  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Organization Analytics</h1>
          
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">{error}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <Card data-testid="card-team-members">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Team Members</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-team-count">
                      {data?.teamMemberCount || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Active users in your org
                    </p>
                  </CardContent>
                </Card>
                
                <Card data-testid="card-properties-worked">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Properties Worked</CardTitle>
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-properties-worked">
                      {data?.propertiesWorkedThisMonth || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This month
                    </p>
                  </CardContent>
                </Card>
                
                <Card data-testid="card-pipeline-value">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Pipeline Value</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-pipeline-value">
                      {formatCurrencyCompact(data?.totalPipelineValue || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Total active deals
                    </p>
                  </CardContent>
                </Card>
                
                <Card data-testid="card-value-generated">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Value Generated</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-value-generated">
                      {formatCurrencyCompact(data?.valueGenerated || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      From Greenfinch leads
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Team Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  {(data?.teamActivity?.length || 0) > 0 ? (
                    <div className="space-y-4">
                      {data?.teamActivity.map((member, index) => (
                        <div
                          key={member.userId}
                          className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                          data-testid={`row-team-member-${index}`}
                        >
                          <div>
                            <p className="font-medium text-gray-900">{member.userName}</p>
                            <p className="text-sm text-gray-500">
                              Last active: {formatDate(member.lastActivity)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-gray-900">{member.activityCount}</p>
                            <p className="text-sm text-gray-500">activities</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">
                        Activity data will appear here as your team uses Greenfinch.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </AppSidebar>
  );
}
