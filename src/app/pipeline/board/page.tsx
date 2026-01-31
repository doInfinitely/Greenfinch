'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useOrganization } from '@clerk/nextjs';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/lib/schema';
import { Loader2, MapPin, Building2, GripVertical, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { normalizeCommonName } from '@/lib/normalization';

interface OrgMember {
  id: string;
  displayName: string;
  email: string;
  profileImageUrl: string;
}

const BOARD_COLUMNS: PipelineStatus[] = ['new', 'qualified', 'attempted_contact', 'active_opportunity', 'won', 'lost'];

const COLUMN_COLORS: Record<PipelineStatus, string> = {
  new: 'border-t-gray-400',
  qualified: 'border-t-green-500',
  attempted_contact: 'border-t-yellow-500',
  active_opportunity: 'border-t-purple-500',
  won: 'border-t-emerald-500',
  lost: 'border-t-red-500',
  disqualified: 'border-t-gray-400',
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

export default function PipelineBoard() {
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<PipelineItem | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<PipelineStatus | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>('mine');
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const { toast } = useToast();
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
    target.style.opacity = '0.5';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';
    setDraggedItem(null);
    setDragOverColumn(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, status: PipelineStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  }, []);

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
      
      const updatedItem = { ...itemSnapshot, status: newStatus };
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
      <div className="h-full bg-gray-50 p-4 md:p-6 overflow-x-auto">
        <div className="max-w-full">
          <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">Pipeline Board</h1>
              <p className="text-xs text-gray-500 md:hidden mt-1">Swipe to see more columns →</p>
            </div>
            
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground hidden md:block" />
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="w-36 md:w-48" data-testid="select-owner-filter">
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
            <div className="flex gap-3 md:gap-4 min-w-max pb-4 snap-x snap-mandatory">
              {BOARD_COLUMNS.map((status) => (
                <div 
                  key={status} 
                  className="w-64 md:w-72 flex-shrink-0 snap-start" 
                  data-testid={`column-${status}`}
                  onDragOver={(e) => handleDragOver(e, status)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, status)}
                >
                  <Card className={`border-t-4 ${COLUMN_COLORS[status]} ${
                    dragOverColumn === status ? 'ring-2 ring-primary ring-offset-2' : ''
                  }`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center justify-between">
                        {PIPELINE_STATUS_LABELS[status]}
                        <span className="text-muted-foreground font-normal" data-testid={`count-${status}`}>
                          {data?.counts[status] || 0}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className={`min-h-[300px] md:min-h-[400px] max-h-[500px] md:max-h-[600px] overflow-y-auto space-y-2 md:space-y-3 transition-colors ${
                      dragOverColumn === status ? 'bg-primary/5' : ''
                    }`}>
                      {(data?.items[status]?.length || 0) > 0 ? (
                        data?.items[status].map((item) => (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, item)}
                            onDragEnd={handleDragEnd}
                            className={`group cursor-grab active:cursor-grabbing ${
                              updating === item.id ? 'opacity-50 pointer-events-none' : ''
                            }`}
                            data-testid={`card-property-${item.propertyId}`}
                          >
                            <div className="p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-all hover:border-gray-300">
                              <div className="flex items-start gap-2">
                                <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-gray-500 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  {item.commonName && (
                                    <Link 
                                      href={`/property/${item.propertyId}`}
                                      className="font-medium text-sm text-gray-900 truncate block hover:text-primary"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {normalizeCommonName(item.commonName)}
                                    </Link>
                                  )}
                                  <Link 
                                    href={`/property/${item.propertyId}`}
                                    className="flex items-start gap-1 text-xs text-gray-600 mt-1 hover:text-primary"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                    <span className="truncate">
                                      {item.propertyAddress || 'No address'}
                                    </span>
                                  </Link>
                                  {item.category && (
                                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                                      <Building2 className="w-3 h-3 flex-shrink-0" />
                                      <span>{item.category}</span>
                                    </div>
                                  )}
                                  {item.dealValue && (
                                    <div className="mt-2 text-sm font-semibold text-green-600">
                                      {formatCurrency(item.dealValue)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className={`text-center py-8 rounded-lg border-2 border-dashed ${
                          dragOverColumn === status ? 'border-primary bg-primary/10' : 'border-transparent'
                        }`}>
                          <p className="text-sm text-muted-foreground">
                            {dragOverColumn === status ? 'Drop here' : 'No properties'}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppSidebar>
  );
}
