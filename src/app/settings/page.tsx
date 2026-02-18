'use client';

import { useState, useEffect, useRef } from 'react';
import { Building2, Save, Check } from 'lucide-react';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '@/lib/schema';

interface UserSettings {
  companyName: string | null;
  companyDomain: string | null;
  selectedServices: string[];
  settingsCompleted: boolean;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [companyName, setCompanyName] = useState('');
  const [companyDomain, setCompanyDomain] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/user/settings');
      if (response.ok) {
        const data: UserSettings = await response.json();
        setCompanyName(data.companyName || '');
        setCompanyDomain(data.companyDomain || '');
        setSelectedServices(data.selectedServices || []);
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleServiceToggle = (service: string) => {
    setSelectedServices(prev => 
      prev.includes(service) 
        ? prev.filter(s => s !== service)
        : [...prev, service]
    );
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName || null,
          companyDomain: companyDomain || null,
          selectedServices,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Failed to save settings. Please try again.');
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h1 className="text-xl font-semibold text-gray-900">Account Settings</h1>
            <p className="text-sm text-gray-500 mt-1">
              Configure your company information and the services you provide
            </p>
          </div>

          <div className="p-6 space-y-8">
            <section>
              <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Building2 className="w-5 h-5 mr-2 text-gray-400" />
                Company Information
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    id="companyName"
                    value={companyName}
                    onChange={(e) => { setCompanyName(e.target.value); setSaved(false); }}
                    placeholder="Your Company Name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                    data-testid="input-company-name"
                  />
                </div>
                
                <div>
                  <label htmlFor="companyDomain" className="block text-sm font-medium text-gray-700 mb-1">
                    Company Domain
                  </label>
                  <input
                    type="text"
                    id="companyDomain"
                    value={companyDomain}
                    onChange={(e) => { setCompanyDomain(e.target.value); setSaved(false); }}
                    placeholder="yourcompany.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                    data-testid="input-company-domain"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Used to identify your company as a service provider
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-medium text-gray-900 mb-2">
                Services You Provide
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Select the facilities services your company offers. This helps us show relevant opportunities.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {SERVICE_CATEGORIES.map((service) => (
                  <label
                    key={service}
                    className={`
                      flex items-center p-3 border rounded-lg cursor-pointer transition-colors
                      ${selectedServices.includes(service) 
                        ? 'border-green-500 bg-green-50 text-green-700' 
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
                    `}
                    data-testid={`checkbox-service-${service}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedServices.includes(service)}
                      onChange={() => handleServiceToggle(service)}
                      className="sr-only"
                    />
                    <div className={`
                      w-5 h-5 rounded border-2 mr-3 flex items-center justify-center flex-shrink-0
                      ${selectedServices.includes(service) 
                        ? 'border-green-500 bg-green-500' 
                        : 'border-gray-300'}
                    `}>
                      {selectedServices.includes(service) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <span className="text-sm font-medium">
                      {SERVICE_CATEGORY_LABELS[service]}
                    </span>
                  </label>
                ))}
              </div>

              {selectedServices.length === 0 && (
                <p className="mt-3 text-sm text-amber-600">
                  Please select at least one service to help us show you relevant opportunities.
                </p>
              )}
            </section>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                onClick={handleSave}
                disabled={saving}
                className={`
                  flex items-center px-4 py-2 rounded-md font-medium transition-colors
                  ${saved 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-green-600 text-white hover:bg-green-700'}
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
                data-testid="button-save-settings"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Settings
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
