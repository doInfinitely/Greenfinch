'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driver, type DriveStep } from 'driver.js';
import type { WalkthroughState, TourDefinition } from '@/lib/walkthroughs/types';
import { getToursForRoute, getTourById, ALL_TOURS } from '@/lib/walkthroughs/registry';

interface WalkthroughContextValue {
  state: WalkthroughState | null;
  isLoading: boolean;
  startTour: (tourId: string) => void;
  startCurrentPageTour: () => void;
  isTourCompleted: (tourId: string) => boolean;
  isTooltipDismissed: (tooltipId: string) => boolean;
  dismissTooltip: (tooltipId: string) => void;
  skipAll: () => void;
  resetAll: () => void;
  availableTours: TourDefinition[];
  pendingTour: TourDefinition | null;
  acceptTour: () => void;
  dismissTour: () => void;
}

const WalkthroughContext = createContext<WalkthroughContextValue | null>(null);

const DEFAULT_STATE: WalkthroughState = {
  completedTours: [],
  dismissedTooltips: [],
  skippedAll: false,
};

function waitForElement(selector: string, timeout = 5000): Promise<Element | null> {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [pendingTour, setPendingTour] = useState<TourDefinition | null>(null);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastPromptedRoute = useRef<string>('');

  const { data: state, isLoading } = useQuery<WalkthroughState>({
    queryKey: ['walkthroughs'],
    queryFn: async () => {
      const res = await fetch('/api/user/walkthroughs');
      if (!res.ok) throw new Error('Failed to fetch walkthrough state');
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/user/walkthroughs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update walkthrough state');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['walkthroughs'], data);
    },
  });

  const currentState = state ?? DEFAULT_STATE;

  const isTourCompleted = useCallback(
    (tourId: string) => currentState.completedTours.includes(tourId),
    [currentState.completedTours],
  );

  const isTooltipDismissed = useCallback(
    (tooltipId: string) => currentState.dismissedTooltips.includes(tooltipId),
    [currentState.dismissedTooltips],
  );

  const runTour = useCallback(async (tour: TourDefinition) => {
    setActiveTourId(tour.id);

    // Wait for all step elements to be available
    const driveSteps: DriveStep[] = [];
    for (const step of tour.steps) {
      const el = await waitForElement(step.element);
      if (el) {
        driveSteps.push({
          element: step.element,
          popover: {
            title: step.title,
            description: step.description,
            side: step.side,
          },
        });
      }
    }

    if (driveSteps.length === 0) {
      setActiveTourId(null);
      return;
    }

    const driverObj = driver({
      showProgress: true,
      animate: true,
      smoothScroll: true,
      allowClose: true,
      overlayColor: 'rgba(0, 0, 0, 0.5)',
      stagePadding: 8,
      stageRadius: 8,
      steps: driveSteps,
      onDestroyStarted: () => {
        driverObj.destroy();
      },
      onDestroyed: () => {
        mutation.mutate({ completeTour: tour.id });
        setActiveTourId(null);
      },
    });

    driverObj.drive();
  }, [mutation]);

  const startTour = useCallback(
    (tourId: string) => {
      const tour = getTourById(tourId);
      if (tour) {
        setPendingTour(null);
        runTour(tour);
      }
    },
    [runTour],
  );

  const startCurrentPageTour = useCallback(() => {
    const tours = getToursForRoute(pathname);
    if (tours.length > 0) {
      setPendingTour(null);
      runTour(tours[0]);
    }
  }, [pathname, runTour]);

  const dismissTooltip = useCallback(
    (tooltipId: string) => mutation.mutate({ dismissTooltip: tooltipId }),
    [mutation],
  );

  const skipAll = useCallback(() => {
    mutation.mutate({ skipAll: true });
    setPendingTour(null);
  }, [mutation]);

  const resetAll = useCallback(() => {
    mutation.mutate({ resetAll: true });
  }, [mutation]);

  const acceptTour = useCallback(() => {
    if (pendingTour) {
      runTour(pendingTour);
      setPendingTour(null);
    }
  }, [pendingTour, runTour]);

  const dismissTour = useCallback(() => {
    if (pendingTour) {
      mutation.mutate({ completeTour: pendingTour.id });
    }
    setPendingTour(null);
  }, [pendingTour, mutation]);

  // Auto-trigger tour on route change
  useEffect(() => {
    if (isLoading || !state || state.skippedAll || activeTourId) return;
    if (pathname === lastPromptedRoute.current) return;

    const tours = getToursForRoute(pathname);
    const uncompleted = tours.find((t) => !state.completedTours.includes(t.id));

    if (!uncompleted) return;

    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);

    promptTimerRef.current = setTimeout(() => {
      lastPromptedRoute.current = pathname;
      setPendingTour(uncompleted);
    }, uncompleted.triggerDelay ?? 1500);

    return () => {
      if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    };
  }, [pathname, state, isLoading, activeTourId]);

  return (
    <WalkthroughContext.Provider
      value={{
        state: currentState,
        isLoading,
        startTour,
        startCurrentPageTour,
        isTourCompleted,
        isTooltipDismissed,
        dismissTooltip,
        skipAll,
        resetAll,
        availableTours: ALL_TOURS,
        pendingTour,
        acceptTour,
        dismissTour,
      }}
    >
      {children}
    </WalkthroughContext.Provider>
  );
}

export function useWalkthrough() {
  const ctx = useContext(WalkthroughContext);
  if (!ctx) throw new Error('useWalkthrough must be used within WalkthroughProvider');
  return ctx;
}
