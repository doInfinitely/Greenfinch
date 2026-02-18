'use client';

import { Badge } from '@/components/ui/badge';
import type { Property, EnrichedPropertyData } from './types';

const formatLotSize = (acres: number) => acres.toFixed(1);

const formatBuildingSqft = (sqft: number) => {
  if (sqft >= 1000000) {
    const m = sqft / 1000000;
    return `${m.toFixed(1)}M`;
  }
  if (sqft >= 1000) {
    const k = sqft / 1000;
    return sqft < 19000 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
  }
  return sqft.toString();
};

interface PropertyStatsProps {
  property: Property;
  enrichedProperty: EnrichedPropertyData | null;
}

export default function PropertyStats({ property, enrichedProperty }: PropertyStatsProps) {
  return (
    <>
      <div className={`grid grid-cols-1 gap-4 mb-6 ${property.calculatedBuildingClass ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-lot-size">
          <p className="text-sm text-gray-600 mb-1">Lot Size</p>
          <p className="text-xl font-semibold text-gray-800" data-testid="text-lot-size-value">
            {property.lotAcres && property.lotAcres > 0 ? `${formatLotSize(property.lotAcres)} acres` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-building-area">
          <p className="text-sm text-gray-600 mb-1">Building Area</p>
          <p className="text-xl font-semibold text-gray-800" data-testid="text-building-area-value">
            {property.buildingSqft && property.buildingSqft > 0 ? `${formatBuildingSqft(property.buildingSqft)} sq ft` : 'N/A'}
          </p>
        </div>
        {property.calculatedBuildingClass && (
          <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-building-class">
            <p className="text-sm text-gray-600 mb-1">Building Class</p>
            <Badge variant="outline" className={
              property.calculatedBuildingClass === 'A+' || property.calculatedBuildingClass === 'A' 
                ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
              property.calculatedBuildingClass === 'B' 
                ? 'bg-blue-100 text-blue-800 border-blue-200' :
              property.calculatedBuildingClass === 'C' 
                ? 'bg-amber-100 text-amber-800 border-amber-200' :
              'bg-gray-200 text-gray-700 border-gray-300'
            } data-testid="badge-building-class">
              Class {property.calculatedBuildingClass}
            </Badge>
          </div>
        )}
        <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-year-built">
          <p className="text-sm text-gray-600 mb-1">Year Built</p>
          <p className="text-xl font-semibold text-gray-800" data-testid="text-year-built-value">
            {property.yearBuilt || 'N/A'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
        {property.numFloors && property.numFloors > 1 && (
          <span><span className="font-medium">{property.numFloors}</span> floors</span>
        )}
        {!enrichedProperty?.assetCategory && property.usedesc && property.usedesc.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {property.usedesc.slice(0, 3).map((desc, i) => (
              <span key={i} className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                {desc}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
