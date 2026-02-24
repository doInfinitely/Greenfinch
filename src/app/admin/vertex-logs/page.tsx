'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, Trash2, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Clock, Search, Cpu, DollarSign, Braces } from 'lucide-react';
import Link from 'next/link';

interface TokenUsage {
  promptTokens: number;
  responseTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  searchGroundingUsed?: boolean;
  searchGroundingCostUsd?: number;
}

interface DebugEntry {
  id: number;
  timestamp: number;
  stageName: string;
  durationMs: number;
  error: boolean;
  errorMessage?: string;
  request: {
    model: string;
    prompt: string;
    temperature: number;
    thinkingLevel?: string;
    tools?: any;
    toolConfig?: any;
    latLng?: { latitude: number; longitude: number };
  };
  response: {
    text: string;
    finishReason?: string;
    rawUsageMetadata: any | null;
    parsedTokenUsage: TokenUsage | null;
    computedCostUsd: number;
    groundingMetadata: any | null;
    candidateCount: number;
    searchGroundingUsed?: boolean;
  };
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function JsonBlock({ data, label }: { data: any; label: string }) {
  const [collapsed, setCollapsed] = useState(true);
  if (data === null || data === undefined) {
    return (
      <div className="text-xs text-gray-400 italic">{label}: null</div>
    );
  }
  const json = JSON.stringify(data, null, 2);
  const lines = json.split('\n').length;
  return (
    <div className="mt-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
        data-testid={`toggle-json-${label.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {label} ({lines} lines)
      </button>
      {!collapsed && (
        <pre className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-xs overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-all font-mono">
          {json}
        </pre>
      )}
    </div>
  );
}

function PromptBlock({ prompt }: { prompt: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const lines = prompt.split('\n').length;
  const charCount = prompt.length;
  return (
    <div className="mt-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
        data-testid="toggle-prompt"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Prompt ({lines} lines, {charCount.toLocaleString()} chars)
      </button>
      {!collapsed && (
        <pre className="mt-1 p-2 bg-blue-50 border border-blue-200 rounded text-xs overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-mono">
          {prompt}
        </pre>
      )}
    </div>
  );
}

function ResponseTextBlock({ text }: { text: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const charCount = text.length;
  return (
    <div className="mt-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
        data-testid="toggle-response-text"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Response Text ({charCount.toLocaleString()} chars)
      </button>
      {!collapsed && (
        <pre className="mt-1 p-2 bg-green-50 border border-green-200 rounded text-xs overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-mono">
          {text}
        </pre>
      )}
    </div>
  );
}

function TokenBreakdownTable({ raw, parsed, cost }: { raw: any; parsed: TokenUsage | null; cost: number }) {
  if (!raw && !parsed) {
    return <div className="text-xs text-red-500 font-medium mt-1">No token usage metadata captured</div>;
  }

  const rawFields = raw ? Object.entries(raw) : [];
  const hasToolUse = raw?.toolUsePromptTokenCount != null && raw.toolUsePromptTokenCount > 0;
  const hasCached = raw?.cachedContentTokenCount != null && raw.cachedContentTokenCount > 0;

  return (
    <div className="mt-2 space-y-2">
      <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
        <Cpu className="w-3 h-3" />
        Token Breakdown
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">Raw usageMetadata (from Vertex AI)</div>
          <table className="w-full text-xs border-collapse" data-testid="table-raw-metadata">
            <tbody>
              {rawFields.map(([key, value]) => (
                <tr key={key} className={`border-b border-gray-100 ${
                  key === 'toolUsePromptTokenCount' ? 'bg-yellow-50 font-semibold' :
                  key === 'thoughtsTokenCount' ? 'bg-purple-50' :
                  ''
                }`}>
                  <td className="py-0.5 pr-2 text-gray-600 font-mono">{key}</td>
                  <td className="py-0.5 text-right font-mono">{typeof value === 'number' ? value.toLocaleString() : JSON.stringify(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">Parsed (our interpretation)</div>
          {parsed ? (
            <table className="w-full text-xs border-collapse" data-testid="table-parsed-tokens">
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-0.5 pr-2 text-gray-600">promptTokens</td>
                  <td className="py-0.5 text-right font-mono">{parsed.promptTokens.toLocaleString()}</td>
                  <td className="py-0.5 pl-2 text-gray-400 text-[10px]">
                    {hasToolUse && `(includes ${raw.toolUsePromptTokenCount.toLocaleString()} search grounding)`}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-0.5 pr-2 text-gray-600">responseTokens</td>
                  <td className="py-0.5 text-right font-mono">{parsed.responseTokens.toLocaleString()}</td>
                  <td className="py-0.5 pl-2 text-gray-400 text-[10px]">billed at output rate</td>
                </tr>
                <tr className="border-b border-gray-100 bg-purple-50">
                  <td className="py-0.5 pr-2 text-gray-600">thinkingTokens</td>
                  <td className="py-0.5 text-right font-mono">{parsed.thinkingTokens.toLocaleString()}</td>
                  <td className="py-0.5 pl-2 text-gray-400 text-[10px]">billed at output rate</td>
                </tr>
                <tr className="border-b border-gray-100 font-semibold">
                  <td className="py-0.5 pr-2 text-gray-600">totalTokens</td>
                  <td className="py-0.5 text-right font-mono">{parsed.totalTokens.toLocaleString()}</td>
                  <td className="py-0.5 pl-2 text-gray-400 text-[10px]">from API totalTokenCount</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-red-500">Failed to parse</div>
          )}
        </div>
      </div>

      {hasToolUse && (
        <div className="flex items-center gap-1 px-2 py-1 bg-yellow-100 border border-yellow-300 rounded text-xs" data-testid="search-grounding-badge">
          <Search className="w-3 h-3 text-yellow-700" />
          <span className="font-medium text-yellow-800">Search Grounding Tokens: {raw.toolUsePromptTokenCount.toLocaleString()}</span>
          <span className="text-yellow-600">(included in prompt token cost at input rate)</span>
        </div>
      )}

      {hasCached && (
        <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 border border-blue-300 rounded text-xs">
          <span className="font-medium text-blue-800">Cached Content Tokens: {raw.cachedContentTokenCount.toLocaleString()}</span>
        </div>
      )}

      <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs" data-testid="computed-cost-badge">
        <DollarSign className="w-3 h-3 text-gray-700" />
        <span className="font-medium text-gray-800">Computed Cost: ${cost.toFixed(6)}</span>
        <span className="text-gray-500 ml-2">(input: $0.50/1M, output: $3.00/1M)</span>
      </div>

      {parsed && raw && (
        (() => {
          const expectedTotal = (raw.promptTokenCount ?? 0) + (raw.toolUsePromptTokenCount ?? 0) + (raw.responseTokenCount ?? raw.candidatesTokenCount ?? 0) + (raw.thoughtsTokenCount ?? 0);
          const apiTotal = raw.totalTokenCount ?? 0;
          const mismatch = apiTotal > 0 && Math.abs(expectedTotal - apiTotal) > 1;
          if (mismatch) {
            return (
              <div className="flex items-center gap-1 px-2 py-1 bg-red-100 border border-red-300 rounded text-xs" data-testid="token-mismatch-warning">
                <AlertCircle className="w-3 h-3 text-red-700" />
                <span className="font-medium text-red-800">Token count mismatch!</span>
                <span className="text-red-600">Sum of parts ({expectedTotal.toLocaleString()}) ≠ totalTokenCount ({apiTotal.toLocaleString()}). Possible uncaptured token category.</span>
              </div>
            );
          }
          return null;
        })()
      )}
    </div>
  );
}

function DebugEntryRow({ entry }: { entry: DebugEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasGrounding = entry.response.groundingMetadata != null;
  const hasSearchQueries = hasGrounding && entry.response.groundingMetadata?.webSearchQueries?.length > 0;
  const searchQueryCount = hasSearchQueries ? entry.response.groundingMetadata.webSearchQueries.length : 0;
  const groundingChunkCount = hasGrounding ? (entry.response.groundingMetadata?.groundingChunks?.length ?? 0) : 0;
  const hasToolUse = entry.response.rawUsageMetadata?.toolUsePromptTokenCount > 0;

  return (
    <div className={`border rounded-lg overflow-hidden ${entry.error ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`} data-testid={`vertex-log-entry-${entry.id}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        data-testid={`toggle-entry-${entry.id}`}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}

        {entry.error
          ? <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          : <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
        }

        <span className="text-xs text-gray-400 font-mono flex-shrink-0 w-20">
          {formatDate(entry.timestamp)} {formatTime(entry.timestamp)}
        </span>

        <span className="text-sm font-semibold text-gray-800 flex-shrink-0 min-w-[180px]" data-testid={`stage-name-${entry.id}`}>
          {entry.stageName}
        </span>

        <span className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">
          <Clock className="w-3 h-3" />
          {(entry.durationMs / 1000).toFixed(1)}s
        </span>

        {entry.response.parsedTokenUsage && (
          <span className="text-xs text-gray-500 flex-shrink-0 font-mono">
            {entry.response.parsedTokenUsage.totalTokens.toLocaleString()} tok
          </span>
        )}

        {hasToolUse && (
          <span className="flex items-center gap-0.5 text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
            <Search className="w-3 h-3" />
            {entry.response.rawUsageMetadata.toolUsePromptTokenCount.toLocaleString()}
          </span>
        )}

        {hasSearchQueries && (
          <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded flex-shrink-0">
            {searchQueryCount} queries
          </span>
        )}

        {groundingChunkCount > 0 && (
          <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded flex-shrink-0">
            {groundingChunkCount} sources
          </span>
        )}

        <span className="text-xs text-gray-600 font-mono flex-shrink-0 ml-auto">
          ${entry.response.computedCostUsd.toFixed(6)}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
          <div className="grid grid-cols-3 gap-4 pt-3">
            <div>
              <div className="text-xs font-medium text-gray-500">Model</div>
              <div className="text-sm font-mono">{entry.request.model}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500">Temperature</div>
              <div className="text-sm font-mono">{entry.request.temperature}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500">Thinking Level</div>
              <div className="text-sm font-mono">{entry.request.thinkingLevel || 'none'}</div>
            </div>
          </div>

          {entry.request.latLng && (
            <div className="text-xs text-gray-500">
              Geo-bias: {entry.request.latLng.latitude.toFixed(4)}, {entry.request.latLng.longitude.toFixed(4)}
            </div>
          )}

          {entry.request.tools && (
            <div className="text-xs text-gray-500">
              Tools: {JSON.stringify(entry.request.tools)}
            </div>
          )}

          {entry.request.toolConfig && (
            <JsonBlock data={entry.request.toolConfig} label="Tool Config (sent to API)" />
          )}

          {entry.error && entry.errorMessage && (
            <div className="px-3 py-2 bg-red-100 border border-red-300 rounded text-xs text-red-800 font-mono">
              {entry.errorMessage}
            </div>
          )}

          {entry.response.finishReason && (
            <div className="text-xs text-gray-500">
              Finish Reason: <span className="font-mono font-medium">{entry.response.finishReason}</span>
            </div>
          )}

          <TokenBreakdownTable
            raw={entry.response.rawUsageMetadata}
            parsed={entry.response.parsedTokenUsage}
            cost={entry.response.computedCostUsd}
          />

          <PromptBlock prompt={entry.request.prompt} />
          <ResponseTextBlock text={entry.response.text} />

          <JsonBlock data={entry.response.rawUsageMetadata} label="Raw usageMetadata (full JSON)" />
          <JsonBlock data={entry.response.groundingMetadata} label="Grounding Metadata (full JSON)" />

          {hasSearchQueries && (
            <div className="mt-1">
              <div className="text-xs font-medium text-gray-600 flex items-center gap-1">
                <Search className="w-3 h-3" />
                Web Search Queries ({searchQueryCount})
              </div>
              <ul className="mt-1 space-y-0.5">
                {entry.response.groundingMetadata.webSearchQueries.map((q: string, i: number) => (
                  <li key={i} className="text-xs bg-blue-50 border border-blue-100 rounded px-2 py-1 font-mono">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VertexLogsPage() {
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [errorFilter, setErrorFilter] = useState<string>('all');

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/vertex-logs');
      const json = await res.json();
      if (json.success) {
        setEntries(json.data.entries);
        setCount(json.data.count);
      }
    } catch (err) {
      console.error('Failed to fetch vertex logs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleClear = async () => {
    try {
      await fetch('/api/admin/vertex-logs', { method: 'DELETE' });
      setEntries([]);
      setCount(0);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  const stageNames = [...new Set(entries.map(e => e.stageName))].sort();
  const filteredEntries = entries.filter(e => {
    if (stageFilter !== 'all' && e.stageName !== stageFilter) return false;
    if (errorFilter === 'errors' && !e.error) return false;
    if (errorFilter === 'success' && e.error) return false;
    return true;
  });

  const totalCost = filteredEntries.reduce((sum, e) => sum + e.response.computedCostUsd, 0);
  const totalTokens = filteredEntries.reduce((sum, e) => sum + (e.response.parsedTokenUsage?.totalTokens ?? 0), 0);
  const searchGroundingCount = filteredEntries.filter(e => e.response.searchGroundingUsed).length;
  const searchGroundingCost = filteredEntries.reduce((sum, e) => sum + (e.response.parsedTokenUsage?.searchGroundingCostUsd ?? 0), 0);
  const errorCount = filteredEntries.filter(e => e.error).length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/admin" data-testid="link-back-admin">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Admin
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2" data-testid="page-title">
              <Braces className="w-5 h-5" />
              Vertex AI Debug Log
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Full request/response payloads for every Gemini API call (last {count} calls in memory)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading} data-testid="button-refresh">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear} data-testid="button-clear">
            <Trash2 className="w-4 h-4 mr-1" />
            Clear Log
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4" data-testid="stat-total-calls">
          <div className="text-xs text-gray-500 font-medium">Total Calls</div>
          <div className="text-2xl font-bold text-gray-900">{filteredEntries.length}</div>
          {errorCount > 0 && <div className="text-xs text-red-600">{errorCount} errors</div>}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4" data-testid="stat-total-tokens">
          <div className="text-xs text-gray-500 font-medium">Total Tokens</div>
          <div className="text-2xl font-bold text-gray-900">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4" data-testid="stat-search-grounding">
          <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
            <Search className="w-3 h-3" />
            Search Grounding
          </div>
          <div className={`text-2xl font-bold ${searchGroundingCount > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>
            {searchGroundingCount} / {filteredEntries.length}
          </div>
          <div className="text-xs text-gray-500">${searchGroundingCost.toFixed(4)} grounding cost</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4" data-testid="stat-total-cost">
          <div className="text-xs text-gray-500 font-medium">Computed Cost</div>
          <div className="text-2xl font-bold text-gray-900">${totalCost.toFixed(4)}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">Stage:</label>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
            data-testid="filter-stage"
          >
            <option value="all">All Stages</option>
            {stageNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">Status:</label>
          <select
            value={errorFilter}
            onChange={(e) => setErrorFilter(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
            data-testid="filter-status"
          >
            <option value="all">All</option>
            <option value="success">Success Only</option>
            <option value="errors">Errors Only</option>
          </select>
        </div>
        <div className="text-xs text-gray-400 ml-auto">
          Showing {filteredEntries.length} of {count} entries
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading...
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400" data-testid="empty-state">
          <Braces className="w-10 h-10 mb-3" />
          <p className="text-sm">No Vertex AI calls recorded yet.</p>
          <p className="text-xs mt-1">Enrich a property to see request/response data here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEntries.map(entry => (
            <DebugEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
