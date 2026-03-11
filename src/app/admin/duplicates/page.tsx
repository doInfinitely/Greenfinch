'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Search,
  Merge,
  X,
  Check,
  Loader2,
  AlertTriangle,
  Building2,
  MapPin,
  Users,
} from 'lucide-react';

type EntityType = 'contact' | 'organization' | 'property';

interface DuplicateFlag {
  id: string;
  entityType: EntityType;
  entityIdA: string | null;
  entityIdB: string | null;
  contactIdA: string | null;
  contactIdB: string | null;
  matchType: string;
  matchKey: string;
  confidence: number;
  status: string;
  createdAt: string;
  contactA: ContactSummary | null;
  contactB: ContactSummary | null;
  entityA: any | null;
  entityB: any | null;
}

interface ContactSummary {
  id: string;
  fullName: string;
  email: string | null;
  title: string | null;
  employerName: string | null;
  companyDomain: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  emailValidationStatus: string | null;
  source: string | null;
}

interface ScanResult {
  contacts: { found: number; totalPending: number };
  organizations: { found: number; totalPending: number };
  properties: { found: number; totalPending: number };
}

type ConfidenceFilter = 'all' | 'high' | 'medium';

export default function DuplicatesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<EntityType>('contact');
  const [flags, setFlags] = useState<DuplicateFlag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [counts, setCounts] = useState({ contact: 0, organization: 0, property: 0 });

  const fetchFlags = useCallback(async (entityType: EntityType) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/potential-duplicates?status=pending&entityType=${entityType}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setFlags(data.data || []);
        setCounts(prev => ({ ...prev, [entityType]: data.meta?.total || 0 }));
      }
    } catch (error) {
      console.error('Failed to fetch duplicates:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAllCounts = useCallback(async () => {
    const types: EntityType[] = ['contact', 'organization', 'property'];
    const newCounts = { contact: 0, organization: 0, property: 0 };
    for (const t of types) {
      try {
        const res = await fetch(`/api/admin/potential-duplicates?status=pending&entityType=${t}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          newCounts[t] = data.meta?.total || 0;
        }
      } catch {}
    }
    setCounts(newCounts);
  }, []);

  useEffect(() => {
    fetchFlags(activeTab);
    fetchAllCounts();
  }, [activeTab, fetchFlags, fetchAllCounts]);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/admin/run-dedup-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ entityType: 'all' }),
      });
      const data = await res.json();
      if (data.success) {
        const result = data.data as ScanResult;
        toast({
          title: 'Scan Complete',
          description: `Found: ${result.contacts.found} contacts, ${result.organizations.found} orgs, ${result.properties.found} properties`,
        });
        fetchFlags(activeTab);
        fetchAllCounts();
      } else {
        toast({ title: 'Scan Failed', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to run scan', variant: 'destructive' });
    } finally {
      setIsScanning(false);
    }
  };

  const handleAction = async (flagId: string, action: 'merge' | 'dismiss', keepId?: string) => {
    setProcessingId(flagId);
    try {
      const body: any = { flagId, action };
      if (action === 'merge') {
        body.keepEntityId = keepId;
        body.keepContactId = keepId;
      }
      const res = await fetch('/api/admin/potential-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: action === 'merge' ? 'Merged' : 'Dismissed',
          description: action === 'merge' ? 'Records merged successfully.' : 'Pair dismissed.',
        });
        fetchFlags(activeTab);
        fetchAllCounts();
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to process action', variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleBatchAction = async (action: 'merge' | 'dismiss') => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const res = await fetch('/api/admin/potential-duplicates/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, flagIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: `Batch ${action === 'merge' ? 'Merge' : 'Dismiss'} Complete`,
          description: `${data.data.succeeded} succeeded, ${data.data.failed} failed`,
        });
        setSelectedIds(new Set());
        fetchFlags(activeTab);
        fetchAllCounts();
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Batch action failed', variant: 'destructive' });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchMergeHighConfidence = async () => {
    setIsBatchProcessing(true);
    try {
      const res = await fetch('/api/admin/potential-duplicates/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'merge', entityType: activeTab, minConfidence: 0.85 }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: 'High-Confidence Merge Complete',
          description: `${data.data.succeeded} merged, ${data.data.failed} failed`,
        });
        fetchFlags(activeTab);
        fetchAllCounts();
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Batch merge failed', variant: 'destructive' });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredFlags.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredFlags.map(f => f.id)));
    }
  };

  const filteredFlags = flags.filter(f => {
    if (confidenceFilter === 'high') return (f.confidence || 0) >= 0.85;
    if (confidenceFilter === 'medium') return (f.confidence || 0) >= 0.6;
    return true;
  });

  const totalPending = counts.contact + counts.organization + counts.property;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Duplicate Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalPending} pending duplicate{totalPending !== 1 ? 's' : ''} to review
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={isScanning}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
        >
          {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {isScanning ? 'Scanning...' : 'Scan for Duplicates'}
        </button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as EntityType); setSelectedIds(new Set()); }}>
        <TabsList className="mb-4">
          <TabsTrigger value="contact" className="gap-2">
            <Users className="w-4 h-4" /> Contacts
            {counts.contact > 0 && <Badge variant="secondary" className="ml-1">{counts.contact}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="organization" className="gap-2">
            <Building2 className="w-4 h-4" /> Organizations
            {counts.organization > 0 && <Badge variant="secondary" className="ml-1">{counts.organization}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="property" className="gap-2">
            <MapPin className="w-4 h-4" /> Properties
            {counts.property > 0 && <Badge variant="secondary" className="ml-1">{counts.property}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* Action bar */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <select
            value={confidenceFilter}
            onChange={(e) => setConfidenceFilter(e.target.value as ConfidenceFilter)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            <option value="all">All confidence</option>
            <option value="high">High (&ge;0.85)</option>
            <option value="medium">Medium (&ge;0.6)</option>
          </select>

          <button
            onClick={handleBatchMergeHighConfidence}
            disabled={isBatchProcessing || filteredFlags.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm"
          >
            {isBatchProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Merge className="w-3.5 h-3.5" />}
            Merge All High-Confidence
          </button>

          {filteredFlags.length > 0 && (
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <Checkbox
                checked={selectedIds.size === filteredFlags.length && filteredFlags.length > 0}
                onChange={toggleSelectAll}
              />
              Select all ({filteredFlags.length})
            </label>
          )}
        </div>

        {/* Batch action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="text-sm font-medium text-blue-800">{selectedIds.size} selected</span>
            <button
              onClick={() => handleBatchAction('merge')}
              disabled={isBatchProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              <Merge className="w-3.5 h-3.5" />
              Merge Selected
            </button>
            <button
              onClick={() => handleBatchAction('dismiss')}
              disabled={isBatchProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 text-sm"
            >
              <X className="w-3.5 h-3.5" />
              Dismiss Selected
            </button>
          </div>
        )}

        <TabsContent value="contact">
          <DuplicateList
            flags={filteredFlags}
            entityType="contact"
            isLoading={isLoading}
            processingId={processingId}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onAction={handleAction}
          />
        </TabsContent>
        <TabsContent value="organization">
          <DuplicateList
            flags={filteredFlags}
            entityType="organization"
            isLoading={isLoading}
            processingId={processingId}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onAction={handleAction}
          />
        </TabsContent>
        <TabsContent value="property">
          <DuplicateList
            flags={filteredFlags}
            entityType="property"
            isLoading={isLoading}
            processingId={processingId}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onAction={handleAction}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DuplicateList({
  flags,
  entityType,
  isLoading,
  processingId,
  selectedIds,
  onToggleSelect,
  onAction,
}: {
  flags: DuplicateFlag[];
  entityType: EntityType;
  isLoading: boolean;
  processingId: string | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onAction: (flagId: string, action: 'merge' | 'dismiss', keepId?: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (flags.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Check className="w-8 h-8 mx-auto mb-2 text-green-500" />
        <p className="text-sm">No pending duplicates</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {flags.map((flag) => (
        <DuplicateCard
          key={flag.id}
          flag={flag}
          entityType={entityType}
          isProcessing={processingId === flag.id}
          isSelected={selectedIds.has(flag.id)}
          onToggleSelect={() => onToggleSelect(flag.id)}
          onAction={onAction}
        />
      ))}
    </div>
  );
}

function DuplicateCard({
  flag,
  entityType,
  isProcessing,
  isSelected,
  onToggleSelect,
  onAction,
}: {
  flag: DuplicateFlag;
  entityType: EntityType;
  isProcessing: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onAction: (flagId: string, action: 'merge' | 'dismiss', keepId?: string) => void;
}) {
  const confidence = flag.confidence || 0;
  const confidencePct = Math.round(confidence * 100);
  const confidenceColor =
    confidence >= 0.85 ? 'bg-green-100 text-green-800' :
    confidence >= 0.6 ? 'bg-yellow-100 text-yellow-800' :
    'bg-gray-100 text-gray-600';

  const matchLabel = formatMatchType(flag.matchType);

  // Get entity IDs for merge action
  const idA = entityType === 'contact' ? (flag.contactIdA || flag.entityIdA) : flag.entityIdA;
  const idB = entityType === 'contact' ? (flag.contactIdB || flag.entityIdB) : flag.entityIdB;

  return (
    <div className={`bg-white rounded-lg border ${isSelected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'} p-4 ${isProcessing ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isSelected}
          onChange={onToggleSelect}
          className="mt-1"
        />

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${confidenceColor}`}>
              {confidencePct}% match
            </span>
            <span className="text-xs text-gray-500">{matchLabel}</span>
            <span className="text-xs text-gray-400 ml-auto">
              {new Date(flag.createdAt).toLocaleDateString()}
            </span>
          </div>

          {/* Side-by-side */}
          <div className="grid grid-cols-2 gap-4">
            <EntitySummary
              label="A"
              entity={entityType === 'contact' ? flag.contactA : flag.entityA}
              entityType={entityType}
            />
            <EntitySummary
              label="B"
              entity={entityType === 'contact' ? flag.contactB : flag.entityB}
              entityType={entityType}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
            <button
              onClick={() => onAction(flag.id, 'merge', idA!)}
              disabled={isProcessing}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-xs font-medium"
            >
              Keep A
            </button>
            <button
              onClick={() => onAction(flag.id, 'merge', idB!)}
              disabled={isProcessing}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-xs font-medium"
            >
              Keep B
            </button>
            <button
              onClick={() => onAction(flag.id, 'dismiss')}
              disabled={isProcessing}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 text-xs font-medium ml-auto"
            >
              <X className="w-3 h-3" />
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EntitySummary({
  label,
  entity,
  entityType,
}: {
  label: string;
  entity: any;
  entityType: EntityType;
}) {
  if (!entity) return <div className="text-sm text-gray-400 italic">Not found</div>;

  if (entityType === 'contact') {
    return (
      <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
        <div className="font-medium text-gray-900 flex items-center gap-1">
          <span className="text-xs text-gray-400">{label}.</span>
          {entity.fullName || 'Unknown'}
        </div>
        {entity.title && <div className="text-gray-600 text-xs">{entity.title}</div>}
        {entity.employerName && <div className="text-gray-600 text-xs">{entity.employerName}</div>}
        {entity.email && (
          <div className="text-xs flex items-center gap-1">
            <span className="text-gray-500">{entity.email}</span>
            {entity.emailValidationStatus === 'valid' && (
              <span className="text-green-600 text-[10px]">valid</span>
            )}
          </div>
        )}
        {entity.phone && <div className="text-gray-500 text-xs">{entity.phone}</div>}
        {entity.companyDomain && <div className="text-gray-400 text-xs">{entity.companyDomain}</div>}
      </div>
    );
  }

  if (entityType === 'organization') {
    return (
      <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
        <div className="font-medium text-gray-900 flex items-center gap-1">
          <span className="text-xs text-gray-400">{label}.</span>
          {entity.name || 'Unknown'}
        </div>
        {entity.domain && <div className="text-gray-600 text-xs">{entity.domain}</div>}
        {(entity.city || entity.state) && (
          <div className="text-gray-500 text-xs">{[entity.city, entity.state].filter(Boolean).join(', ')}</div>
        )}
        {entity.employees && <div className="text-gray-400 text-xs">{entity.employees} employees</div>}
        {entity.linkedinHandle && <div className="text-gray-400 text-xs">LI: {entity.linkedinHandle}</div>}
      </div>
    );
  }

  // property
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
      <div className="font-medium text-gray-900 flex items-center gap-1">
        <span className="text-xs text-gray-400">{label}.</span>
        {entity.validatedAddress || entity.regridAddress || 'Unknown address'}
      </div>
      {(entity.city || entity.state) && (
        <div className="text-gray-600 text-xs">{[entity.city, entity.state].filter(Boolean).join(', ')}</div>
      )}
      {entity.dcadOwnerName1 && <div className="text-gray-500 text-xs">Owner: {entity.dcadOwnerName1}</div>}
      {entity.beneficialOwner && <div className="text-gray-500 text-xs">Beneficial: {entity.beneficialOwner}</div>}
      {entity.assetCategory && <div className="text-gray-400 text-xs">{entity.assetCategory}</div>}
    </div>
  );
}

function formatMatchType(matchType: string): string {
  const labels: Record<string, string> = {
    name_domain: 'Name + Domain',
    name_employer: 'Name + Employer',
    fuzzy_name_domain: 'Fuzzy Name + Domain',
    fuzzy_name_employer: 'Fuzzy Name + Employer',
    same_phone: 'Same Phone',
    fuzzy_name: 'Fuzzy Name',
    fuzzy_address: 'Fuzzy Address',
    geo_proximity: 'Geo Proximity',
    fuzzy_owner_address: 'Fuzzy Owner + Address',
  };
  return labels[matchType] || matchType;
}
