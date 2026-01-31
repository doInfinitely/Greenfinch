'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useOrganization } from '@clerk/nextjs';
import AppSidebar from '@/components/AppSidebar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/lib/schema';
import { Loader2, Clock, Users, Check, X, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { normalizeCommonName } from '@/lib/normalization';

interface OrgMember {
  id: string;
  displayName: string;
  email: string;
  profileImageUrl: string;
}

// Only show opportunity stages (exclude new and disqualified)
const DEFAULT_COLUMNS: PipelineStatus[] = ['qualified', 'attempted_contact', 'active_opportunity', 'won'];
const ALL_COLUMNS: PipelineStatus[] = ['qualified', 'attempted_contact', 'active_opportunity', 'won', 'lost'];

const COLUMN_STYLES: Record<PipelineStatus, { bg: string; accent: string; badge: string }> = {
  new: { bg: 'bg-slate-50', accent: 'bg-slate-400', badge: 'bg-slate-100 text-slate-700' },
  qualified: { bg: 'bg-green-50/50', accent: 'bg-green-500', badge: 'bg-green-100 text-green-700' },
  attempted_contact: { bg: 'bg-yellow-50/50', accent: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-700' },
  active_opportunity: { bg: 'bg-purple-50/50', accent: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700' },
  won: { bg: 'bg-green-100', accent: 'bg-green-600', badge: 'bg-green-200 text-green-800' },
  lost: { bg: 'bg-red-50', accent: 'bg-red-400', badge: 'bg-red-100 text-red-700' },
  disqualified: { bg: 'bg-gray-50', accent: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600' },
};

interface PipelineItem {
  id: string;
  propertyId: string;
  status: PipelineStatus;
  dealValue: number | null;
  statusChangedAt: string;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  commonName: string | null;
  category: string | null;
  subcategory: string | null;
  ownerId: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerProfileImageUrl: string | null;
}

interface BoardData {
  items: Record<PipelineStatus, PipelineItem[]>;
  counts: Record<PipelineStatus, number>;
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

function getDaysInStage(statusChangedAt: string): number {
  const changed = new Date(statusChangedAt);
  const now = new Date();
  const diffMs = now.getTime() - changed.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function formatDaysInStage(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 7) return `${days} days`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}

function getOwnerInitials(firstName: string | null, lastName: string | null): string {
  const first = firstName?.charAt(0) || '';
  const last = lastName?.charAt(0) || '';
  return (first + last).toUpperCase() || '?';
}

export default function PipelineBoard() {
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<PipelineItem | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<PipelineStatus | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>('mine');
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [showLost, setShowLost] = useState(false);
  const { toast } = useToast();
  const { membership } = useOrganization();
  
  const isAdmin = membership?.role === 'org:admin' || membership?.role === 'org:super_admin';
  
  // Columns to display (hide lost by default)
  const visibleColumns = showLost ? ALL_COLUMNS : DEFAULT_COLUMNS;

  useEffect(() => {
    if (isAdmin) {
      fetch('/api/org/members')
        .then(res => res.json())
        .then(data => setOrgMembers(data.members || []))
        .catch(console.error);
    }
  }, [isAdmin]);

  const fetchBoardData = useCallback(async () => {
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
      const response = await fetch(`/api/pipeline/board?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch board data');
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
    fetchBoardData();
  }, [fetchBoardData]);

  const handleDragStart = useCallback((e: React.DragEvent, item: PipelineItem) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '0.4';
    target.style.transform = 'scale(1.02)';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';
    target.style.transform = 'scale(1)';
    setDraggedItem(null);
    setDragOverColumn(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, status: PipelineStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  }, []);

  // Quick action to set status to won or lost
  const handleQuickStatus = useCallback(async (item: PipelineItem, newStatus: 'won' | 'lost', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (item.status === newStatus) return;
    
    const oldStatus = item.status;
    setUpdating(item.id);
    
    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      const newItems = { ...prev.items };
      const newCounts = { ...prev.counts };
      
      newItems[oldStatus] = newItems[oldStatus].filter(i => i.id !== item.id);
      newCounts[oldStatus] = newItems[oldStatus].length;
      
      const updatedItem = { ...item, status: newStatus, statusChangedAt: new Date().toISOString() };
      newItems[newStatus] = [...newItems[newStatus], updatedItem];
      newCounts[newStatus] = newItems[newStatus].length;
      
      return { items: newItems, counts: newCounts };
    });
    
    try {
      const response = await fetch(`/api/properties/${item.propertyId}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      
      if (!response.ok) throw new Error('Failed to update');
      
      toast({
        title: newStatus === 'won' ? 'Closed Won!' : 'Closed Lost',
        description: `Deal moved to ${PIPELINE_STATUS_LABELS[newStatus]}`,
      });
    } catch (error) {
      // Revert on error
      fetchBoardData();
      toast({
        title: 'Error',
        description: 'Failed to update status',
        variant: 'destructive',
      });
    } finally {
      setUpdating(null);
    }
  }, [fetchBoardData, toast]);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, newStatus: PipelineStatus) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedItem || draggedItem.status === newStatus) {
      return;
    }

    const itemSnapshot = { ...draggedItem };
    const itemId = itemSnapshot.id;
    const oldStatus = itemSnapshot.status;

    setDraggedItem(null);
    setUpdating(itemId);

    setData(prev => {
      if (!prev) return prev;
      
      const newItems = { ...prev.items };
      const newCounts = { ...prev.counts };
      
      newItems[oldStatus] = newItems[oldStatus].filter(item => item.id !== itemId);
      newCounts[oldStatus] = newItems[oldStatus].length;
      
      const updatedItem = { ...itemSnapshot, status: newStatus, statusChangedAt: new Date().toISOString() };
      newItems[newStatus] = [updatedItem, ...newItems[newStatus]];
      newCounts[newStatus] = newItems[newStatus].length;
      
      return { items: newItems, counts: newCounts };
    });

    try {
      const response = await fetch(`/api/pipeline/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      toast({
        title: 'Status updated',
        description: `Moved to ${PIPELINE_STATUS_LABELS[newStatus]}`,
      });
    } catch (err) {
      setData(prev => {
        if (!prev) return prev;
        
        const newItems = { ...prev.items };
        const newCounts = { ...prev.counts };
        
        newItems[newStatus] = newItems[newStatus].filter(item => item.id !== itemId);
        newCounts[newStatus] = newItems[newStatus].length;
        
        const revertedItem = { ...itemSnapshot, status: oldStatus };
        newItems[oldStatus] = [revertedItem, ...newItems[oldStatus]];
        newCounts[oldStatus] = newItems[oldStatus].length;
        
        return { items: newItems, counts: newCounts };
      });

      toast({
        title: 'Error',
        description: 'Failed to update status. Changes reverted.',
        variant: 'destructive',
      });
    } finally {
      setUpdating(null);
    }
  }, [draggedItem, toast]);

  return (
    <AppSidebar>
      <div className="h-full bg-background dark:bg-background">
        <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 md:px-6 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg md:text-xl font-semibold">Pipeline</h1>
              <p className="text-xs text-muted-foreground md:hidden">Swipe to navigate</p>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant={showLost ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowLost(!showLost)}
                className="gap-1"
                data-testid="button-toggle-lost"
              >
                {showLost ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">{showLost ? 'Hide Lost' : 'Show Lost'}</span>
              </Button>
              
              {isAdmin && (
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="w-36 md:w-44" data-testid="select-owner-filter">
                    <Users className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mine">My Pipeline</SelectItem>
                    <SelectItem value="all">All Members</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {orgMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-4 h-4">
                            <AvatarImage src={member.profileImageUrl} />
                            <AvatarFallback className="text-[10px]">
                              {member.displayName?.charAt(0) || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">{member.displayName}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>
        
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-20 text-destructive">{error}</div>
        ) : (
          <div className="h-[calc(100%-64px)] overflow-x-auto overflow-y-hidden">
            <div className="flex gap-3 p-4 md:p-6 min-w-max h-full snap-x snap-mandatory scroll-smooth">
              {visibleColumns.map((status: PipelineStatus) => {
                const style = COLUMN_STYLES[status];
                const isDropTarget = dragOverColumn === status;
                
                return (
                  <div 
                    key={status} 
                    className="w-[280px] md:w-[300px] flex-shrink-0 snap-center flex flex-col" 
                    data-testid={`column-${status}`}
                    onDragOver={(e) => handleDragOver(e, status)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, status)}
                  >
                    <div className={`rounded-lg flex flex-col h-full transition-all ${style.bg} ${
                      isDropTarget ? 'ring-2 ring-primary/50 ring-offset-2' : ''
                    }`}>
                      <div className="px-3 py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${style.accent}`} />
                          <span className="text-sm font-medium text-foreground">
                            {PIPELINE_STATUS_LABELS[status]}
                          </span>
                        </div>
                        <Badge variant="secondary" className={`text-xs font-normal ${style.badge}`} data-testid={`count-${status}`}>
                          {data?.counts[status] || 0}
                        </Badge>
                      </div>
                      
                      <div className={`flex-1 overflow-y-auto px-2 pb-2 space-y-2 transition-colors ${
                        isDropTarget ? 'bg-primary/5' : ''
                      }`}>
                        {(data?.items[status]?.length || 0) > 0 ? (
                          data?.items[status].map((item) => {
                            const days = getDaysInStage(item.statusChangedAt);
                            const displayName = item.commonName 
                              ? normalizeCommonName(item.commonName)
                              : item.propertyAddress || 'Untitled Property';
                            
                            return (
                              <Link
                                key={item.id}
                                href={`/property/${item.propertyId}`}
                                draggable
                                onDragStart={(e) => handleDragStart(e, item)}
                                onDragEnd={handleDragEnd}
                                className={`block ${updating === item.id ? 'opacity-50 pointer-events-none' : ''}`}
                                data-testid={`card-property-${item.propertyId}`}
                              >
                                <div className="bg-card border border-border/50 rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-border hover:shadow-sm transition-all">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <h3 className="text-sm font-medium text-foreground truncate leading-tight">
                                        {displayName}
                                      </h3>
                                      
                                      {item.dealValue && (
                                        <p className="text-sm font-semibold text-green-600 dark:text-green-500 mt-1">
                                          {formatCurrency(item.dealValue)}
                                        </p>
                                      )}
                                    </div>
                                    
                                    {item.ownerId && (
                                      <Avatar className="w-6 h-6 flex-shrink-0">
                                        <AvatarImage src={item.ownerProfileImageUrl || undefined} />
                                        <AvatarFallback className="text-[10px] bg-muted">
                                          {getOwnerInitials(item.ownerFirstName, item.ownerLastName)}
                                        </AvatarFallback>
                                      </Avatar>
                                    )}
                                  </div>
                                  
                                  <div className="flex items-center justify-between mt-2">
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Clock className="w-3 h-3" />
                                      <span>{formatDaysInStage(days)}</span>
                                    </div>
                                    
                                    {/* Quick action buttons for closing deals - only show if not already won/lost */}
                                    {item.status !== 'won' && item.status !== 'lost' && (
                                      <div className="flex items-center gap-0.5">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="text-green-600"
                                          onClick={(e) => handleQuickStatus(item, 'won', e)}
                                          title="Mark as Won"
                                          data-testid={`button-won-${item.propertyId}`}
                                        >
                                          <Check className="w-4 h-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="text-red-500"
                                          onClick={(e) => handleQuickStatus(item, 'lost', e)}
                                          title="Mark as Lost"
                                          data-testid={`button-lost-${item.propertyId}`}
                                        >
                                          <X className="w-4 h-4" />
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </Link>
                            );
                          })
                        ) : (
                          <div className={`text-center py-10 rounded-md border-2 border-dashed transition-colors ${
                            isDropTarget 
                              ? 'border-primary/40 bg-primary/10' 
                              : 'border-transparent'
                          }`}>
                            <p className="text-xs text-muted-foreground">
                              {isDropTarget ? 'Drop here' : 'No deals'}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppSidebar>
  );
}
