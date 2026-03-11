'use client';

import { Badge } from '@/components/ui/badge';
import { formatCurrencyCompact } from '@/lib/utils';
import { computeUserRevenueTotal, checkPropertySuitability } from '@/lib/revenue-estimation';
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
  selectedServices?: string[] | null;
}

export default function PropertyStats({ property, enrichedProperty, selectedServices }: PropertyStatsProps) {
  const userRevenueTotal = computeUserRevenueTotal(
    property.revenueEstimates,
    selectedServices,
  );
  const serviceCount = selectedServices?.filter(
    svc => property.revenueEstimates && (property.revenueEstimates as Record<string, number>)[svc]
  ).length || 0;

  // Check suitability for each selected service
  const lotSqft = property.lotAcres ? Math.round(property.lotAcres * 43560) : null;
  const unsuitableServices = selectedServices?.map(svc => {
    const result = checkPropertySuitability(
      svc,
      enrichedProperty?.assetCategory || null,
      enrichedProperty?.assetSubcategory || null,
      lotSqft,
    );
    return result.suitable ? null : { service: svc, reason: result.reason };
  }).filter(Boolean) || [];

  return (
    <>
      {unsuitableServices.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4" data-testid="suitability-warning">
          <p className="text-sm text-amber-700 font-medium">Property suitability note</p>
          {unsuitableServices.map((item, i) => (
            <p key={i} className="text-xs text-amber-600 mt-1">{item!.reason}</p>
          ))}
        </div>
      )}

      {userRevenueTotal > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6" data-testid="stat-estimated-revenue">
          <p className="text-sm text-green-700 mb-1">Estimated Annual Value</p>
          <p className="text-2xl font-bold text-green-800" data-testid="text-estimated-revenue-value">
            {formatCurrencyCompact(userRevenueTotal)} <span className="text-base font-normal text-green-600">/yr</span>
          </p>
          <p className="text-xs text-green-600 mt-1">
            Based on {serviceCount} service{serviceCount !== 1 ? 's' : ''} you provide
          </p>
        </div>
      )}

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
            <div className="flex items-center h-[28px]">
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
