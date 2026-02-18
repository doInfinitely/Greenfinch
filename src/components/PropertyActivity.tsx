'use client';

import { useState, useEffect } from 'react';
import { Activity, ArrowRight, MessageSquare, DollarSign, RefreshCw, Check, X, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/lib/schema';

interface ActivityItem {
  id: string;
  activityType: string;
  previousValue: string | null;
  newValue: string | null;
  metadata: any;
  createdAt: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
  };
}

interface PropertyActivityProps {
  propertyId: string;
}

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  status_change: <ArrowRight className="w-4 h-4" />,
  note_added: <MessageSquare className="w-4 h-4" />,
  deal_value_updated: <DollarSign className="w-4 h-4" />,
  qualified: <Check className="w-4 h-4" />,
  disqualified: <AlertCircle className="w-4 h-4" />,
  requalified: <RefreshCw className="w-4 h-4" />,
};

export default function PropertyActivity({ propertyId }: PropertyActivityProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivities();
  }, [propertyId]);

  async function fetchActivities() {
    try {
      const res = await fetch(`/api/properties/${propertyId}/activity`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error('Error fetching activity:', error);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  function getUserName(user: ActivityItem['user']): string {
    if (user.firstName || user.lastName) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }
    return 'Unknown user';
  }

  function getUserInitials(firstName: string | null, lastName: string | null): string {
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  }

  function formatCurrency(value: string): string {
    const num = parseInt(value, 10);
    if (isNaN(num)) return value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(num);
  }

  function getActivityDescription(activity: ActivityItem): React.ReactNode {
    const userName = getUserName(activity.user);

    switch (activity.activityType) {
      case 'status_change':
        const prevLabel = PIPELINE_STATUS_LABELS[activity.previousValue as PipelineStatus] || activity.previousValue;
        const newLabel = PIPELINE_STATUS_LABELS[activity.newValue as PipelineStatus] || activity.newValue;
        return (
          <>
            <span className="font-medium">{userName}</span> moved from{' '}
            <span className="font-medium">{prevLabel}</span> to{' '}
            <span className="font-medium">{newLabel}</span>
          </>
        );

      case 'note_added':
        return (
          <>
            <span className="font-medium">{userName}</span> added a note
          </>
        );

      case 'deal_value_updated':
        if (activity.previousValue) {
          return (
            <>
              <span className="font-medium">{userName}</span> updated deal value from{' '}
              <span className="font-medium">{formatCurrency(activity.previousValue)}</span> to{' '}
              <span className="font-medium">{formatCurrency(activity.newValue || '0')}</span>
            </>
          );
        }
        return (
          <>
            <span className="font-medium">{userName}</span> set deal value to{' '}
            <span className="font-medium">{formatCurrency(activity.newValue || '0')}</span>
          </>
        );

      case 'qualified':
        return (
          <>
            <span className="font-medium">{userName}</span> qualified this property
          </>
        );

      case 'disqualified':
        return (
          <>
            <span className="font-medium">{userName}</span> disqualified this property
          </>
        );

      case 'requalified':
        return (
          <>
            <span className="font-medium">{userName}</span> requalified this property
          </>
        );

      default:
        return (
          <>
            <span className="font-medium">{userName}</span> performed{' '}
            {activity.activityType.replace(/_/g, ' ')}
          </>
        );
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Activity className="w-4 h-4 text-green-600" />
            </div>
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex gap-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-activity">
      <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Activity className="w-4 h-4 text-green-600" />
          </div>
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No activity yet.
          </p>
        ) : (
          <div className="space-y-4 max-h-64 overflow-y-auto">
            {activities.map((activity, index) => (
              <div key={activity.id} className="flex gap-3 relative pb-3 border-b border-gray-100 last:border-b-0 last:pb-0">
                {index < activities.length - 1 && (
                  <div className="absolute left-4 top-8 bottom-0 w-px bg-gray-200" />
                )}
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 z-10">
                  <span className="text-green-600">
                    {ACTIVITY_ICONS[activity.activityType] || <Activity className="w-4 h-4" />}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    {getActivityDescription(activity)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(activity.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
