'use client';

import { useState } from 'react';
import { X, Search, Check } from 'lucide-react';

interface FlagDialogProps {
  flagType: 'management_company' | 'owner' | 'property_info' | 'other';
  propertyKey: string;
  onClose: () => void;
}

export default function FlagDialog({ flagType, propertyKey, onClose }: FlagDialogProps) {
  const [flagSearchQuery, setFlagSearchQuery] = useState('');
  const [flagSearchResults, setFlagSearchResults] = useState<Array<{id: string; name: string; domain: string | null}>>([]);
  const [selectedFlagOrg, setSelectedFlagOrg] = useState<{id: string; name: string} | null>(null);
  const [flagComments, setFlagComments] = useState('');
  const [isSubmittingFlag, setIsSubmittingFlag] = useState(false);
  const [flagMessage, setFlagMessage] = useState<string | null>(null);

  const handleFlagSearch = async (query: string) => {
    setFlagSearchQuery(query);
    if (query.length < 2) {
      setFlagSearchResults([]);
      return;
    }
    
    try {
      const response = await fetch(`/api/organizations/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setFlagSearchResults(data.organizations || []);
    } catch (err) {
      console.error('Organization search error:', err);
    }
  };

  const handleSubmitFlag = async () => {
    setIsSubmittingFlag(true);
    setFlagMessage(null);
    
    try {
      const response = await fetch(`/api/properties/${propertyKey}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flagType,
          suggestedOrganizationId: selectedFlagOrg?.id || null,
          suggestedOrganizationName: selectedFlagOrg ? null : flagSearchQuery || null,
          comments: flagComments,
        }),
      });

      if (response.ok) {
        setFlagMessage('Thank you! Your feedback has been submitted for review.');
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setFlagMessage('Failed to submit feedback. Please try again.');
      }
    } catch (err) {
      setFlagMessage('Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmittingFlag(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose} />
        
        <div className="relative inline-block w-full max-w-lg p-6 my-8 text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Flag {flagType === 'management_company' ? 'Management Company' : flagType === 'owner' ? 'Owner' : 'Information'} as Incorrect
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              data-testid="button-close-flag-dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Suggest correct organization (optional)
              </label>
              <div className="relative">
                <div className="flex items-center">
                  <Search className="absolute left-3 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={selectedFlagOrg?.name || flagSearchQuery}
                    onChange={(e) => {
                      setSelectedFlagOrg(null);
                      handleFlagSearch(e.target.value);
                    }}
                    placeholder="Search organizations or type a new name..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                    data-testid="input-flag-search"
                  />
                </div>
                
                {flagSearchResults.length > 0 && !selectedFlagOrg && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {flagSearchResults.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => {
                          setSelectedFlagOrg({ id: org.id, name: org.name || '' });
                          setFlagSearchResults([]);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                        data-testid={`button-select-org-${org.id}`}
                      >
                        <span className="font-medium text-gray-900">{org.name}</span>
                        {org.domain && (
                          <span className="text-xs text-gray-500">{org.domain}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                
                {selectedFlagOrg && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 bg-green-100 text-green-800 text-sm rounded">
                      <Check className="w-3 h-3 mr-1" />
                      {selectedFlagOrg.name}
                    </span>
                    <button
                      onClick={() => setSelectedFlagOrg(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Search for an existing organization or type a new name
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Comments
              </label>
              <textarea
                value={flagComments}
                onChange={(e) => setFlagComments(e.target.value)}
                placeholder="Why do you believe this is incorrect?"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                data-testid="input-flag-comments"
              />
            </div>

            {flagMessage && (
              <div className={`p-3 rounded-md text-sm ${flagMessage.includes('Thank you') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {flagMessage}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                data-testid="button-cancel-flag"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitFlag}
                disabled={isSubmittingFlag}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50"
                data-testid="button-submit-flag"
              >
                {isSubmittingFlag ? 'Submitting...' : 'Submit Flag'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
