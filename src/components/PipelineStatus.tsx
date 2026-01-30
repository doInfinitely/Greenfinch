'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, DollarSign, Check, X, TrendingUp, TrendingDown, AlertCircle, User, UserPlus } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PIPELINE_STATUS_LABELS, type PipelineStatus as PipelineStatusType } from '@/lib/schema';

interface PipelineStatusProps {
  propertyId: string;
  inline?: boolean;
  autoAssignOnFirstStatus?: boolean;
  hideOwnerControls?: boolean;
  triggerAssignDialog?: number; // Increment to open dialog from parent
}

const STATUS_COLORS: Record<PipelineStatusType, string> = {
  new: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  qualified: 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200',
  attempted_contact: 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200',
  active_opportunity: 'bg-violet-200 text-violet-800 dark:bg-violet-800 dark:text-violet-200',
  won: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200',
  lost: 'bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200',
  disqualified: 'bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-200',
};

const STATUS_ICONS: Record<PipelineStatusType, React.ReactNode> = {
  new: null,
  qualified: <Check className="w-4 h-4" />,
  attempted_contact: <TrendingUp className="w-4 h-4" />,
  active_opportunity: <TrendingUp className="w-4 h-4" />,
  won: <Check className="w-4 h-4" />,
  lost: <X className="w-4 h-4" />,
  disqualified: <AlertCircle className="w-4 h-4" />,
};

const PIPELINE_PROGRESSION: PipelineStatusType[] = [
  'new',
  'qualified',
  'attempted_contact',
  'active_opportunity',
  'won',
];

interface Owner {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profileImageUrl: string | null;
  displayName: string;
}

interface OrgMember {
  id: string;
  displayName: string;
  email: string;
  profileImageUrl: string;
}

