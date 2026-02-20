'use client';

import { useState, useEffect } from 'react';
import { Clock, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';

interface VersionChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

interface Version {
  id: string;
  version: number;
  changes: VersionChange[] | null;
  changeType: string;
  triggeredBy: string | null;
  createdAt: string;
}

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  title: 'Title',
  employerName: 'Employer',
  companyDomain: 'Company Domain',
  linkedinUrl: 'LinkedIn',
  location: 'Location',
  photoUrl: 'Photo',
  emailValidationStatus: 'Email Status',
};

export default function ContactVersionHistory({ contactId }: { contactId: string }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasUnseenUpdate, setHasUnseenUpdate] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    
    const fetchVersions = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/contacts/${contactId}/versions`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setVersions(data.data?.versions || []);
          setHasUnseenUpdate(data.data?.hasUnseenUpdate || false);
        }
      } catch (err) {
        console.error('Failed to fetch versions:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVersions();
  }, [contactId]);

  if (versions.length === 0 && !isLoading) return null;

  const handleMarkSeen = async () => {
    if (!hasUnseenUpdate || versions.length === 0) return;
    const latestVersion = versions[0]?.version;
    if (!latestVersion) return;

    try {
      await fetch(`/api/contacts/${contactId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ version: latestVersion }),
      });
      setHasUnseenUpdate(false);
    } catch (err) {
      console.error('Failed to update version:', err);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="contact-version-history">
      <button
        onClick={() => {
          setIsExpanded(!isExpanded);
          if (hasUnseenUpdate && !isExpanded) {
            handleMarkSeen();
          }
        }}
        className="w-full flex items-center justify-between"
        data-testid="button-toggle-version-history"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-medium text-gray-500">Version History</h3>
          {hasUnseenUpdate && (
            <span className="w-2 h-2 bg-blue-500 rounded-full" title="New updates available" />
          )}
          <span className="text-xs text-gray-400">({versions.length})</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-3" data-testid="version-history-list">
          {isLoading ? (
            <div className="text-center py-4 text-sm text-gray-400">Loading...</div>
          ) : (
            versions.map((v) => (
              <div key={v.id} className="border-l-2 border-gray-200 pl-3 py-1">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">v{v.version}</span>
                  <span className="capitalize">{v.changeType.replace(/-/g, ' ')}</span>
                  <span>{new Date(v.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
                {v.changes && v.changes.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {v.changes.map((change, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs">
                        <span className="text-gray-500 font-medium">{FIELD_LABELS[change.field] || change.field}:</span>
                        {change.oldValue && (
                          <>
                            <span className="text-red-500 line-through truncate max-w-[100px]">{change.oldValue}</span>
                            <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          </>
                        )}
                        <span className="text-green-600 truncate max-w-[120px]">{change.newValue || '(removed)'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
