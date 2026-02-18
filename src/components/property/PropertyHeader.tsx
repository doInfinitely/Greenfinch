'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X, Loader2, MoreVertical, ListPlus, User, XCircle, Eye, Sparkles } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLORS } from '@/lib/constants';
import { AdminOnly } from '@/components/PermissionGate';
import { useEnrichmentQueue } from '@/contexts/EnrichmentQueueContext';
import GreenfinchAgentIcon from '@/components/icons/GreenfinchAgentIcon';
import PipelineStatus from '@/components/PipelineStatus';
import CustomerToggle from '@/components/CustomerToggle';
import { normalizeCommonName } from '@/lib/normalization';
import type { Property, EnrichedPropertyData, EnrichmentStatusType } from './types';

function LowConfidenceMarker({ confidence }: { confidence: number | null | undefined }) {
  if (confidence === null || confidence === undefined || confidence >= 0.70) return null;
  
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 ml-1" title={`${Math.round(confidence * 100)}% confidence`}>
      <AlertTriangle className="w-3 h-3 mr-0.5" />
      Unsure
    </span>
  );
}

interface PropertyHeaderProps {
  property: Property;
  enrichedProperty: EnrichedPropertyData | null;
  enrichmentStatus: EnrichmentStatusType;
  enrichmentMessage: string;
  pipelineOwner: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    displayName: string;
  } | null;
  userId: string | null;
  isCurrentCustomer: boolean;
  propertyId: string;
  assignDialogTrigger: number;
  pipelineData?: {
    id?: string;
    status: string;
    dealValue: number | null;
    ownerId: string | null;
    owner: any;
  } | null;
  pipelineLoaded?: boolean;
  onEnrichment: () => void;
  onShowAddToList: () => void;
  onSetAssignDialogTrigger: (fn: (prev: number) => number) => void;
  onSetIsCurrentCustomer: (value: boolean) => void;
}

