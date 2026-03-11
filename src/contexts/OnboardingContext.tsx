'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { type OnboardingProgress, type OnboardingStep, isOnboardingComplete } from '@/lib/onboarding';

interface OnboardingContextType {
  progress: OnboardingProgress;
  loading: boolean;
  settingsCompleted: boolean;
  isComplete: boolean;
  dismissed: boolean;
  markStep: (step: OnboardingStep) => Promise<void>;
  dismiss: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const DISMISS_KEY = 'greenfinch-onboarding-dismissed';

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<OnboardingProgress>({});
  const [loading, setLoading] = useState(true);
  const [settingsCompleted, setSettingsCompleted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check localStorage for dismiss
    if (typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY)) {
      setDismissed(true);
    }

    fetch('/api/user/onboarding')
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch');
        return r.json();
      })
      .then(data => {
        setProgress(data.onboardingProgress || {});
        setSettingsCompleted(data.settingsCompleted || false);
      })
      .catch(err => {
        console.error('[Onboarding] Failed to fetch progress:', err);
      })
      .finally(() => setLoading(false));
  }, []);

  const markStep = useCallback(async (step: OnboardingStep) => {
    // Skip if already marked
    if (progress[step]) return;

    // Optimistic update
    setProgress(prev => ({ ...prev, [step]: true }));

    try {
      const res = await fetch('/api/user/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step }),
      });
      if (res.ok) {
        const data = await res.json();
        setProgress(data.onboardingProgress);
      }
    } catch (err) {
      console.error('[Onboarding] Failed to mark step:', err);
    }
  }, [progress]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, '1');
    }
    fetch('/api/user/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'skip' }),
    }).catch(err => console.error('[Onboarding] Failed to dismiss:', err));
  }, []);

  const isComplete = isOnboardingComplete(progress);

  return (
    <OnboardingContext.Provider value={{ progress, loading, settingsCompleted, isComplete, dismissed, markStep, dismiss }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}
