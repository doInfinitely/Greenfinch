// ============================================================================
// AI Enrichment — Stage 1: Property Classification & Physical Verification
//
// Sends a single Gemini search-grounded call to:
//   1. Verify the property's name, address, and physical stats against web data
//   2. Assign a category/subcategory from the ASSET_CATEGORIES taxonomy
//   3. Estimate a CRE property class (A/B/C/D), using DCAD quality grade
//      as a fallback when AI doesn't return one
//
// Retry policy: up to RETRIES.STAGE_1 attempts with exponential back-off.
// ============================================================================

import type { CommercialProperty } from "../../property-types";
import type { MarketConfig } from "../../markets/types";
import type { StageResult, PropertyDataAndClassification, StageMetadata } from '../types';
import { isRetryableGeminiError } from '../errors';
import { extractGroundingQuality, parseJsonResponse, validateStage1Schema } from '../parsers';
import { formatBuildingsSummary, formatCompactCategories, mapQualityGradeToClass, propertyLatLng } from '../helpers';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import {
  THINKING_LEVELS, RETRIES, BACKOFF, STAGE_MODELS, STAGE_TEMPERATURES, STAGE_TIMEOUTS,
} from '../config';
import { getStageConfig } from '../runtime-config';
import { getLLMAdapter } from '../llm';
import type { LLMResponse } from '../llm';

/**
 * Run Stage 1 of the AI enrichment pipeline.
 *
 * Given a raw property record from DCAD staging data, this searches the web
 * to verify details and returns structured classification + physical data.
 */
