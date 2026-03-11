'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useOnboarding } from '@/contexts/OnboardingContext';

export default function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { loading, settingsCompleted, isComplete, dismissed } = useOnboarding();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    // Don't redirect if already on onboarding or settings page
    if (pathname?.startsWith('/onboarding') || pathname?.startsWith('/settings')) return;
    // Redirect if settings not completed and not skipped/completed onboarding
    if (!settingsCompleted && !isComplete && !dismissed) {
      router.push('/onboarding');
    }
  }, [loading, settingsCompleted, isComplete, dismissed, pathname, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return <>{children}</>;
}
