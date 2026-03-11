'use client';

import { useQuery } from '@tanstack/react-query';
import { emptyFilters } from '@/components/PropertyFilters';
import type { FilterState } from '@/components/PropertyFilters';
import { mergeSegmentDefaults } from '@/lib/segment-filter-defaults';

interface UserSettings {
  selectedServices: string[];
}

export function useSegmentDefaults() {
  const { data, isLoading } = useQuery<UserSettings>({
    queryKey: ['/api/user/settings', 'segment-defaults'],
    queryFn: async () => {
      const res = await fetch('/api/user/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const segmentDefaults: FilterState =
    data?.selectedServices && data.selectedServices.length > 0
      ? mergeSegmentDefaults(data.selectedServices)
      : { ...emptyFilters };

  return { segmentDefaults, isLoading };
}
