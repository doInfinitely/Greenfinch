'use client';

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

interface AssociatedPropertiesProps {
  properties: PropertyRelation[];
}

export default function AssociatedProperties({ properties }: AssociatedPropertiesProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Associated Properties
        <span className="ml-2 text-sm font-normal text-gray-500">({properties.length})</span>
      </h2>
      
      {properties.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No properties associated with this contact.</p>
      ) : (
        <div className="space-y-3">
          {properties.map((prop, index) => (
            <Link
              key={`${prop.id}-${prop.role || index}`}
              href={`/property/${prop.id}`}
              className="block p-4 border border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors"
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
                <div className="text-right">
                  {prop.role && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[prop.role] || ROLE_COLORS.other}`}>
                      {ROLE_LABELS[prop.role] || prop.role}
                    </span>
                  )}
                  <LowConfidenceMarker confidence={prop.confidenceScore} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
