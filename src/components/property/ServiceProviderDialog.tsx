'use client';

import { useState } from 'react';
import { X, Search, Check } from 'lucide-react';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '@/lib/schema';

interface ServiceProviderDialogProps {
  propertyKey: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ServiceProviderDialog({ propertyKey, onClose, onSuccess }: ServiceProviderDialogProps) {
  const [selectedServiceCategory, setSelectedServiceCategory] = useState('');
  const [serviceProviderSearch, setServiceProviderSearch] = useState('');
  const [serviceProviderResults, setServiceProviderResults] = useState<Array<{id: string; name: string; domain: string | null}>>([]);
  const [selectedServiceProvider, setSelectedServiceProvider] = useState<{id: string; name: string} | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleServiceProviderSearch = async (query: string) => {
    setServiceProviderSearch(query);
    if (query.length < 2) {
      setServiceProviderResults([]);
      return;
    }
    
    try {
      const url = selectedServiceCategory 
        ? `/api/service-providers/search?q=${encodeURIComponent(query)}&category=${selectedServiceCategory}`
        : `/api/service-providers/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      const data = await response.json();
      setServiceProviderResults(data.providers || []);
    } catch (err) {
      console.error('Service provider search error:', err);
    }
  };

  const handleSubmit = async () => {
    if (!selectedServiceCategory || !selectedServiceProvider) return;
    
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/properties/${propertyKey}/service-providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceCategory: selectedServiceCategory,
          serviceProviderId: selectedServiceProvider.id,
        }),
      });

      if (response.ok) {
        onSuccess();
        onClose();
      }
    } catch (err) {
      console.error('Failed to add service provider:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose} />
        
        <div className="relative inline-block w-full max-w-lg p-6 my-8 text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Suggest a Service Provider
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              data-testid="button-close-service-provider-dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Service Category
              </label>
              <select
                value={selectedServiceCategory}
                onChange={(e) => setSelectedServiceCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                data-testid="select-service-category"
              >
                <option value="">Select a service category...</option>
                {SERVICE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {SERVICE_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Service Provider
              </label>
              <div className="relative">
                <div className="flex items-center">
                  <Search className="absolute left-3 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={selectedServiceProvider?.name || serviceProviderSearch}
                    onChange={(e) => {
                      setSelectedServiceProvider(null);
                      handleServiceProviderSearch(e.target.value);
                    }}
                    placeholder="Search for a service provider..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                    data-testid="input-service-provider-search"
                  />
                </div>
                
                {serviceProviderResults.length > 0 && !selectedServiceProvider && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {serviceProviderResults.map((provider) => (
                      <button
                        key={provider.id}
                        onClick={() => {
                          setSelectedServiceProvider({ id: provider.id, name: provider.name });
                          setServiceProviderResults([]);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                        data-testid={`button-select-provider-${provider.id}`}
                      >
                        <span className="font-medium text-gray-900">{provider.name}</span>
                        {provider.domain && (
                          <span className="text-xs text-gray-500">{provider.domain}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                
                {selectedServiceProvider && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 bg-green-100 text-green-800 text-sm rounded">
                      <Check className="w-3 h-3 mr-1" />
                      {selectedServiceProvider.name}
                    </span>
                    <button
                      onClick={() => setSelectedServiceProvider(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                data-testid="button-cancel-service-provider"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !selectedServiceCategory || !selectedServiceProvider}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
                data-testid="button-submit-service-provider"
              >
                {isSubmitting ? 'Adding...' : 'Add Provider'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
