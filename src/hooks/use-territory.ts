'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { Territory, TerritoryDefinition } from '@/lib/schema';

interface TerritoryInfo {
  id: string;
  name: string;
  color: string;
  type: string;
  definition: TerritoryDefinition;
}

export function useMyTerritory() {
  const { orgRole } = useAuth();
  const [territory, setTerritory] = useState<TerritoryInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin' || orgRole === 'org:manager';

  useEffect(() => {
    async function fetchMyTerritory() {
      try {
        const res = await fetch('/api/territories/mine');
        const data = await res.json();
        if (data.territory) {
          setTerritory({
            id: data.territory.id,
            name: data.territory.name,
            color: data.territory.color,
            type: data.territory.type,
            definition: data.territory.definition,
          });
        }
      } catch {
        // Non-critical
      } finally {
        setIsLoading(false);
      }
    }
    fetchMyTerritory();
  }, []);

  return { territory, isLoading, isAdmin };
}

export function useAllTerritories() {
  const [territories, setTerritories] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchTerritories() {
      try {
        const res = await fetch('/api/territories');
        const data = await res.json();
        setTerritories(
          (data.territories || []).map((t: { id: string; name: string; color: string }) => ({
            id: t.id,
            name: t.name,
            color: t.color,
          }))
        );
      } catch {
        // Non-critical
      } finally {
        setIsLoading(false);
      }
    }
    fetchTerritories();
  }, []);

  return { territories, isLoading };
}
