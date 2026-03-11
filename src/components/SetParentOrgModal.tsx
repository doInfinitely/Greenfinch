'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Search, Building2, Loader2 } from 'lucide-react';

interface OrgSearchResult {
  id: string;
  name: string | null;
  domain: string | null;
  orgType: string | null;
}

interface SetParentOrgModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  currentParentOrgId: string | null;
  onSuccess: (updatedOrg: any) => void;
}

export default function SetParentOrgModal({
  isOpen,
  onClose,
  orgId,
  currentParentOrgId,
  onSuccess,
}: SetParentOrgModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<OrgSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setResults([]);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/organizations/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          // Filter out the current org
          setResults((data.organizations || []).filter((o: OrgSearchResult) => o.id !== orgId));
        }
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, orgId]);

  const handleLink = async (parentOrgId: string) => {
    setIsLinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/hierarchy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentOrgId, action: 'link' }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to link parent organization');
        return;
      }

      const data = await res.json();
      onSuccess(data.organization);
    } catch {
      setError('Failed to link parent organization');
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlink = async () => {
    setIsLinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/hierarchy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink' }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to unlink parent organization');
        return;
      }

      const data = await res.json();
      onSuccess(data.organization || {});
    } catch {
      setError('Failed to unlink parent organization');
    } finally {
      setIsLinking(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-gray-900">Set Parent Organization</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search organizations by name or domain..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}

          {currentParentOrgId && (
            <button
              onClick={handleUnlink}
              disabled={isLinking}
              className="mt-3 w-full text-xs text-red-600 hover:text-red-700 font-medium py-1.5 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {isLinking ? 'Removing...' : 'Remove current parent'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {isSearching && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          )}

          {!isSearching && results.length === 0 && searchQuery.length >= 2 && (
            <p className="text-xs text-gray-500 text-center py-4">No organizations found</p>
          )}

          {results.map((org) => (
            <button
              key={org.id}
              onClick={() => handleLink(org.id)}
              disabled={isLinking}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{org.name || 'Unnamed'}</p>
                {org.domain && (
                  <p className="text-xs text-gray-500 truncate">{org.domain}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
