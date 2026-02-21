'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';
import type { PropertyRelation } from './types';

function LowConfidenceMarker({ confidence }: { confidence: number | null | undefined }) {
  if (confidence === null || confidence === undefined || confidence >= 0.70) return null;
  
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 ml-1" title={`${Math.round(confidence * 100)}% confidence`}>
      <AlertTriangle className="w-3 h-3 mr-0.5" />
      Unsure
    </span>
  );
}

interface GroupedProperty {
  id: string;
  propertyKey: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  commonName: string | null;
  assetCategory: string | null;
  roles: { role: string; confidenceScore: number | null }[];
  relationshipStatus: string | null;
}

function groupProperties(properties: PropertyRelation[]): GroupedProperty[] {
  const map = new Map<string, GroupedProperty>();

  for (const prop of properties) {
    const key = prop.propertyKey || prop.id;
    const existing = map.get(key);

    if (existing) {
      if (prop.role && !existing.roles.some(r => r.role === prop.role)) {
        existing.roles.push({ role: prop.role, confidenceScore: prop.confidenceScore });
      }
    } else {
      map.set(key, {
        id: prop.id,
        propertyKey: prop.propertyKey,
        address: prop.address,
        city: prop.city,
        state: prop.state,
        zip: prop.zip,
        commonName: prop.commonName,
        assetCategory: prop.assetCategory,
        roles: prop.role ? [{ role: prop.role, confidenceScore: prop.confidenceScore }] : [],
        relationshipStatus: prop.relationshipStatus,
      });
    }
  }

  return Array.from(map.values());
}

interface AssociatedPropertiesProps {
  properties: PropertyRelation[];
}

export default function AssociatedProperties({ properties }: AssociatedPropertiesProps) {
  const grouped = useMemo(() => groupProperties(properties), [properties]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Associated Properties
        <span className="ml-2 text-sm font-normal text-gray-500">({grouped.length})</span>
      </h2>
      
      {grouped.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No properties associated with this contact.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map((prop) => (
            <Link
              key={prop.propertyKey || prop.id}
              href={`/property/${prop.propertyKey || prop.id}`}
              className="block p-4 border border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors"
              data-testid={`link-property-${prop.propertyKey || prop.id}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  {prop.commonName && (
                    <p className="font-medium text-gray-900 truncate">
                      {(() => {
                        const name = prop.commonName;
                        const upperCount = (name.match(/[A-Z]/g) || []).length;
                        const letterCount = (name.match(/[a-zA-Z]/g) || []).length;
                        if (letterCount > 0 && upperCount / letterCount > 0.8) {
                          return name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
                        }
                        return name;
                      })()}
                    </p>
                  )}
                  <p className={prop.commonName ? "text-sm text-gray-600 truncate" : "font-medium text-gray-900 truncate"}>
                    {prop.address || 'Unknown Address'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {[prop.city, prop.state, prop.zip].filter(Boolean).join(', ')}
                  </p>
                  {prop.assetCategory && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                      {prop.assetCategory}
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 ml-2">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {prop.roles.map((r) => (
                      <span key={r.role} className="flex items-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[r.role] || ROLE_COLORS.other}`}>
                          {ROLE_LABELS[r.role] || r.role}
                        </span>
                        <LowConfidenceMarker confidence={r.confidenceScore} />
                      </span>
                    ))}
                  </div>
                  {prop.relationshipStatus === 'job_change_detected' && (
                    <span className="text-xs text-amber-600 font-medium" data-testid={`badge-job-change-${prop.propertyKey || prop.id}`}>
                      May have changed jobs
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
