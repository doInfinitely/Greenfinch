'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useCelebration } from '@/contexts/CelebrationContext';
import { ONBOARDING_STEPS, allStepsComplete } from '@/lib/onboarding';

export default function OnboardingChecklist() {
  const { progress, loading, isComplete, dismissed, dismiss } = useOnboarding();
  const { celebrate } = useCelebration();
  const celebratedRef = useRef(false);

  const completedCount = ONBOARDING_STEPS.filter(s => progress[s.key]).length;
  const allDone = allStepsComplete(progress);

  // Celebrate when all steps are completed
  useEffect(() => {
    if (allDone && !celebratedRef.current) {
      celebratedRef.current = true;
      celebrate();
    }
  }, [allDone, celebrate]);

  // Don't show if loading, complete, or dismissed
  if (loading || isComplete || dismissed) return null;

  return (
    <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex-shrink-0">
            <span className="text-sm font-medium text-green-800">
              Getting started
            </span>
            <span className="ml-2 text-xs text-green-600">
              {completedCount}/{ONBOARDING_STEPS.length}
            </span>
          </div>

          {/* Progress bar */}
          <div className="hidden sm:block w-20 h-1.5 bg-green-200 rounded-full flex-shrink-0">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / ONBOARDING_STEPS.length) * 100}%` }}
            />
          </div>

          {/* Steps */}
          <div className="flex items-center gap-3 overflow-x-auto flex-1 min-w-0">
            {ONBOARDING_STEPS.map((step) => {
              const done = !!progress[step.key];
              return done ? (
                <span
                  key={step.key}
                  className="flex items-center gap-1 text-xs text-green-600 whitespace-nowrap flex-shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span className="line-through">{step.label}</span>
                </span>
              ) : (
                <Link
                  key={step.key}
                  href={step.href}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-green-700 whitespace-nowrap flex-shrink-0"
                >
                  <span className="w-3.5 h-3.5 rounded-full border border-gray-300 flex-shrink-0" />
                  <span>{step.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <button
          onClick={dismiss}
          className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
