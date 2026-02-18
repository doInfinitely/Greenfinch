'use client';

import { Phone } from 'lucide-react';
import { formatPhoneNumber } from '@/lib/phone-format';
import type { EnrichedPropertyData, EnrichmentStatusType } from './types';

function SummaryWithSources({ 
  summary, 
  sources 
}: { 
  summary: string; 
  sources: Array<{ id: number; title: string; url: string; type: string }> | null;
}) {
  void sources;
  
  if (!summary) return null;
  
  const cleanSummary = summary.replace(/\[[\d,\s]+\]/g, '').replace(/\s{2,}/g, ' ').trim();
  
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
        {cleanSummary}
      </p>
    </div>
  );
}

interface PropertyAboutProps {
  enrichedProperty: EnrichedPropertyData;
  enrichmentStatus: EnrichmentStatusType;
}

export default function PropertyAbout({ enrichedProperty, enrichmentStatus }: PropertyAboutProps) {
  const isResearched = enrichmentStatus === 'completed' || enrichmentStatus === 'enriched';
  
  if (!isResearched || !enrichedProperty) return null;

  const hasContent = enrichedProperty.aiRationale || 
    enrichedProperty.propertyWebsite || 
    enrichedProperty.propertyPhone || 
    enrichedProperty.lastEnrichedAt;
  
  if (!hasContent) return null;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">About This Property</h2>
      
      <div className="space-y-4">
        {enrichedProperty.lastEnrichedAt && (
          <div className="flex items-center gap-2 text-sm">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-gray-500">Data last refreshed:</span>
            <span className="text-gray-900">{new Date(enrichedProperty.lastEnrichedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          </div>
        )}

        {(enrichedProperty.propertyWebsite || enrichedProperty.propertyPhone) && (
          <div className="flex flex-wrap gap-3">
            {enrichedProperty.propertyWebsite && (
              <a
                href={enrichedProperty.propertyWebsite.startsWith('http') ? enrichedProperty.propertyWebsite : `https://${enrichedProperty.propertyWebsite}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                data-testid="link-property-website"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                Property Website
              </a>
            )}
            {enrichedProperty.propertyPhone && (
              <a
                href={`tel:${enrichedProperty.propertyPhone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                data-testid="link-property-phone"
              >
                <Phone className="w-4 h-4" />
                {formatPhoneNumber(enrichedProperty.propertyPhone)}
              </a>
            )}
          </div>
        )}

        {enrichedProperty.aiRationale && (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm font-medium text-gray-700 mb-2">AI Research Summary</p>
            <SummaryWithSources 
              summary={enrichedProperty.aiRationale} 
              sources={enrichedProperty.enrichmentSources} 
            />
          </div>
        )}
      </div>
    </div>
  );
}
