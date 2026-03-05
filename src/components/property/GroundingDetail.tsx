'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Search, FileText, Sparkles } from 'lucide-react';
import type { AIGroundingData } from './types';

interface GroundingDetailProps {
  grounding: AIGroundingData;
  label?: string;
}

export function GroundingDetail({ grounding, label = 'AI Sources' }: GroundingDetailProps) {
  const [expanded, setExpanded] = useState(false);

  const hasContent = grounding.sourceUrl || grounding.evidence ||
    (grounding.groundingSupports && grounding.groundingSupports.length > 0) ||
    (grounding.webSearchQueries && grounding.webSearchQueries.length > 0) ||
    (grounding.citations && grounding.citations.length > 0);

  if (!hasContent) return null;

  return (
    <div className="mt-2" data-testid="grounding-detail">
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 transition-colors"
        data-testid="button-toggle-grounding"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Sparkles className="w-3 h-3" />
        <span>{label}</span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-4 space-y-2 text-xs border-l-2 border-violet-100 pl-3" data-testid="grounding-detail-content">
          {grounding.sourceUrl && (
            <div className="flex items-start gap-1.5">
              <ExternalLink className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
              <a
                href={grounding.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline break-all"
                data-testid="link-grounding-source"
              >
                {grounding.sourceUrl}
              </a>
            </div>
          )}

          {grounding.evidence && (
            <div className="flex items-start gap-1.5">
              <FileText className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
              <p className="text-gray-600 italic" data-testid="text-grounding-evidence">
                "{grounding.evidence}"
              </p>
            </div>
          )}

          {grounding.groundingSupports && grounding.groundingSupports.length > 0 && (
            <div className="space-y-1">
              <p className="text-gray-500 font-medium">Claims ({grounding.groundingSupports.length})</p>
              {grounding.groundingSupports.map((support, idx) => {
                const avgConfidence = support.confidenceScores.length > 0
                  ? support.confidenceScores.reduce((a, b) => a + b, 0) / support.confidenceScores.length
                  : 0;
                return (
                  <div key={idx} className="flex items-start gap-2 bg-violet-50/50 rounded px-2 py-1" data-testid={`grounding-claim-${idx}`}>
                    <span className="text-gray-600 flex-1">"{support.segment}"</span>
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      avgConfidence >= 0.8 ? 'bg-green-100 text-green-700' :
                      avgConfidence >= 0.5 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {(avgConfidence * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {grounding.webSearchQueries && grounding.webSearchQueries.length > 0 && (
            <div className="space-y-1">
              <p className="text-gray-500 font-medium flex items-center gap-1">
                <Search className="w-3 h-3" />
                Search queries
              </p>
              <div className="flex flex-wrap gap-1">
                {grounding.webSearchQueries.map((query, idx) => (
                  <span
                    key={idx}
                    className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
                    data-testid={`grounding-query-${idx}`}
                  >
                    {query}
                  </span>
                ))}
              </div>
            </div>
          )}

          {grounding.citations && grounding.citations.length > 0 && (
            <div className="space-y-1">
              <p className="text-gray-500 font-medium">Citations</p>
              {grounding.citations.map((citation, idx) => (
                <div key={idx} className="flex items-start gap-1.5" data-testid={`grounding-citation-${idx}`}>
                  <ExternalLink className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
                  {citation.uri ? (
                    <a
                      href={citation.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {citation.title || citation.uri}
                    </a>
                  ) : (
                    <span className="text-gray-600">{citation.title || 'Untitled citation'}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
