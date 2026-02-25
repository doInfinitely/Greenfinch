'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowRightLeft, Merge, MapPin, User, Users } from 'lucide-react';

interface PropertyResult {
  id: string;
  regridAddress: string | null;
  validatedAddress: string | null;
  city: string | null;
  assetCategory: string | null;
  dcadOwnerName1: string | null;
  enrichmentStatus: string | null;
  contactCount: number;
}

function PropertyCard({ property }: { property: PropertyResult }) {
  const address = property.validatedAddress || property.regridAddress || 'Unknown address';
  return (
    <div className="border rounded-lg p-4 bg-white space-y-2">
      <div className="flex items-start gap-2">
        <MapPin className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold text-gray-900 leading-snug">{address}</p>
          {property.city && <p className="text-xs text-gray-500">{property.city}</p>}
        </div>
      </div>
      {property.assetCategory && (
        <div>
          <Badge variant="outline" className="text-xs">{property.assetCategory}</Badge>
        </div>
      )}
      {property.dcadOwnerName1 && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <User className="h-3.5 w-3.5" />{property.dcadOwnerName1}
        </div>
      )}
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Users className="h-3.5 w-3.5" />{property.contactCount} contact{property.contactCount !== 1 ? 's' : ''}
      </div>
      {property.enrichmentStatus && (
        <div className="text-xs text-gray-400">Status: {property.enrichmentStatus}</div>
      )}
    </div>
  );
}

function usePropertySearch() {
  const [results, setResults] = useState<PropertyResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async (q: string) => {
    if (q.length < 3) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/property-search?q=${encodeURIComponent(q)}&limit=8`);
      const json = await res.json();
      setResults(json.data ?? []);
    } finally {
      setLoading(false);
    }
  };

  return { results, loading, search, setResults };
}

function SearchPanel({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: PropertyResult | null;
  onSelect: (p: PropertyResult) => void;
}) {
  const { results, loading, search, setResults } = usePropertySearch();
  const [query, setQuery] = useState('');

  return (
    <div className="flex-1 space-y-3">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <Input
        data-testid={`input-search-property-${label.toLowerCase().replace(' ', '-')}`}
        placeholder="Search by address..."
        value={query}
        onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
      />
      {loading && <p className="text-xs text-gray-400">Searching...</p>}
      {results.length > 0 && !selected && (
        <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
          {results.map((p) => {
            const addr = p.validatedAddress || p.regridAddress || 'Unknown';
            return (
              <button
                key={p.id}
                data-testid={`property-result-${p.id}`}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                onClick={() => { onSelect(p); setResults([]); setQuery(addr); }}
              >
                <span className="font-medium">{addr}</span>
                {p.city && <span className="text-gray-400 ml-2 text-xs">{p.city}</span>}
                {p.assetCategory && <span className="text-gray-400 ml-2 text-xs">· {p.assetCategory}</span>}
              </button>
            );
          })}
        </div>
      )}
      {selected && <PropertyCard property={selected} />}
    </div>
  );
}

export default function MergePropertiesPage() {
  const { toast } = useToast();
  const [left, setLeft] = useState<PropertyResult | null>(null);
  const [right, setRight] = useState<PropertyResult | null>(null);
  const [swapped, setSwapped] = useState(false);

  const keep = swapped ? right : left;
  const merge = swapped ? left : right;

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!keep || !merge) throw new Error('Select two properties first');
      const res = await fetch('/api/admin/merge-properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepPropertyId: keep.id, mergePropertyId: merge.id }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      return json;
    },
    onSuccess: () => {
      toast({ title: 'Properties merged successfully' });
      setLeft(null);
      setRight(null);
      setSwapped(false);
    },
    onError: (err: Error) => {
      toast({ title: 'Merge failed', description: err.message, variant: 'destructive' });
    },
  });

  const keepAddr = keep ? (keep.validatedAddress || keep.regridAddress || 'Property') : '';
  const mergeAddr = merge ? (merge.validatedAddress || merge.regridAddress || 'Property') : '';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Merge Properties</h1>
        <p className="text-sm text-gray-500 mt-1">Search and select two properties to merge. All contacts and data from the deleted property will be re-linked to the kept one.</p>
      </div>

      <div className="flex gap-6 items-start">
        <SearchPanel label="Left Property" selected={left} onSelect={setLeft} />

        <div className="flex flex-col items-center gap-3 pt-8">
          <Button
            variant="outline"
            size="sm"
            data-testid="btn-swap-property-direction"
            onClick={() => setSwapped(s => !s)}
            title="Swap keep/merge direction"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
          {keep && merge && (
            <Button
              data-testid="btn-merge-properties"
              className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 h-auto"
              onClick={() => mergeMutation.mutate()}
              disabled={mergeMutation.isPending}
            >
              <Merge className="h-3.5 w-3.5 mr-1" />Merge
            </Button>
          )}
        </div>

        <SearchPanel label="Right Property" selected={right} onSelect={setRight} />
      </div>

      {keep && merge && (
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <span className="font-semibold text-amber-800">Keep:</span>{' '}
          <span className="text-amber-700">{keepAddr}</span>
          <span className="mx-3 text-amber-400">—</span>
          <span className="font-semibold text-amber-800">Delete:</span>{' '}
          <span className="text-amber-700">{mergeAddr}</span>
          <Badge
            variant="outline"
            className="ml-3 text-xs cursor-pointer border-amber-300 text-amber-700"
            onClick={() => setSwapped(s => !s)}
          >
            Swap direction
          </Badge>
        </div>
      )}
    </div>
  );
}
