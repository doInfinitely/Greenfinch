'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/lib/schema';
import { Loader2, MapPin, Building2 } from 'lucide-react';

const BOARD_COLUMNS: PipelineStatus[] = ['new', 'qualified', 'attempted_contact', 'active_opportunity', 'won', 'lost'];

const COLUMN_COLORS: Record<PipelineStatus, string> = {
  new: 'border-t-gray-400',
  qualified: 'border-t-blue-500',
  attempted_contact: 'border-t-yellow-500',
  active_opportunity: 'border-t-purple-500',
  won: 'border-t-green-500',
  lost: 'border-t-red-500',
  disqualified: 'border-t-orange-500',
};

interface PipelineItem {
  id: string;
  propertyId: string;
  status: PipelineStatus;
  dealValue: number | null;
  statusChangedAt: string;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  commonName: string | null;
  category: string | null;
  subcategory: string | null;
}

interface BoardData {
  items: Record<PipelineStatus, PipelineItem[]>;
  counts: Record<PipelineStatus, number>;
}

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

export default function PipelineBoard() {
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/pipeline/board');
        if (!response.ok) {
          throw new Error('Failed to fetch board data');
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6 overflow-x-auto">
        <div className="max-w-full">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Pipeline Board</h1>
          
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">{error}</div>
          ) : (
            <div className="flex gap-4 min-w-max pb-4">
              {BOARD_COLUMNS.map((status) => (
                <div key={status} className="w-72 flex-shrink-0" data-testid={`column-${status}`}>
                  <Card className={`border-t-4 ${COLUMN_COLORS[status]}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center justify-between">
                        {PIPELINE_STATUS_LABELS[status]}
                        <span className="text-muted-foreground font-normal" data-testid={`count-${status}`}>
                          {data?.counts[status] || 0}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="min-h-[400px] max-h-[600px] overflow-y-auto space-y-3">
                      {(data?.items[status]?.length || 0) > 0 ? (
                        data?.items[status].map((item) => (
                          <Link
                            key={item.id}
                            href={`/property/${item.propertyId}`}
                            className="block"
                            data-testid={`card-property-${item.propertyId}`}
                          >
                            <div className="p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
                              {item.commonName && (
                                <div className="font-medium text-sm text-gray-900 truncate">
                                  {item.commonName}
                                </div>
                              )}
                              <div className="flex items-start gap-1 text-xs text-gray-600 mt-1">
                                <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                <span className="truncate">
                                  {item.propertyAddress || 'No address'}
                                </span>
                              </div>
                              {item.category && (
                                <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                                  <Building2 className="w-3 h-3 flex-shrink-0" />
                                  <span>{item.category}</span>
                                </div>
                              )}
                              {item.dealValue && (
                                <div className="mt-2 text-sm font-semibold text-green-600">
                                  {formatCurrency(item.dealValue)}
                                </div>
                              )}
                            </div>
                          </Link>
                        ))
                      ) : (
                        <div className="text-center py-8">
                          <p className="text-sm text-muted-foreground">
                            No properties
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppSidebar>
  );
}