export default function PipelineStatus({ propertyId, inline = false, autoAssignOnFirstStatus = false, hideOwnerControls = false, triggerAssignDialog = 0 }: PipelineStatusProps) {
  const { orgRole } = useAuth();
  const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';
  
  const [pipeline, setPipeline] = useState<{
    id?: string;
    status: PipelineStatusType;
    dealValue: number | null;
    ownerId: string | null;
    owner: Owner | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showQualifyDialog, setShowQualifyDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [dealValueInput, setDealValueInput] = useState('');
  const [pendingStatus, setPendingStatus] = useState<PipelineStatusType | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [claiming, setClaiming] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchPipeline();
  }, [propertyId]);

  // Handle external trigger to open assign dialog
  useEffect(() => {
    if (triggerAssignDialog > 0) {
      openAssignDialog();
    }
  }, [triggerAssignDialog]);

  async function fetchPipeline() {
    try {
      const res = await fetch(`/api/properties/${propertyId}/pipeline`);
      if (res.ok) {
        const data = await res.json();
        setPipeline(data.pipeline);
      }
    } catch (error) {
      console.error('Error fetching pipeline:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(newStatus: PipelineStatusType, dealValue?: number) {
    // Check if we need to prompt for deal value
    const existingDealValue = pipeline?.dealValue;
    if (newStatus === 'qualified' && !dealValue && !existingDealValue) {
      setPendingStatus(newStatus);
      setShowQualifyDialog(true);
      return;
    }

    // Close dialog first for better UX
    setShowQualifyDialog(false);
    setUpdating(true);
    
    // Auto-assign to current user if moving from no status/new to a real status
    const shouldAutoClaim = autoAssignOnFirstStatus && 
      (!pipeline?.ownerId) && 
      (pipeline?.status === 'new' || !pipeline?.status) && 
      newStatus !== 'new';
    
    try {
      const res = await fetch(`/api/properties/${propertyId}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: newStatus, 
          dealValue: dealValue || existingDealValue,
          autoClaim: shouldAutoClaim 
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update status');
      }

      const data = await res.json();
      setPipeline(data.pipeline);
      toast({
        title: 'Status updated',
        description: `Property moved to ${PIPELINE_STATUS_LABELS[newStatus]}`,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update status',
        variant: 'destructive',
      });
    } finally {
      // Use setTimeout to ensure state updates don't conflict with dialog animations
      setTimeout(() => {
        setUpdating(false);
        setDealValueInput('');
        setPendingStatus(null);
      }, 100);
    }
  }

  function handleQualifySubmit() {
    const value = parseInt(dealValueInput.replace(/[^0-9]/g, ''), 10);
    if (!value || value <= 1) {
      toast({
        title: 'Invalid deal value',
        description: 'Deal value must be greater than $1',
        variant: 'destructive',
      });
      return;
    }
    updateStatus(pendingStatus || 'qualified', value);
  }

  async function fetchOrgMembers() {
    try {
      const res = await fetch('/api/org/members');
      if (res.ok) {
        const data = await res.json();
        setOrgMembers(data.members || []);
      }
    } catch (error) {
      console.error('Error fetching org members:', error);
    }
  }

  async function handleClaim() {
    if (!pipeline?.id) return;
    
    setClaiming(true);
    try {
      const res = await fetch(`/api/pipeline/${pipeline.id}/claim`, {
        method: 'POST',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to claim property');
      }

      await fetchPipeline();
      toast({
        title: 'Property claimed',
        description: 'You are now the owner of this opportunity',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to claim property',
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  }

  async function handleAssignOwner() {
    if (!pipeline?.id || !selectedOwnerId) return;
    
    setUpdating(true);
    try {
      const res = await fetch(`/api/pipeline/${pipeline.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: selectedOwnerId === 'unassigned' ? null : selectedOwnerId }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to assign owner');
      }

      await fetchPipeline();
      setShowAssignDialog(false);
      toast({
        title: 'Owner assigned',
        description: selectedOwnerId === 'unassigned' ? 'Owner removed from this opportunity' : 'Owner successfully assigned',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to assign owner',
        variant: 'destructive',
      });
    } finally {
      setUpdating(false);
      setSelectedOwnerId('');
    }
  }

  function openAssignDialog() {
    fetchOrgMembers();
    setSelectedOwnerId(pipeline?.ownerId || '');
    setShowAssignDialog(true);
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  }

  if (loading) {
    if (inline) {
      return (
        <div className="flex items-center gap-2">
          <div className="h-9 w-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-md" />
        </div>
      );
    }
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Pipeline Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-10 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-md" />
        </CardContent>
      </Card>
    );
  }

  const currentStatus = pipeline?.status || 'new';
  const dealValue = pipeline?.dealValue;

  const dropdownContent = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`flex items-center gap-2 ${STATUS_COLORS[currentStatus]}`}
          disabled={updating}
          data-testid="dropdown-pipeline-status"
        >
          {STATUS_ICONS[currentStatus]}
          {PIPELINE_STATUS_LABELS[currentStatus]}
          <ChevronDown className="w-4 h-4 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-lg z-[100]">
        {PIPELINE_PROGRESSION.map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={() => updateStatus(status)}
            className={currentStatus === status ? 'bg-accent' : ''}
            data-testid={`menu-item-status-${status}`}
          >
            <span className={`flex items-center gap-2 ${STATUS_COLORS[status]} px-2 py-1 rounded-md w-full`}>
              {STATUS_ICONS[status]}
              {PIPELINE_STATUS_LABELS[status]}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => updateStatus('lost')}
          data-testid="menu-item-status-lost"
        >
          <span className={`flex items-center gap-2 ${STATUS_COLORS['lost']} px-2 py-1 rounded-md w-full`}>
            {STATUS_ICONS['lost']}
            {PIPELINE_STATUS_LABELS['lost']}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => updateStatus('disqualified')}
          data-testid="menu-item-status-disqualified"
        >
          <span className={`flex items-center gap-2 ${STATUS_COLORS['disqualified']} px-2 py-1 rounded-md w-full`}>
            {STATUS_ICONS['disqualified']}
            {PIPELINE_STATUS_LABELS['disqualified']}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const dealValueDisplay = dealValue && dealValue > 0 ? (
    <div className="flex items-center gap-1 text-sm text-muted-foreground">
      <DollarSign className="w-4 h-4" />
      <span className="font-medium">{formatCurrency(dealValue)}</span>
    </div>
  ) : null;

  const ownerDisplay = pipeline?.owner ? (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Avatar className="w-6 h-6">
        <AvatarImage src={pipeline.owner.profileImageUrl || ''} />
        <AvatarFallback className="text-xs">
          {pipeline.owner.displayName?.charAt(0) || '?'}
        </AvatarFallback>
      </Avatar>
      <span className="truncate max-w-[120px]">{pipeline.owner.displayName}</span>
      {!hideOwnerControls && isAdmin && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          onClick={openAssignDialog}
          data-testid="button-reassign-owner"
        >
          Change
        </Button>
      )}
    </div>
  ) : (
    <div className="flex items-center gap-2">
      {!hideOwnerControls && pipeline?.id && currentStatus === 'new' && !pipeline.ownerId && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleClaim}
          disabled={claiming}
          className="h-8"
          data-testid="button-claim-property"
        >
          <UserPlus className="w-4 h-4 mr-1" />
          {claiming ? 'Claiming...' : 'Claim'}
        </Button>
      )}
      {!hideOwnerControls && isAdmin && pipeline?.id && (
        <Button
          variant="ghost"
          size="sm"
          onClick={openAssignDialog}
          className="h-8"
          data-testid="button-assign-owner"
        >
          <User className="w-4 h-4 mr-1" />
          Assign
        </Button>
      )}
    </div>
  );

  const assignDialog = (
    <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Owner</DialogTitle>
          <DialogDescription>
            Select a team member to be responsible for this opportunity.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="owner">Owner</Label>
          <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId}>
            <SelectTrigger className="mt-2" data-testid="select-owner">
              <SelectValue placeholder="Select a team member" />
            </SelectTrigger>
            <SelectContent>
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
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setShowAssignDialog(false);
              setSelectedOwnerId('');
            }}
            data-testid="button-cancel-assign"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAssignOwner}
            disabled={!selectedOwnerId || updating}
            data-testid="button-confirm-assign"
          >
            {updating ? 'Assigning...' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (inline) {
    return (
      <>
        <div className="flex items-center gap-3 flex-wrap">
          {dropdownContent}
          {dealValueDisplay}
          {ownerDisplay}
        </div>
        {assignDialog}
        <Dialog open={showQualifyDialog} onOpenChange={setShowQualifyDialog}>
          <DialogContent className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
            <DialogHeader>
              <DialogTitle className="text-gray-900 dark:text-gray-100">
                {pendingStatus === 'qualified' ? 'Qualify Property' : 'Update Deal Value'}
              </DialogTitle>
              <DialogDescription className="text-gray-500 dark:text-gray-400">
                Enter the expected deal value for this property. This helps track your pipeline value.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="dealValue" className="text-gray-700 dark:text-gray-300">Expected Deal Value</Label>
              <div className="relative mt-2">
                <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="dealValue"
                  type="text"
                  placeholder="10,000"
                  value={dealValueInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    setDealValueInput(val ? parseInt(val, 10).toLocaleString() : '');
                  }}
                  className="pl-8 bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100"
                  data-testid="input-deal-value"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowQualifyDialog(false);
                  setDealValueInput('');
                  setPendingStatus(null);
                }}
                data-testid="button-cancel-deal-value"
              >
                Cancel
              </Button>
              <Button
                onClick={handleQualifySubmit}
                disabled={!dealValueInput}
                data-testid="button-confirm-deal-value"
              >
                {pendingStatus === 'qualified' ? 'Qualify' : 'Update'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Pipeline Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            {dropdownContent}
            {dealValueDisplay}
          </div>

          {currentStatus === 'disqualified' && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateStatus('new')}
                disabled={updating}
                data-testid="button-requalify"
              >
                Undo Disqualification
              </Button>
            </div>
          )}

          {dealValue && dealValue > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDealValueInput(dealValue.toString());
                setPendingStatus(currentStatus);
                setShowQualifyDialog(true);
              }}
              disabled={updating}
              data-testid="button-edit-deal-value"
            >
              Edit Deal Value
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={showQualifyDialog} onOpenChange={setShowQualifyDialog}>
        <DialogContent className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-gray-100">
              {pendingStatus === 'qualified' ? 'Qualify Property' : 'Update Deal Value'}
            </DialogTitle>
            <DialogDescription className="text-gray-500 dark:text-gray-400">
              Enter the expected deal value for this property. This helps track your pipeline value.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="dealValue" className="text-gray-700 dark:text-gray-300">Expected Deal Value</Label>
            <div className="relative mt-2">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="dealValue"
                type="text"
                placeholder="10,000"
                value={dealValueInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  setDealValueInput(val ? parseInt(val, 10).toLocaleString() : '');
                }}
                className="pl-8 bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100"
                data-testid="input-deal-value"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowQualifyDialog(false);
                setDealValueInput('');
                setPendingStatus(null);
              }}
              data-testid="button-cancel-deal-value"
            >
              Cancel
            </Button>
            <Button
              onClick={handleQualifySubmit}
              disabled={!dealValueInput}
              data-testid="button-confirm-deal-value"
            >
              {pendingStatus === 'qualified' ? 'Qualify' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
