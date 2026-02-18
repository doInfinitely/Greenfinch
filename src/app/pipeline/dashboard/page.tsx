'use client';

import { useEffect, useState, useCallback } from 'react';
import { useOrganization } from '@clerk/nextjs';
import Link from 'next/link';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { BarChart3, DollarSign, TrendingUp, Target, Loader2, Users, Calendar, MessageSquare, ChevronRight, Clock, AlertCircle, List, Building2, User } from 'lucide-react';
import { formatDistanceToNow, isPast, isToday, isTomorrow } from 'date-fns';

interface DashboardData {
  totalPipelineValue: number;
  activeOpportunities: number;
  wonThisMonth: number;
  wonValue: number;
  conversionRate: number;
  funnel?: {
    qualifiedToAttempted: number;
    attemptedToActive: number;
    activeToWon: number;
  };
  counts?: {
    qualified: number;
    attemptedContact: number;
    activeOpportunity: number;
    won: number;
    lost: number;
  };
}

interface OrgMember {
  id: string;
  dbUserId: string | null;
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

interface UserList {
  id: string;
  listName: string | null;
  listType: string | null;
  createdAt: string;
  itemCount: number;
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
  const [timeframe, setTimeframe] = useState<string>('month');
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [lists, setLists] = useState<UserList[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
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

  useEffect(() => {
    async function fetchLists() {
      try {
        setListsLoading(true);
        const res = await fetch('/api/lists');
        if (res.ok) {
          const data = await res.json();
          const sortedLists = (data.lists || [])
            .sort((a: UserList, b: UserList) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5);
          setLists(sortedLists);
        }
      } catch (err) {
        console.error('Failed to fetch lists:', err);
      } finally {
        setListsLoading(false);
      }
    }
    fetchLists();
  }, []);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set('timeframe', timeframe);
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
  }, [ownerFilter, timeframe, isAdmin]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Pipeline Dashboard</h1>
            
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="w-32" data-testid="select-timeframe">
                  <SelectValue placeholder="Timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="quarter">This Quarter</SelectItem>
                  <SelectItem value="year">This Year</SelectItem>
                </SelectContent>
              </Select>

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
                      {orgMembers
                        .filter((member) => member.dbUserId)
                        .map((member) => (
                        <SelectItem key={member.dbUserId!} value={member.dbUserId!}>
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
                    <CardTitle className="text-sm font-medium">Opportunities</CardTitle>
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
                    <CardTitle className="text-sm font-medium">Close Rate</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-conversion-rate">
                      {data?.conversionRate || 0}%
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Won / (Won + Lost)
                    </p>
                  </CardContent>
                </Card>
              </div>

              {data?.funnel && (
                <Card className="mb-6" data-testid="card-funnel-metrics">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">Pipeline Funnel</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Stage Counts */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                      <div className="text-center p-3 bg-green-50 rounded-lg border border-green-200">
                        <div className="text-2xl font-bold text-green-700" data-testid="text-qualified-count">
                          {data.counts?.qualified || 0}
                        </div>
                        <div className="text-xs text-green-600">Qualified</div>
                      </div>
                      <div className="text-center p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <div className="text-2xl font-bold text-yellow-700" data-testid="text-attempted-count">
                          {data.counts?.attemptedContact || 0}
                        </div>
                        <div className="text-xs text-yellow-600">Attempted</div>
                      </div>
                      <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-200">
                        <div className="text-2xl font-bold text-purple-700" data-testid="text-active-count">
                          {data.counts?.activeOpportunity || 0}
                        </div>
                        <div className="text-xs text-purple-600">Active</div>
                      </div>
                      <div className="text-center p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                        <div className="text-2xl font-bold text-emerald-700" data-testid="text-won-total">
                          {data.counts?.won || 0}
                        </div>
                        <div className="text-xs text-emerald-600">Won</div>
                      </div>
                      <div className="text-center p-3 bg-red-50 rounded-lg border border-red-200 col-span-2 md:col-span-1">
                        <div className="text-2xl font-bold text-red-700" data-testid="text-lost-total">
                          {data.counts?.lost || 0}
                        </div>
                        <div className="text-xs text-red-600">Lost</div>
                      </div>
                    </div>
                    {/* Conversion Rates */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                        <span className="text-2xl font-bold text-blue-600" data-testid="text-qualified-to-attempted">
                          {data.funnel.qualifiedToAttempted}%
                        </span>
                        <span className="text-xs text-muted-foreground text-center mt-1">
                          Qualified → Attempted Contact
                        </span>
                      </div>
                      <div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                        <span className="text-2xl font-bold text-purple-600" data-testid="text-attempted-to-active">
                          {data.funnel.attemptedToActive}%
                        </span>
                        <span className="text-xs text-muted-foreground text-center mt-1">
                          Attempted → Active Opp
                        </span>
                      </div>
                      <div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                        <span className="text-2xl font-bold text-green-600" data-testid="text-active-to-won">
                          {data.funnel.activeToWon}%
                        </span>
                        <span className="text-xs text-muted-foreground text-center mt-1">
                          Active Opp → Won
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {(data?.activeOpportunities || 0) === 0 && !data?.counts?.won && !data?.counts?.lost && (
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
                            className={`flex items-center gap-3 p-3 -mx-3 rounded-md hover-elevate group ${!mention.isRead ? 'bg-blue-50' : ''}`}
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

              <Card className="mt-6" data-testid="card-recent-lists">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 gap-2">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <List className="w-4 h-4 text-purple-500" />
                    Recent Lists
                  </CardTitle>
                  <Link href="/lists" className="text-xs text-blue-600 hover:underline">
                    View all
                  </Link>
                </CardHeader>
                <CardContent className="pt-0">
                  {listsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : lists.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <List className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No lists yet</p>
                      <p className="text-xs mt-1">Create lists to organize your properties and contacts</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {lists.map((list) => (
                        <Link
                          key={list.id}
                          href={`/lists/${list.id}`}
                          className="flex items-center gap-3 p-3 border rounded-lg hover-elevate group"
                          data-testid={`list-item-${list.id}`}
                        >
                          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                            list.listType === 'properties' ? 'bg-blue-100' : 'bg-purple-100'
                          }`}>
                            {list.listType === 'properties' ? (
                              <Building2 className="w-4 h-4 text-blue-600" />
                            ) : (
                              <User className="w-4 h-4 text-purple-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {list.listName || 'Untitled List'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {list.itemCount} {list.listType === 'properties' ? 'properties' : 'contacts'}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      ))}
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
