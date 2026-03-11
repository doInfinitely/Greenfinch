'use client';

import { useQuery } from '@tanstack/react-query';

interface CreditBalance {
  currentBalance: number;
  rolloverBalance: number;
  purchasedBalance: number;
  totalAvailable: number;
  rolloverCap: number;
}

export function useCreditBalance() {
  return useQuery<CreditBalance>({
    queryKey: ['credit-balance'],
    queryFn: async () => {
      const res = await fetch('/api/billing/balance');
      if (!res.ok) throw new Error('Failed to fetch credit balance');
      const json = await res.json();
      return json.data;
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}
