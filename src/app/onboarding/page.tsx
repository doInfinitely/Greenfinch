'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, MapPin } from 'lucide-react';
import ServiceSelector from '@/components/onboarding/ServiceSelector';
import { useOnboarding } from '@/contexts/OnboardingContext';

export default function OnboardingPage() {
  const router = useRouter();
  const { progress, settingsCompleted, dismiss } = useOnboarding();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 state
  const [companyName, setCompanyName] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  // Step 2 state
  const [zipInput, setZipInput] = useState('');
  const [zipCodes, setZipCodes] = useState<string[]>([]);

  // If already completed settings, skip to step 2 or redirect
  useEffect(() => {
    if (settingsCompleted && progress.territory) {
      router.replace('/dashboard/map');
    } else if (settingsCompleted || progress.services) {
      setStep(2);
    }
  }, [settingsCompleted, progress, router]);

  // Load existing settings
  useEffect(() => {
    fetch('/api/user/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          if (data.companyName) setCompanyName(data.companyName);
          if (data.selectedServices?.length) setSelectedServices(data.selectedServices);
        }
      })
      .catch(() => {});

    // Load territory zip codes
    fetch('/api/user/onboarding')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.territoryZipCodes?.length) {
          setZipCodes(data.territoryZipCodes);
        }
      })
      .catch(() => {});
  }, []);

  const handleServiceToggle = (service: string) => {
    setSelectedServices(prev =>
      prev.includes(service)
        ? prev.filter(s => s !== service)
        : [...prev, service]
    );
  };

  const handleStep1Continue = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName || null,
          companyDomain: null,
          selectedServices,
        }),
      });
      if (res.ok) {
        setStep(2);
      } else {
        console.error('Failed to save services: HTTP', res.status);
        setError('Failed to save your selections. Please try again.');
      }
    } catch (err) {
      console.error('Failed to save services:', err);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddZip = () => {
    const zip = zipInput.trim();
    if (zip && /^\d{5}$/.test(zip) && !zipCodes.includes(zip)) {
      setZipCodes(prev => [...prev, zip]);
      setZipInput('');
    }
  };

  const handleRemoveZip = (zip: string) => {
    setZipCodes(prev => prev.filter(z => z !== zip));
  };

  const handleZipKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddZip();
    }
  };

  const handleStep2Complete = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'territory', zipCodes }),
      });
      if (res.ok) {
        router.push('/dashboard/map');
      }
    } catch (err) {
      console.error('Failed to save territory:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    dismiss();
    router.push('/dashboard/map');
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Progress indicator */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {step === 1 ? 'Welcome to Greenfinch' : 'Set your territory'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Step {step} of 2
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-8 h-1 rounded-full ${step >= 1 ? 'bg-green-500' : 'bg-gray-200'}`} />
            <div className={`w-8 h-1 rounded-full ${step >= 2 ? 'bg-green-500' : 'bg-gray-200'}`} />
          </div>
        </div>
      </div>

      <div className="p-6">
        {step === 1 && (
          <div className="space-y-6">
            {error && (
              <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
                {error}
                <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
              </div>
            )}

            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-2">
                What services does your company provide?
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Select the facilities services your company offers. This helps us show relevant opportunities.
              </p>

              <ServiceSelector
                selectedServices={selectedServices}
                onToggle={handleServiceToggle}
              />

              {selectedServices.length === 0 && (
                <p className="mt-3 text-sm text-amber-600">
                  Please select at least one service to continue.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <button
                onClick={handleSkip}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Skip onboarding
              </button>
              <button
                onClick={handleStep1Continue}
                disabled={selectedServices.length === 0 || saving}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Continue'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-2 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-gray-400" />
                Where do you operate?
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Enter ZIP codes for the areas you serve. You can always update these later in settings.
              </p>

              {selectedServices.some(s => ['tree_trimming', 'irrigation', 'landscaping', 'pest_control'].includes(s)) && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
                  <p className="text-xs text-blue-700">
                    Tip: For outdoor services like landscaping and tree trimming, properties with larger lots will show higher revenue estimates. Consider targeting suburban ZIP codes with more commercial green space.
                  </p>
                </div>
              )}

              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={zipInput}
                  onChange={(e) => setZipInput(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  onKeyDown={handleZipKeyDown}
                  placeholder="Enter ZIP code"
                  className="w-40 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500"
                  maxLength={5}
                />
                <button
                  onClick={handleAddZip}
                  disabled={!zipInput || zipInput.length !== 5}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  Add
                </button>
              </div>

              {zipCodes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {zipCodes.map(zip => (
                    <span
                      key={zip}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full text-sm font-medium"
                    >
                      {zip}
                      <button
                        onClick={() => handleRemoveZip(zip)}
                        className="ml-1 text-green-500 hover:text-green-700"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {zipCodes.length === 0 && (
                <p className="text-sm text-gray-400">
                  No ZIP codes added yet. Add at least one to get started.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setStep(1)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Back
                </button>
                <button
                  onClick={handleSkip}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Skip onboarding
                </button>
              </div>
              <button
                onClick={handleStep2Complete}
                disabled={zipCodes.length === 0 || saving}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Explore Properties'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