export default function PropertyHeader({
  property,
  enrichedProperty,
  enrichmentStatus,
  enrichmentMessage,
  pipelineOwner,
  userId,
  isCurrentCustomer,
  propertyId,
  assignDialogTrigger,
  pipelineData,
  pipelineLoaded,
  onEnrichment,
  onShowAddToList,
  onSetAssignDialogTrigger,
  onSetIsCurrentCustomer,
}: PropertyHeaderProps) {
  const router = useRouter();
  const { getEnrichmentStatus } = useEnrichmentQueue();

  return (
    <>
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <button
          onClick={() => router.back()}
          className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
          data-testid="button-back"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
          <div className="min-w-0 flex-1 overflow-hidden">
            {enrichedProperty?.commonName && (
              <div className="mb-1">
                <h1 className="text-2xl font-bold text-gray-900 break-words">
                  {normalizeCommonName(enrichedProperty.commonName)}
                </h1>
              </div>
            )}
            <p className={`${enrichedProperty?.commonName ? 'text-lg text-gray-600' : 'text-2xl font-bold text-gray-900'} mb-1 break-words`}>
              {property.address || 'No Address'}
            </p>
            <p className="text-gray-600">
              {property.city}, {property.state} {property.zip}
            </p>
            {property.county && (
              <p className="text-sm text-gray-500">{property.county} County</p>
            )}
            
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {enrichedProperty?.assetCategory && (() => {
                const colors = CATEGORY_COLORS[enrichedProperty.assetCategory] || DEFAULT_CATEGORY_COLORS;
                return (
                  <span className="inline-flex items-center gap-1">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
                      {enrichedProperty.assetCategory}
                    </span>
                    {enrichedProperty?.assetSubcategory && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${colors.subBg} ${colors.subText}`}>
                        {enrichedProperty.assetSubcategory}
                      </span>
                    )}
                  </span>
                );
              })()}
              <LowConfidenceMarker confidence={enrichedProperty?.categoryConfidence} />
            </div>
          </div>
          
          <div className="flex-shrink-0 flex flex-wrap items-center gap-2">
            {pipelineOwner && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Avatar className="w-8 h-8 cursor-default" data-testid="avatar-pipeline-owner">
                      <AvatarImage src={pipelineOwner.profileImageUrl || ''} />
                      <AvatarFallback className="text-xs bg-green-100 text-green-700">
                        {pipelineOwner.displayName?.charAt(0) || '?'}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent className="z-[100] bg-white border border-border px-3 py-1.5 text-sm text-popover-foreground shadow-md">
                    <p>Owner: {pipelineOwner.displayName}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            
            {(() => {
              const queueStatus = getEnrichmentStatus(property.propertyKey, 'property');
              const isEnrichmentActive = queueStatus.isActive;
              const enrichmentHasFailed = queueStatus.status === 'failed';
              const isResearchComplete = enrichmentStatus === 'completed' || enrichmentStatus === 'enriched';
              
              if (isResearchComplete) {
                return (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center justify-center w-8 h-8" role="img" aria-label="Researched with AI" data-testid="icon-researched">
                          <Sparkles className="w-5 h-5 text-purple-500" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="z-[100] bg-white border border-border px-3 py-1.5 text-sm text-popover-foreground shadow-md">
                        <p>Researched with AI</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              }
              
              return (
                <AdminOnly>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onEnrichment}
                    disabled={isEnrichmentActive}
                    className={
                      enrichmentHasFailed 
                        ? 'text-red-600 border-red-300 hover:bg-red-50' 
                        : 'border-purple-500 text-purple-700'
                    }
                    title={enrichmentHasFailed ? `Failed: ${queueStatus.error || 'Unknown error'} - Click to retry` : undefined}
                    data-testid="button-find-decision-makers"
                  >
                    {isEnrichmentActive ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : enrichmentHasFailed ? (
                      <XCircle className="w-4 h-4 mr-1" />
                    ) : (
                      <GreenfinchAgentIcon className="w-4 h-4 mr-1" />
                    )}
                    {isEnrichmentActive ? 'Researching...' : enrichmentHasFailed ? 'Retry Research' : 'Research'}
                  </Button>
                </AdminOnly>
              );
            })()}
            
            <Button
              variant="outline"
              size="icon"
              onClick={onShowAddToList}
              title="Add to prospecting list"
              disabled={!userId}
              data-testid="button-add-to-list"
            >
              <ListPlus className="w-4 h-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-more-actions">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-white border border-gray-200">
                <DropdownMenuItem 
                  onClick={async () => {
                    try {
                      await fetch('/api/properties/views', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ propertyId }),
                      });
                    } catch {}
                  }}
                  data-testid="menu-item-mark-new"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Mark as New
                </DropdownMenuItem>
                <AdminOnly>
                  <DropdownMenuItem 
                    onClick={() => onSetAssignDialogTrigger(prev => prev + 1)}
                    data-testid="menu-item-assign-owner"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Assign Owner
                  </DropdownMenuItem>
                </AdminOnly>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <PipelineStatus propertyId={property.propertyKey} inline autoAssignOnFirstStatus hideOwnerControls hideOwnerDisplay triggerAssignDialog={assignDialogTrigger} isCustomer={isCurrentCustomer} initialData={pipelineData} initialLoaded={pipelineLoaded} />
          <div className="border-l border-gray-200 h-6 mx-1 hidden sm:block" />
          <CustomerToggle propertyId={property.propertyKey} onToggle={onSetIsCurrentCustomer} />
        </div>

        {enrichmentMessage && enrichmentStatus !== 'pending' && (
          <div className={`mb-6 p-3 rounded-lg ${(enrichmentStatus === 'completed' || enrichmentStatus === 'enriched') ? 'bg-green-50 text-green-700' : enrichmentStatus === 'failed' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            <p className="text-sm">{enrichmentMessage}</p>
          </div>
        )}
      </div>
    </>
  );
}
