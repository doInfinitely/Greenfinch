'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Check, X, Merge, ChevronDown, ChevronUp } from 'lucide-react';

interface Stats {
  totalProperties: number;
  parentProperties: number;
  enrichedProperties: number;
  pendingProperties: number;
  totalContacts: number;
  validatedEmails: number;
}

interface EnrichmentStatus {
  batchId?: string;
  status: string;
  isRunning: boolean;
  progress?: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  };
  percentComplete?: number;
  startedAt?: string;
  completedAt?: string;
  errors?: Array<{ propertyId: string; error: string }>;
  errorCount?: number;
  maxBatchSize: number;
}

interface IngestionResult {
  success: boolean;
  stats?: {
    created: number;
    updated: number;
    errors: number;
    total: number;
  };
  error?: string;
}

interface PotentialDuplicateContact {
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

interface PotentialDuplicate {
  id: string;
  contactIdA: string;
  contactIdB: string;
  matchType: string;
  matchKey: string;
  status: string;
  createdAt: string;
  contactA: PotentialDuplicateContact | null;
  contactB: PotentialDuplicateContact | null;
}

export default function AdminPage() {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const [ingestLimit, setIngestLimit] = useState('1000');
  const [ingestOffset, setIngestOffset] = useState('0');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionResult, setIngestionResult] = useState<IngestionResult | null>(null);
  const [ingestionSettings, setIngestionSettings] = useState<{ zipCodes: string[]; defaultLimit: number; allZips: boolean; filters?: any } | null>(null);

  const [enrichLimit, setEnrichLimit] = useState('50');
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatus | null>(null);
  const [isStartingEnrichment, setIsStartingEnrichment] = useState(false);

