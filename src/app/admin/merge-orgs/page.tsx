'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowRightLeft, Merge, Building2, Globe, Users, MapPin, RefreshCw, Sparkles, Search, ChevronDown, ChevronUp } from 'lucide-react';

interface OrgSummary {
  id: string;
  name: string | null;
  domain: string | null;
  logoUrl: string | null;
  employees: number | null;
  city: string | null;
  state: string | null;
  propertyCount: number;
  contactCount: number;
}

interface MergeSuggestion {
  orgA: OrgSummary;
  orgB: OrgSummary;
  similarity: number;
  reason: string;
}

interface OrgSearchResult {
  id: string;
  name: string | null;
  domain: string | null;
  orgType: string | null;
}

function OrgCard({ org, compact }: { org: OrgSummary; compact?: boolean }) {
  return (
    <div className={`border rounded-lg bg-white space-y-1.5 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center flex-shrink-0">
          {org.logoUrl ? (
            <img src={org.logoUrl} alt="" className="w-6 h-6 object-contain rounded" />
          ) : (
            <Building2 className="h-4 w-4 text-blue-600" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate text-sm" data-testid={`text-org-name-${org.id}`}>{org.name || 'Unnamed'}</p>
          {org.domain && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Globe className="h-3 w-3" />{org.domain}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{org.propertyCount} properties</span>
        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{org.contactCount} contacts</span>
        {org.city && <span>{org.city}{org.state ? `, ${org.state}` : ''}</span>}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onMerge,
  merging,
}: {
  suggestion: MergeSuggestion;
  onMerge: (keepId: string, deleteId: string) => void;
  merging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [keepLeft, setKeepLeft] = useState(true);
  const keepOrg = keepLeft ? suggestion.orgA : suggestion.orgB;
  const deleteOrg = keepLeft ? suggestion.orgB : suggestion.orgA;

  return (
    <div className="border rounded-lg bg-white" data-testid={`suggestion-${suggestion.orgA.id}-${suggestion.orgB.id}`}>
      <button
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
        onClick={() => setExpanded(e => !e)}
        data-testid={`btn-expand-suggestion-${suggestion.orgA.id}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="min-w-0 flex-1">
            <span className="font-medium text-gray-900 text-sm">{suggestion.orgA.name}</span>
            {suggestion.orgA.domain && <span className="text-xs text-gray-400 ml-1.5">({suggestion.orgA.domain})</span>}
          </div>
          <ArrowRightLeft className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-gray-900 text-sm">{suggestion.orgB.name}</span>
            {suggestion.orgB.domain && <span className="text-xs text-gray-400 ml-1.5">({suggestion.orgB.domain})</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          <Badge variant="outline" className="text-xs">{Math.round(suggestion.similarity * 100)}% match</Badge>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t">
          <p className="text-xs text-gray-500 mt-3 mb-3">{suggestion.reason}</p>
          <div className="flex gap-4 items-start">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Badge variant={keepLeft ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">
                  {keepLeft ? 'KEEP' : 'DELETE'}
                </Badge>
              </div>
              <OrgCard org={suggestion.orgA} compact />
            </div>
            <div className="flex flex-col items-center gap-2 pt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => { e.stopPropagation(); setKeepLeft(k => !k); }}
                title="Swap direction"
                data-testid="btn-swap-org-direction"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700 text-white text-xs"
                onClick={(e) => { e.stopPropagation(); onMerge(keepOrg.id, deleteOrg.id); }}
                disabled={merging}
                data-testid="btn-merge-suggested"
              >
                <Merge className="h-3.5 w-3.5 mr-1" />Merge
              </Button>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Badge variant={keepLeft ? 'destructive' : 'default'} className="text-[10px] px-1.5 py-0">
                  {keepLeft ? 'DELETE' : 'KEEP'}
                </Badge>
              </div>
              <OrgCard org={suggestion.orgB} compact />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function useOrgSearch() {
  const [results, setResults] = useState<OrgSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/organizations/search?q=${encodeURIComponent(q)}&limit=10`);
      const json = await res.json();
      setResults(json.organizations ?? []);
    } finally {
      setLoading(false);
    }
  };

  return { results, loading, search, setResults };
}

function OrgSearchPanel({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: OrgSummary | null;
  onSelect: (o: OrgSummary) => void;
}) {
  const { results, loading, search, setResults } = useOrgSearch();
  const [query, setQuery] = useState('');

  const handleSelect = async (org: OrgSearchResult) => {
    onSelect({
      id: org.id,
      name: org.name,
      domain: org.domain,
      logoUrl: null,
      employees: null,
      city: null,
      state: null,
      propertyCount: 0,
      contactCount: 0,
    });
    setResults([]);
    setQuery(org.name || '');
  };

  return (
    <div className="flex-1 space-y-3">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <Input
        data-testid={`input-search-org-${label.toLowerCase().replace(/\s/g, '-')}`}
        placeholder="Search by name or domain..."
        value={query}
        onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
      />
      {loading && <p className="text-xs text-gray-400">Searching...</p>}
      {results.length > 0 && !selected && (
        <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
          {results.map((o) => (
            <button
              key={o.id}
              data-testid={`org-result-${o.id}`}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
              onClick={() => handleSelect(o)}
            >
              <span className="font-medium">{o.name}</span>
              {o.domain && <span className="text-gray-400 ml-2 text-xs">{o.domain}</span>}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="border rounded-lg p-3 bg-white space-y-1">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-600" />
            <span className="font-semibold text-sm text-gray-900">{selected.name}</span>
          </div>
          {selected.domain && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Globe className="h-3 w-3" />{selected.domain}
            </div>
          )}
          <button
            className="text-xs text-red-500 hover:underline mt-1"
            onClick={() => { onSelect(null as any); setQuery(''); }}
            data-testid="btn-clear-org-selection"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}

export default function MergeOrgsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<'suggestions' | 'manual'>('suggestions');
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [left, setLeft] = useState<OrgSummary | null>(null);
  const [right, setRight] = useState<OrgSummary | null>(null);
  const [swapped, setSwapped] = useState(false);

  const keep = swapped ? right : left;
  const mergeTarget = swapped ? left : right;

  const fetchSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    try {
      const res = await fetch('/api/admin/merge-orgs/suggestions?limit=50');
      const json = await res.json();
      if (json.success) {
        setSuggestions(json.data || []);
      }
    } catch (err) {
      toast({ title: 'Failed to load suggestions', variant: 'destructive' });
    } finally {
      setLoadingSuggestions(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const handleMerge = async (keepId: string, deleteId: string) => {
    try {
      const res = await fetch('/api/admin/merge-orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepOrgId: keepId, deleteOrgId: deleteId }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Organizations merged successfully', description: `${json.data.stats.propertyLinksReassigned} property links reassigned, ${json.data.stats.contactLinksReassigned} contact links reassigned` });
        setSuggestions(prev => prev.filter(s => s.orgA.id !== deleteId && s.orgB.id !== deleteId));
      } else {
        toast({ title: 'Merge failed', description: json.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Merge failed', variant: 'destructive' });
    }
  };

  const manualMergeMutation = useMutation({
    mutationFn: async () => {
      if (!keep || !mergeTarget) throw new Error('Select two organizations first');
      const res = await fetch('/api/admin/merge-orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepOrgId: keep.id, deleteOrgId: mergeTarget.id }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      return json;
    },
    onSuccess: () => {
      toast({ title: 'Organizations merged successfully' });
      setLeft(null);
      setRight(null);
      setSwapped(false);
    },
    onError: (err: Error) => {
      toast({ title: 'Merge failed', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900" data-testid="text-page-title">Merge Organizations</h1>
        <p className="text-sm text-gray-500 mt-1">Merge duplicate organizations. All property and contact links are safely reassigned to the kept organization.</p>
      </div>

      <div className="flex gap-2 mb-6">
        <Button
          variant={tab === 'suggestions' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('suggestions')}
          data-testid="btn-tab-suggestions"
        >
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />Suggested Merges
          {suggestions.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">{suggestions.length}</Badge>
          )}
        </Button>
        <Button
          variant={tab === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('manual')}
          data-testid="btn-tab-manual"
        >
          <Search className="h-3.5 w-3.5 mr-1.5" />Manual Merge
        </Button>
      </div>

      {tab === 'suggestions' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {loadingSuggestions ? 'Finding similar organizations...' : `${suggestions.length} suggested merge${suggestions.length !== 1 ? 's' : ''}`}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchSuggestions}
              disabled={loadingSuggestions}
              data-testid="btn-refresh-suggestions"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingSuggestions ? 'animate-spin' : ''}`} />Refresh
            </Button>
          </div>

          {suggestions.length === 0 && !loadingSuggestions && (
            <div className="text-center py-12 text-gray-400 text-sm">
              No suggested merges found. Organizations look clean!
            </div>
          )}

          {suggestions.map((s, idx) => (
            <SuggestionCard
              key={`${s.orgA.id}-${s.orgB.id}`}
              suggestion={s}
              onMerge={handleMerge}
              merging={false}
            />
          ))}
        </div>
      )}

      {tab === 'manual' && (
        <>
          <div className="flex gap-6 items-start">
            <OrgSearchPanel label="Left Organization" selected={left} onSelect={setLeft} />

            <div className="flex flex-col items-center gap-3 pt-8">
              <Button
                variant="outline"
                size="sm"
                data-testid="btn-swap-direction"
                onClick={() => setSwapped(s => !s)}
                title="Swap keep/merge direction"
              >
                <ArrowRightLeft className="h-4 w-4" />
              </Button>
              {keep && mergeTarget && (
                <Button
                  data-testid="btn-merge-orgs"
                  className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 h-auto"
                  onClick={() => manualMergeMutation.mutate()}
                  disabled={manualMergeMutation.isPending}
                >
                  <Merge className="h-3.5 w-3.5 mr-1" />Merge
                </Button>
              )}
            </div>

            <OrgSearchPanel label="Right Organization" selected={right} onSelect={setRight} />
          </div>

          {keep && mergeTarget && (
            <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <span className="font-semibold text-amber-800">Keep:</span>{' '}
              <span className="text-amber-700">{keep.name}</span>
              {keep.domain && <span className="text-amber-500 text-xs ml-1">({keep.domain})</span>}
              <span className="mx-3 text-amber-400">—</span>
              <span className="font-semibold text-amber-800">Delete:</span>{' '}
              <span className="text-amber-700">{mergeTarget.name}</span>
              {mergeTarget.domain && <span className="text-amber-500 text-xs ml-1">({mergeTarget.domain})</span>}
              <Badge
                variant="outline"
                className="ml-3 text-xs cursor-pointer border-amber-300 text-amber-700"
                onClick={() => setSwapped(s => !s)}
              >
                Swap direction
              </Badge>
            </div>
          )}
        </>
      )}
    </div>
  );
}
