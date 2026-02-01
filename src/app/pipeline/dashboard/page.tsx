'use client';

import { useEffect, useState, useCallback } from 'react';
import { useOrganization } from '@clerk/nextjs';
import Link from 'next/link';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { BarChart3, DollarSign, TrendingUp, Target, Loader2, Users, Calendar, MessageSquare, ChevronRight, Clock, AlertCircle } from 'lucide-react';
import { formatDistanceToNow, isPast, isToday, isTomorrow } from 'date-fns';

interface DashboardData {
  totalPipelineValue: number;
  activeOpportunities: number;
  wonThisMonth: number;
  wonValue: number;
  conversionRate: number;
}

interface OrgMember {
  id: string;
  displayName: string;
  email: string;
  profileImageUrl: string;
}

interface PendingAction {
  id: string;
  propertyId: string;
  actionType: string;
  description: string | null;
  dueAt: string;
  status: string;
  propertyAddress: string | null;
  createdBy: { firstName: string; lastName: string } | null;
}

interface RecentMention {
  id: string;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: string;
  propertyId: string | null;
  propertyAddress: string | null;
  sender: { firstName: string; lastName: string; profileImage: string | null } | null;
}

interface ActivityData {
  pendingActions: PendingAction[];
  recentMentions: RecentMention[];
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
  const [ownerFilter, setOwnerFilter] = useState<string>('mine');
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const { membership } = useOrganization();
  
  const isAdmin = membership?.role === 'org:admin' || membership?.role === 'org:super_admin';

  useEffect(() => {
    if (isAdmin) {
      fetch('/api/org/members')
        .then(res => res.json())
        .then(data => setOrgMembers(data.members || []))
        .catch(console.error);
    }
  }, [isAdmin]);

  useEffect(() => {
    async function fetchActivity() {
      try {
        setActivityLoading(true);
        const res = await fetch('/api/pipeline/activity?limit=5');
        if (res.ok) {
          const data = await res.json();
          setActivity(data);
        }
      } catch (err) {
        console.error('Failed to fetch activity:', err);
      } finally {
        setActivityLoading(false);
      }
    }
    fetchActivity();
  }, []);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (isAdmin) {
        if (ownerFilter === 'all') {
          params.set('owner', 'all');
        } else if (ownerFilter === 'unassigned') {
          params.set('owner', 'unassigned');
        } else if (ownerFilter !== 'mine') {
          params.set('owner', ownerFilter);
        }
      }
      const response = await fetch(`/api/pipeline/dashboard?${params}`);
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
  }, [ownerFilter, isAdmin]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Pipeline Dashboard</h1>
            
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="w-48" data-testid="select-owner-filter">
                    <SelectValue placeholder="Filter by owner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mine">My Pipeline</SelectItem>
                    <SelectItem value="all">All Team Members</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {orgMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-5 h-5">
                            <AvatarImage src={member.profileImageUrl} />
                            <AvatarFallback className="text-xs">
                              {member.displayName?.charAt(0) || '?'}
                            </AvatarFallback>
                          </Avatar>
                          {member.displayName}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          
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

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card data-testid="card-pending-tasks">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 gap-2">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-orange-500" />
                      Pending Tasks
                    </CardTitle>
                    {(activity?.pendingActions?.length || 0) > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {activity?.pendingActions?.length}
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    {activityLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : !activity?.pendingActions?.length ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No pending tasks</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {activity.pendingActions.map((action) => {
                          const dueDate = new Date(action.dueAt);
                          const isOverdue = isPast(dueDate) && !isToday(dueDate);
                          const isDueToday = isToday(dueDate);
                          const isDueTomorrow = isTomorrow(dueDate);
                          
                          return (
                            <Link
                              key={action.id}
                              href={`/property/${action.propertyId}`}
                              className="flex items-center gap-3 p-3 -mx-3 rounded-md hover-elevate group"
                              data-testid={`task-item-${action.id}`}
                            >
                              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                isOverdue ? 'bg-red-100' : isDueToday ? 'bg-orange-100' : 'bg-gray-100'
                              }`}>
                                {isOverdue ? (
                                  <AlertCircle className="w-4 h-4 text-red-600" />
                                ) : (
                                  <Calendar className="w-4 h-4 text-orange-600" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {action.description || 'Follow-up'}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {action.propertyAddress || 'Unknown property'}
                                </p>
                              </div>
                              <div className="flex-shrink-0 text-right">
                                <Badge 
                                  variant={isOverdue ? 'destructive' : isDueToday ? 'default' : 'secondary'}
                                  className="text-xs"
                                >
                                  {isOverdue ? 'Overdue' : isDueToday ? 'Today' : isDueTomorrow ? 'Tomorrow' : formatDistanceToNow(dueDate, { addSuffix: true })}
                                </Badge>
                              </div>
                              <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card data-testid="card-recent-mentions">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 gap-2">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-blue-500" />
                      Recent Mentions
                    </CardTitle>
                    {(activity?.recentMentions?.filter(m => !m.isRead)?.length || 0) > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {activity?.recentMentions?.filter(m => !m.isRead)?.length} new
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    {activityLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : !activity?.recentMentions?.length ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No recent mentions</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {activity.recentMentions.map((mention) => (
                          <Link
                            key={mention.id}
                            href={mention.propertyId ? `/property/${mention.propertyId}` : '#'}
                            className={`flex items-center gap-3 p-3 -mx-3 rounded-md hover-elevate group ${!mention.isRead ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}
                            data-testid={`mention-item-${mention.id}`}
                          >
                            <Avatar className="w-8 h-8 flex-shrink-0">
                              <AvatarImage src={mention.sender?.profileImage || ''} />
                              <AvatarFallback className="text-xs bg-blue-100 text-blue-700">
                                {mention.sender?.firstName?.charAt(0) || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {mention.sender?.firstName} {mention.sender?.lastName}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {mention.propertyAddress || 'mentioned you'}
                              </p>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(mention.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </AppSidebar>
  );
}