  const [potentialDuplicates, setPotentialDuplicates] = useState<PotentialDuplicate[]>([]);
  const [isLoadingDuplicates, setIsLoadingDuplicates] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [processingDupId, setProcessingDupId] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/stats', { credentials: 'include' });
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  const fetchEnrichmentStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/enrich-status', { credentials: 'include' });
      const data = await response.json();
      setEnrichmentStatus(data);
    } catch (error) {
      console.error('Failed to fetch enrichment status:', error);
    }
  }, []);

  const fetchIngestionSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/ingestion-settings', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setIngestionSettings(data);
        if (data.defaultLimit) {
          setIngestLimit(String(data.defaultLimit));
        }
      }
    } catch (error) {
      console.error('Failed to fetch ingestion settings:', error);
    }
  }, []);

  const fetchPotentialDuplicates = useCallback(async () => {
    setIsLoadingDuplicates(true);
    try {
      const response = await fetch('/api/admin/potential-duplicates?status=pending', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setPotentialDuplicates(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch potential duplicates:', error);
    } finally {
      setIsLoadingDuplicates(false);
    }
  }, []);

  const handleDuplicateAction = async (flagId: string, action: 'merge' | 'dismiss', keepContactId?: string) => {
    setProcessingDupId(flagId);
    try {
      const response = await fetch('/api/admin/potential-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ flagId, action, keepContactId }),
      });
      const data = await response.json();
      if (data.success) {
        toast({
          title: action === 'merge' ? 'Contacts Merged' : 'Duplicate Dismissed',
          description: action === 'merge' ? 'Contacts have been merged successfully.' : 'This pair has been dismissed.',
        });
        fetchPotentialDuplicates();
        fetchStats();
      } else {
        toast({ title: 'Error', description: data.error || 'Action failed', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to process action', variant: 'destructive' });
    } finally {
      setProcessingDupId(null);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchEnrichmentStatus();
    fetchIngestionSettings();
  }, [fetchStats, fetchEnrichmentStatus, fetchIngestionSettings]);

  useEffect(() => {
    // Always poll for enrichment status: 2s when running, 10s when idle
    const pollInterval = enrichmentStatus?.isRunning ? 2000 : 10000;
    const interval = setInterval(fetchEnrichmentStatus, pollInterval);
    return () => clearInterval(interval);
  }, [enrichmentStatus?.isRunning, fetchEnrichmentStatus]);

  useEffect(() => {
    // Listen for visibility changes and refetch immediately when tab gets focus
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchEnrichmentStatus();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchEnrichmentStatus]);

  const handleIngest = async () => {
    setIsIngesting(true);
    setIngestionResult(null);
    try {
      const response = await fetch('/api/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          limit: parseInt(ingestLimit) || 1000,
          offset: parseInt(ingestOffset) || 0,
        }),
      });
      const data = await response.json();
      setIngestionResult(data);
      if (data.success) {
        fetchStats();
      }
    } catch (error) {
      setIngestionResult({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to ingest',
      });
    } finally {
      setIsIngesting(false);
    }
  };

  const handleCancelBatch = async () => {
    try {
      const response = await fetch('/api/admin/enrich-batch', {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json();
      toast({
        title: data.cancelled ? 'Batch Cancelled' : 'No Running Batch',
        description: data.message,
        variant: data.cancelled ? 'default' : 'destructive',
      });
      fetchEnrichmentStatus();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to cancel batch', variant: 'destructive' });
    }
  };

  const handleStartEnrichment = async () => {
    setIsStartingEnrichment(true);
    try {
      const response = await fetch('/api/admin/enrich-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          limit: parseInt(enrichLimit) || 50,
        }),
      });
      const data = await response.json();
      if (data.success) {
        fetchEnrichmentStatus();
        toast({
          title: 'Batch Enrichment Started',
          description: `Starting enrichment for up to ${parseInt(enrichLimit) || 50} properties...`,
        });
      } else {
        // Handle rate limit errors specially
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
          toast({
            title: 'Rate Limit Exceeded',
            description: `You've hit the rate limit for batch enrichment. Please wait about ${retrySeconds} seconds before trying again.`,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Failed to Start Enrichment',
            description: data.error || 'An error occurred while starting the enrichment batch.',
            variant: 'destructive',
          });
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start enrichment',
        variant: 'destructive',
      });
    } finally {
      setIsStartingEnrichment(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600 mt-1">Manage data ingestion and enrichment</p>
          <div className="flex items-center gap-4 mt-2">
            <a href="/admin/costs" className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-900" data-testid="link-enrichment-costs">
              View Enrichment Costs →
            </a>
            <a href="/admin/vertex-logs" className="inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-900" data-testid="link-vertex-logs">
              Vertex AI Debug Log →
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <StatCard
            label="Total Properties"
            value={stats?.totalProperties}
            isLoading={isLoadingStats}
            color="blue"
          />
          <StatCard
            label="Parent Properties"
            value={stats?.parentProperties}
            isLoading={isLoadingStats}
            color="purple"
          />
          <StatCard
            label="Enriched"
            value={stats?.enrichedProperties}
            isLoading={isLoadingStats}
            color="green"
          />
          <StatCard
            label="Pending Enrichment"
            value={stats?.pendingProperties}
            isLoading={isLoadingStats}
            color="yellow"
          />
          <StatCard
            label="Total Contacts"
            value={stats?.totalContacts}
            isLoading={isLoadingStats}
            color="blue"
          />
          <StatCard
            label="Validated Emails"
            value={stats?.validatedEmails}
            isLoading={isLoadingStats}
            color="teal"
          />
        </div>

        <DataSourcesSection />

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <button
            onClick={() => {
              setShowDuplicates(!showDuplicates);
              if (!showDuplicates && potentialDuplicates.length === 0) {
                fetchPotentialDuplicates();
              }
            }}
            className="w-full flex items-center justify-between"
            data-testid="button-toggle-duplicates"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-semibold text-gray-900">Potential Duplicates</h2>
              {potentialDuplicates.length > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
                  {potentialDuplicates.length}
                </span>
              )}
            </div>
            {showDuplicates ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </button>

          {showDuplicates && (
            <div className="mt-4">
              <p className="text-sm text-gray-600 mb-4">
                These contacts share the same name and company domain/employer but were not auto-merged. Review and merge or dismiss each pair.
              </p>

              {isLoadingDuplicates ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="animate-spin h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              ) : potentialDuplicates.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Check className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  <p className="text-sm">No potential duplicates to review</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {potentialDuplicates.map((dup) => (
                    <DuplicateCard
                      key={dup.id}
                      duplicate={dup}
                      isProcessing={processingDupId === dup.id}
                      onMerge={(keepId) => handleDuplicateAction(dup.id, 'merge', keepId)}
                      onDismiss={() => handleDuplicateAction(dup.id, 'dismiss')}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Ingestion</h2>
            <p className="text-sm text-gray-600 mb-4">
              Import properties from Snowflake database
            </p>

            {ingestionSettings && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm text-gray-600 space-y-0.5">
                <p><strong>Scope:</strong> {ingestionSettings.allZips ? 'All ZIP codes (county-wide)' : `Specific ZIPs: ${ingestionSettings.zipCodes.join(', ')}`}</p>
                {ingestionSettings.filters && (ingestionSettings.filters.lotSqftMin || ingestionSettings.filters.lotSqftMax || ingestionSettings.filters.buildingSqftMin || ingestionSettings.filters.buildingSqftMax || ingestionSettings.filters.buildingClassCodes?.length > 0 || ingestionSettings.filters.conditionGrades?.length > 0) && (
                  <p className="text-xs text-gray-500">
                    <strong>Filters:</strong>{' '}
                    {[
                      ingestionSettings.filters.lotSqftMin || ingestionSettings.filters.lotSqftMax ? `Lot ${ingestionSettings.filters.lotSqftMin ? `≥${Number(ingestionSettings.filters.lotSqftMin).toLocaleString()}` : ''}${ingestionSettings.filters.lotSqftMin && ingestionSettings.filters.lotSqftMax ? '–' : ''}${ingestionSettings.filters.lotSqftMax ? `≤${Number(ingestionSettings.filters.lotSqftMax).toLocaleString()}` : ''} sqft` : '',
                      ingestionSettings.filters.buildingSqftMin || ingestionSettings.filters.buildingSqftMax ? `Bldg ${ingestionSettings.filters.buildingSqftMin ? `≥${Number(ingestionSettings.filters.buildingSqftMin).toLocaleString()}` : ''}${ingestionSettings.filters.buildingSqftMin && ingestionSettings.filters.buildingSqftMax ? '–' : ''}${ingestionSettings.filters.buildingSqftMax ? `≤${Number(ingestionSettings.filters.buildingSqftMax).toLocaleString()}` : ''} sqft` : '',
                      ingestionSettings.filters.buildingClassCodes?.length > 0 ? `Class ${ingestionSettings.filters.buildingClassCodes.join(',')}` : '',
                      ingestionSettings.filters.conditionGrades?.length > 0 ? `Condition: ${ingestionSettings.filters.conditionGrades.join(', ')}` : '',
                    ].filter(Boolean).join(' | ')}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">Change in Database {'>'} Ingestion Settings</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Limit
                </label>
                <input
                  type="number"
                  value={ingestLimit}
                  onChange={(e) => setIngestLimit(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  min="1"
                  max="100000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Offset
                </label>
                <input
                  type="number"
                  value={ingestOffset}
                  onChange={(e) => setIngestOffset(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  min="0"
                />
              </div>
            </div>

            <button
              onClick={handleIngest}
              disabled={isIngesting}
              className="w-full px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isIngesting ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Ingesting...
                </span>
              ) : (
                'Start Ingestion'
              )}
            </button>

            {ingestionResult && (
              <div className={`mt-4 p-4 rounded-lg ${ingestionResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                {ingestionResult.success ? (
                  <div>
                    <p className="text-sm font-medium text-green-800">Ingestion Complete</p>
                    <div className="mt-2 text-sm text-green-700">
                      <p>Created: {ingestionResult.stats?.created}</p>
                      <p>Updated: {ingestionResult.stats?.updated}</p>
                      <p>Errors: {ingestionResult.stats?.errors}</p>
                      <p>Total Processed: {ingestionResult.stats?.total}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-red-800">{ingestionResult.error}</p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Batch Enrichment</h2>
            <p className="text-sm text-gray-600 mb-2">
              Enrich properties with AI-powered data extraction
            </p>
            <div className="text-xs text-gray-500 mb-4 space-y-1">
              {stats && (
                <p>
                  <span className="font-medium">{stats.parentProperties?.toLocaleString()}</span> parent properties available to enrich
                  <span className="text-gray-400 ml-1">({stats.totalProperties?.toLocaleString()} total incl. constituents)</span>
                </p>
              )}
              {enrichmentStatus && (
                <p>Max batch size: {enrichmentStatus.maxBatchSize}</p>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Properties to Enrich
              </label>
              <input
                type="number"
                value={enrichLimit}
                onChange={(e) => setEnrichLimit(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                min="1"
                max={enrichmentStatus?.maxBatchSize || 100}
              />
            </div>

            <p className="text-xs text-gray-500 mb-4">Already-enriched properties are automatically skipped.</p>

            <div className="flex gap-2">
              <button
                onClick={handleStartEnrichment}
                disabled={isStartingEnrichment || enrichmentStatus?.isRunning}
                className="flex-1 px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                data-testid="button-start-enrichment"
              >
                {isStartingEnrichment ? 'Starting...' : enrichmentStatus?.isRunning ? 'Batch Running...' : 'Start Enrichment'}
              </button>
              {enrichmentStatus?.isRunning && (
                <button
                  onClick={handleCancelBatch}
                  className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
                  data-testid="button-cancel-batch"
                >
                  Cancel
                </button>
              )}
            </div>

            {enrichmentStatus && (enrichmentStatus.isRunning || enrichmentStatus.status !== 'idle') && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Status</span>
                  <span className={`text-sm px-2 py-0.5 rounded ${
                    enrichmentStatus.status === 'completed' ? 'bg-green-100 text-green-800' :
                    enrichmentStatus.status === 'running' ? 'bg-blue-100 text-blue-800' :
                    enrichmentStatus.status === 'failed' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {enrichmentStatus.status}
                  </span>
                </div>

                {enrichmentStatus.progress && (
                  <>
                    <div className="mb-2">
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>Progress</span>
                        <span>{enrichmentStatus.percentComplete}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-green-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${enrichmentStatus.percentComplete || 0}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-600">Processed:</span>{' '}
                        <span className="font-medium">{enrichmentStatus.progress.processed}/{enrichmentStatus.progress.total}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Succeeded:</span>{' '}
                        <span className="font-medium text-green-600">{enrichmentStatus.progress.succeeded}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Failed:</span>{' '}
                        <span className="font-medium text-red-600">{enrichmentStatus.progress.failed}</span>
                      </div>
                      {enrichmentStatus.errorCount !== undefined && enrichmentStatus.errorCount > 0 && (
                        <div>
                          <span className="text-gray-600">Errors:</span>{' '}
                          <span className="font-medium text-red-600">{enrichmentStatus.errorCount}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {enrichmentStatus.startedAt && (
                  <p className="text-xs text-gray-500 mt-2">
                    Started: {new Date(enrichmentStatus.startedAt).toLocaleString()}
                  </p>
                )}
                {enrichmentStatus.completedAt && (
                  <p className="text-xs text-gray-500">
                    Completed: {new Date(enrichmentStatus.completedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  isLoading, 
  color 
}: { 
  label: string; 
  value?: number; 
  isLoading: boolean; 
  color: 'blue' | 'green' | 'yellow' | 'purple' | 'teal';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    teal: 'bg-teal-50 border-teal-200 text-teal-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      {isLoading ? (
        <div className="h-8 flex items-center">
          <div className="animate-pulse bg-current opacity-20 h-6 w-16 rounded"></div>
        </div>
      ) : (
        <p className="text-2xl font-bold">{value?.toLocaleString() ?? 0}</p>
      )}
    </div>
  );
}

function ContactSummary({ contact, label }: { contact: PotentialDuplicateContact; label: string }) {
  return (
    <div className="flex-1 bg-gray-50 rounded-lg p-3" data-testid={`contact-summary-${contact.id}`}>
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{contact.fullName}</p>
      {contact.title && <p className="text-xs text-gray-600">{contact.title}</p>}
      {contact.employerName && <p className="text-xs text-gray-600">{contact.employerName}</p>}
      {contact.companyDomain && <p className="text-xs text-gray-500">{contact.companyDomain}</p>}
      {contact.email && (
        <p className="text-xs text-gray-600 mt-1">
          {contact.email}
          {contact.emailValidationStatus && (
            <span className={`ml-1 px-1 py-0.5 rounded text-[10px] ${
              contact.emailValidationStatus === 'valid' ? 'bg-green-100 text-green-700' :
              contact.emailValidationStatus === 'invalid' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {contact.emailValidationStatus}
            </span>
          )}
        </p>
      )}
      {contact.phone && <p className="text-xs text-gray-600">{contact.phone}</p>}
      {contact.source && <p className="text-[10px] text-gray-400 mt-1">Source: {contact.source}</p>}
    </div>
  );
}

function DuplicateCard({
  duplicate,
  isProcessing,
  onMerge,
  onDismiss,
}: {
  duplicate: PotentialDuplicate;
  isProcessing: boolean;
  onMerge: (keepId: string) => void;
  onDismiss: () => void;
}) {
  if (!duplicate.contactA || !duplicate.contactB) return null;

  const matchLabel = duplicate.matchType === 'name_domain' ? 'Name + Domain' : 'Name + Employer';

  return (
    <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-4" data-testid={`duplicate-card-${duplicate.id}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">
            {matchLabel}
          </span>
          <span className="text-xs text-gray-500">
            {new Date(duplicate.createdAt).toLocaleDateString()}
          </span>
        </div>
        <button
          onClick={onDismiss}
          disabled={isProcessing}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:opacity-50"
          data-testid={`button-dismiss-${duplicate.id}`}
        >
          <X className="w-3 h-3" />
          Dismiss
        </button>
      </div>

      <div className="flex gap-3 mb-3">
        <ContactSummary contact={duplicate.contactA} label="Contact A" />
        <div className="flex items-center">
          <Merge className="w-4 h-4 text-gray-400" />
        </div>
        <ContactSummary contact={duplicate.contactB} label="Contact B" />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onMerge(duplicate.contactIdA)}
          disabled={isProcessing}
          className="flex-1 text-xs px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          data-testid={`button-keep-a-${duplicate.id}`}
        >
          {isProcessing ? 'Processing...' : `Keep "${duplicate.contactA.fullName}"`}
        </button>
        <button
          onClick={() => onMerge(duplicate.contactIdB)}
          disabled={isProcessing}
          className="flex-1 text-xs px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          data-testid={`button-keep-b-${duplicate.id}`}
        >
          {isProcessing ? 'Processing...' : `Keep "${duplicate.contactB.fullName}"`}
        </button>
      </div>
    </div>
  );
}

interface CadDownloadRecord {
  id: string;
  countyCode: string;
  appraisalYear: number;
  status: string;
  rowsImported: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

const COUNTIES = [
  { code: 'DCAD', name: 'Dallas' },
  { code: 'TAD', name: 'Tarrant' },
  { code: 'CCAD', name: 'Collin' },
  { code: 'DENT', name: 'Denton' },
] as const;

function DataSourcesSection() {
  const { toast } = useToast();
  const [downloads, setDownloads] = useState<CadDownloadRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingCounty, setDownloadingCounty] = useState<string | null>(null);

  const fetchDownloads = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/cad-download', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setDownloads(data.downloads || []);
      }
    } catch (error) {
      console.error('Failed to fetch CAD downloads:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDownloads();
    const interval = setInterval(fetchDownloads, 5000);
    return () => clearInterval(interval);
  }, [fetchDownloads]);

  const handleDownload = async (countyCode: string) => {
    setDownloadingCounty(countyCode);
    try {
      const response = await fetch('/api/admin/cad-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ countyCode, year: 2025 }),
      });
      const data = await response.json();
      if (data.downloadId) {
        toast({ title: 'Download Started', description: `Downloading ${countyCode} data...` });
        fetchDownloads();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to start download', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to start download', variant: 'destructive' });
    } finally {
      setDownloadingCounty(null);
    }
  };

  const getLatestDownload = (countyCode: string) => {
    return downloads.find(d => d.countyCode === countyCode);
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    downloading: 'bg-blue-100 text-blue-700',
    parsing: 'bg-yellow-100 text-yellow-700',
    complete: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Sources (CAD Downloads)</h2>
      <p className="text-sm text-gray-600 mb-4">
        Download and stage property data from Texas Central Appraisal Districts.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {COUNTIES.map(county => {
          const latest = getLatestDownload(county.code);
          const isActive = latest && (latest.status === 'downloading' || latest.status === 'parsing');

          return (
            <div key={county.code} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900">{county.name} ({county.code})</h3>
                {latest && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[latest.status] || 'bg-gray-100 text-gray-700'}`}>
                    {latest.status}
                  </span>
                )}
              </div>

              {latest ? (
                <div className="text-xs text-gray-500 space-y-1 mb-3">
                  {latest.rowsImported != null && latest.rowsImported > 0 && (
                    <p>{latest.rowsImported.toLocaleString()} rows imported</p>
                  )}
                  {latest.completedAt && (
                    <p>Last: {new Date(latest.completedAt).toLocaleDateString()}</p>
                  )}
                  {latest.errorMessage && (
                    <p className="text-red-600 truncate" title={latest.errorMessage}>{latest.errorMessage}</p>
                  )}
                  {isActive && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                      <div className="bg-blue-500 h-1.5 rounded-full animate-pulse" style={{ width: latest.status === 'downloading' ? '30%' : '70%' }}></div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-3">No data downloaded yet</p>
              )}

              <button
                onClick={() => handleDownload(county.code)}
                disabled={!!isActive || downloadingCounty === county.code}
                className="w-full text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {downloadingCounty === county.code ? 'Starting...' : isActive ? 'In Progress...' : 'Download Latest'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
