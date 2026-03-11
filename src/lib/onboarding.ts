export interface OnboardingProgress {
  services?: boolean;
  territory?: boolean;
  viewedMap?: boolean;
  viewedProperty?: boolean;
  revealedContact?: boolean;
  completedAt?: string | null;
  skippedAt?: string | null;
}

export function isOnboardingComplete(p: OnboardingProgress | null | undefined): boolean {
  if (!p) return false;
  return !!(p.completedAt || p.skippedAt);
}

export function allStepsComplete(p: OnboardingProgress | null | undefined): boolean {
  if (!p) return false;
  return !!(p.services && p.territory && p.viewedMap && p.viewedProperty && p.revealedContact);
}

export const ONBOARDING_STEPS = [
  { key: 'services', label: 'Select services', href: '/settings' },
  { key: 'territory', label: 'Confirm territory', href: '/onboarding' },
  { key: 'viewedMap', label: 'Explore map', href: '/dashboard/map' },
  { key: 'viewedProperty', label: 'View a property', href: '/dashboard/map' },
  { key: 'revealedContact', label: 'Reveal a contact', href: '/contacts' },
] as const;

export type OnboardingStep = typeof ONBOARDING_STEPS[number]['key'];