export async function classifyAndVerifyProperty(property: CommercialProperty, options: { clerkOrgId?: string; market?: MarketConfig } = {}): Promise<StageResult<PropertyDataAndClassification>> {
  const deedOwner = property.ownerName1 || 'Unknown';
  const bizName = property.bizName || null;
  const totalSqft = property.totalGrossBldgArea || null;
  const lotAcres = property.lotAcres || (property.lotSqft ? property.lotSqft / 43560 : null);
  const lotAcresStr = lotAcres ? `${lotAcres.toFixed(1)} acres` : 'unknown';
  const valStr = property.dcadTotalVal ? `$${(property.dcadTotalVal / 1000000).toFixed(1)}M` : '$0';

  const parentBuilding = property.buildings?.[0];
  const dcadQualityGrade = parentBuilding?.qualityGrade || null;
  const classEstimate = mapQualityGradeToClass(dcadQualityGrade);

  const sptdDescription = property.sptdCode === 'F10' ? 'Commercial' :
                          property.sptdCode === 'F20' ? 'Industrial' :
                          property.sptdCode === 'B11' ? 'Apartments/Multifamily' :
                          property.sptdCode || 'Unknown';

  const buildingInfo = formatBuildingsSummary(property.buildings, totalSqft);
  const classLine = classEstimate.propertyClass
    ? `\nDCAD CLASS ESTIMATE: ${classEstimate.propertyClass} (from quality grade "${dcadQualityGrade}"). Override only if research shows renovations or condition changes.`
    : '';

  // -- Build the prompt -------------------------------------------------------
  const prompt = `Search the web to verify and classify this commercial property. Return ONLY valid JSON.

ADDRESS: ${property.address}, ${property.city}, ${options.market?.state || property.state || 'TX'} ${property.zip}
DCAD: ${property.sptdCode || '?'} ${sptdDescription} | ${property.buildingCount || 0} bldgs, ${totalSqft?.toLocaleString() || 'unknown'} sqft | ${valStr} | ${lotAcresStr} | Quality: ${dcadQualityGrade || 'Unknown'}
DEED OWNER: ${deedOwner}${bizName ? ` | BUSINESS NAME: ${bizName}` : ''} | ZONING: ${property.usedesc || 'Unknown'}
Note: DCAD may show one parcel of a multi-parcel property. Confirm or correct with canonical totals.${buildingInfo}${classLine}

CATEGORIES: ${formatCompactCategories()}

TASK: Search the web to find current information about this property. Look for anchor tenants, year built, renovations, and property details.

Return JSON:
{
  "name": "...",
  "addr": "...",
  "cat": "...",
  "sub": "...",
  "c": 0.0,
  "class": "B",
  "cc": 0.0,
  "acres": 0,
  "ac": 0.0,
  "sqft": 0,
  "sc": 0.0,
  "summary": "2 sentences max."
}`;

  console.log('[FocusedEnrichment] Stage 1: Classification and physical verification...');

  // -- Retry loop -------------------------------------------------------------
  const stageConfig = getStageConfig('stage1_classify');
  const adapter = getLLMAdapter(stageConfig.provider);
  let response: LLMResponse | undefined;
  let text = '';

  for (let attempt = 1; attempt <= RETRIES.STAGE_1; attempt++) {
    console.log(`[FocusedEnrichment] Stage 1 API call attempt ${attempt}/${RETRIES.STAGE_1} (provider: ${stageConfig.provider})...`);

    try {
      response = await adapter.call(prompt, {
        model: STAGE_MODELS.STAGE_1_CLASSIFY,
        temperature: STAGE_TEMPERATURES.STAGE_1_CLASSIFY,
        thinkingLevel: THINKING_LEVELS.STAGE_1_CLASSIFY,
        timeoutMs: STAGE_TIMEOUTS.STAGE_1_CLASSIFY,
        stageName: 'stage1-classify',
        searchGrounding: stageConfig.searchGrounding,
        latLng: propertyLatLng(property),
      });

      text = response.text?.trim() || '';
      console.log('[FocusedEnrichment] Stage 1 response length:', text.length, 'chars');

      if (text) {
        break;
      }

      console.warn(`[FocusedEnrichment] Empty response in Stage 1 (attempt ${attempt})`);
    } catch (apiError) {
      const errMsg = apiError instanceof Error ? apiError.message : String(apiError);
      const { retryable, isDeadline, isStreamDisconnect } = isRetryableGeminiError(errMsg);

      console.warn(`[FocusedEnrichment] Stage 1 attempt ${attempt} error (retryable=${retryable}, deadline=${isDeadline}, streamDisconnect=${isStreamDisconnect}): ${errMsg.substring(0, 200)}`);

      if (!retryable || attempt >= RETRIES.STAGE_1) {
        throw apiError;
      }
    }

    // Exponential back-off: longer waits for timeouts, shorter for other errors
    if (attempt < RETRIES.STAGE_1) {
      const isDeadline = text === '' || (response === undefined);
      const baseMs = isDeadline ? BACKOFF.STAGE_1_DEADLINE_BASE_MS : BACKOFF.STAGE_1_DEFAULT_BASE_MS;
      const backoffMs = Math.min(baseMs * Math.pow(2, attempt - 1), BACKOFF.STAGE_1_MAX_MS);
      console.log(`[FocusedEnrichment] Retrying Stage 1 in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  // -- Handle total failure ---------------------------------------------------
  if (!text) {
    console.error('[FocusedEnrichment] Stage 1 failed after all retries - returning empty result');
    trackCostFireAndForget({
      provider: stageConfig.provider,
      endpoint: 'classify-property',
      entityType: 'property',
      clerkOrgId: options.clerkOrgId,
      tokenUsage: response?.tokenUsage ? {
        promptTokens: response.tokenUsage.inputTokens,
        responseTokens: response.tokenUsage.outputTokens,
        thinkingTokens: response.tokenUsage.thinkingTokens,
        totalTokens: response.tokenUsage.totalTokens,
        searchGroundingUsed: response.tokenUsage.groundingQueriesUsed > 0,
        searchGroundingQueryCount: response.tokenUsage.groundingQueriesUsed,
        searchGroundingCostUsd: response.tokenUsage.groundingCostUsd,
      } : undefined,
      success: false,
      errorMessage: 'Empty response after all retries',
    });
    return {
      data: {
        physical: {
          lotAcres: null,
          lotAcresConfidence: null,
          netSqft: null,
          netSqftConfidence: null,
        },
        classification: {
          propertyName: '',
          canonicalAddress: property.address || '',
          category: '',
          subcategory: '',
          confidence: 0,
          propertyClass: null,
          propertyClassConfidence: null,
        },
      },
      summary: '',
      sources: [],
    };
  }

  // -- Parse response and extract sources ------------------------------------
  const sources = response!.groundingSources;
  const groundingQuality = response!.raw?.groundingQuality || extractGroundingQuality(response!.raw);
  const parsed = parseJsonResponse(text);

  try {
    validateStage1Schema(parsed);
  } catch (schemaErr) {
    console.warn(`[FocusedEnrichment] Stage 1 schema validation failed: ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
    console.warn(`[FocusedEnrichment] Stage 1 raw response: ${text.substring(0, 300)}`);
  }

  trackCostFireAndForget({
    provider: stageConfig.provider,
    endpoint: 'classify-property',
    entityType: 'property',
    clerkOrgId: options.clerkOrgId,
    tokenUsage: response?.tokenUsage ? {
      promptTokens: response.tokenUsage.inputTokens,
      responseTokens: response.tokenUsage.outputTokens,
      thinkingTokens: response.tokenUsage.thinkingTokens,
      totalTokens: response.tokenUsage.totalTokens,
      searchGroundingUsed: response.tokenUsage.groundingQueriesUsed > 0,
      searchGroundingQueryCount: response.tokenUsage.groundingQueriesUsed,
      searchGroundingCostUsd: response.tokenUsage.groundingCostUsd,
    } : undefined,
    success: true,
    metadata: { sourcesCount: sources.length },
  });

  console.log(`[FocusedEnrichment] Stage 1 complete with ${sources.length} grounded sources`);

  // -- Merge AI class with DCAD fallback -------------------------------------
  const aiClass = parsed.class ?? parsed.property_class ?? null;
  const aiClassConfidence = parsed.cc ?? parsed.property_class_confidence ?? null;
  const finalClass = aiClass || classEstimate.propertyClass;
  const finalClassConfidence = aiClass ? (aiClassConfidence ?? 0.7) : classEstimate.confidence;

  const classifyMetadata: StageMetadata = {
    finishReason: response!.finishReason,
    tokens: response!.tokenUsage ? {
      prompt: response!.tokenUsage.inputTokens,
      response: response!.tokenUsage.outputTokens,
      thinking: response!.tokenUsage.thinkingTokens,
      total: response!.tokenUsage.totalTokens,
    } : undefined,
    searchQueries: groundingQuality?.webSearchQueries?.length > 0 ? groundingQuality.webSearchQueries : undefined,
  };

  return {
    data: {
      physical: {
        lotAcres: parsed.acres ?? parsed.lot_acres ?? null,
        lotAcresConfidence: parsed.ac ?? parsed.lot_acres_confidence ?? null,
        netSqft: parsed.sqft ?? parsed.net_sqft ?? null,
        netSqftConfidence: parsed.sc ?? parsed.net_sqft_confidence ?? null,
      },
      classification: {
        propertyName: parsed.name ?? parsed.propertyName ?? '',
        canonicalAddress: parsed.addr ?? parsed.canonicalAddress ?? '',
        category: parsed.cat ?? parsed.category ?? '',
        subcategory: parsed.sub ?? parsed.subcategory ?? '',
        confidence: parsed.c ?? parsed.confidence ?? 0,
        propertyClass: finalClass,
        propertyClassConfidence: finalClassConfidence,
      },
    },
    summary: parsed.summary || '',
    sources,
    metadata: classifyMetadata,
  };
}
