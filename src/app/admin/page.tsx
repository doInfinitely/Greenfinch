'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

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

export default function AdminPage() {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const [ingestLimit, setIngestLimit] = useState('1000');
  const [ingestOffset, setIngestOffset] = useState('0');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionResult, setIngestionResult] = useState<IngestionResult | null>(null);

  const [enrichLimit, setEnrichLimit] = useState('50');
  const [onlyUnenriched, setOnlyUnenriched] = useState(true);
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatus | null>(null);
  const [isStartingEnrichment, setIsStartingEnrichment] = useState(false);

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
      console.log('[Admin] Enrichment status:', data);
      setEnrichmentStatus(data);
    } catch (error) {
      console.error('Failed to fetch enrichment status:', error);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchEnrichmentStatus();
  }, [fetchStats, fetchEnrichmentStatus]);

  useEffect(() => {
    if (enrichmentStatus?.isRunning) {
      const interval = setInterval(fetchEnrichmentStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [enrichmentStatus?.isRunning, fetchEnrichmentStatus]);

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

  const handleStartEnrichment = async () => {
    setIsStartingEnrichment(true);
    try {
      const response = await fetch('/api/admin/enrich-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          limit: parseInt(enrichLimit) || 50,
          onlyUnenriched,
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Ingestion</h2>
            <p className="text-sm text-gray-600 mb-4">
              Import properties from Snowflake database
            </p>

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
                  max="10000"
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

            <div className="mb-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={onlyUnenriched}
                  onChange={(e) => setOnlyUnenriched(e.target.checked)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <span className="ml-2 text-sm text-gray-700">Only unenriched properties</span>
              </label>
            </div>

            <button
              onClick={handleStartEnrichment}
              disabled={isStartingEnrichment || enrichmentStatus?.isRunning}
              className="w-full px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isStartingEnrichment ? 'Starting...' : enrichmentStatus?.isRunning ? 'Batch Running...' : 'Start Enrichment'}
            </button>

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
