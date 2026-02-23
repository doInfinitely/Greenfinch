// ============================================================================
// AI Enrichment — Stage 1: Property Classification & Physical Verification
// Searches the web to verify property details and classify by category/subcategory.
// ============================================================================

import type { CommercialProperty } from "../../snowflake";
import type { StageResult, PropertyDataAndClassification } from '../types';
import { getGeminiClient, streamGeminiResponse } from '../client';
import { isRetryableGeminiError } from '../errors';
import { extractGroundedSources, parseJsonResponse, validateStage1Schema } from '../parsers';
import { formatBuildingsSummary, formatCompactCategories, mapQualityGradeToClass, propertyLatLng } from '../helpers';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { rateLimiters } from '../../rate-limiter';

export async function classifyAndVerifyProperty(property: CommercialProperty): Promise<StageResult<PropertyDataAndClassification>> {
  const client = getGeminiClient();
  const primaryOwner = property.bizName || property.ownerName1 || 'Unknown';
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
  const prompt = `Search the web to verify and classify this commercial property. Return ONLY valid JSON.

ADDRESS: ${property.address}, ${property.city}, TX ${property.zip}
DCAD: ${property.sptdCode || '?'} ${sptdDescription} | ${property.buildingCount || 0} bldgs, ${totalSqft?.toLocaleString() || 'unknown'} sqft | ${valStr} | ${lotAcresStr} | Quality: ${dcadQualityGrade || 'Unknown'}
OWNER: ${primaryOwner} | ZONING: ${property.usedesc || 'Unknown'}
Note: DCAD may show one parcel of a multi-parcel property. Confirm or correct with canonical totals.${buildingInfo}${classLine}

CATEGORIES: ${formatCompactCategories()}

TASK: Search the web to find current information about this property. Look for anchor tenants, year built, renovations, and property details.

Return JSON:
{"name":"...","addr":"...","cat":"...","sub":"...","c":0.0,"class":"B","cc":0.0,"acres":0,"ac":0.0,"sqft":0,"sc":0.0,"summary":"2 sentences max."}`;

  console.log('[FocusedEnrichment] Stage 1: Classification and physical verification...');

  let response: any;
  let text = '';
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[FocusedEnrichment] Stage 1 API call attempt ${attempt}/${maxRetries}...`);

    try {
      response = await rateLimiters.gemini.execute(() => streamGeminiResponse(client, prompt, { tools: [{ googleSearch: {} }], thinkingLevel: 'MINIMAL', latLng: propertyLatLng(property) }));

      text = response.text?.trim() || '';
      console.log('[FocusedEnrichment] Stage 1 response length:', text.length, 'chars');

      if (text) {
        break;
      }

      console.warn(`[FocusedEnrichment] Empty response from Gemini in Stage 1 (attempt ${attempt})`);
      if (response.candidates) {
        console.warn('[FocusedEnrichment] Candidates:', JSON.stringify(response.candidates, null, 2).substring(0, 500));
      }
    } catch (apiError) {
      const errMsg = apiError instanceof Error ? apiError.message : String(apiError);
      const { retryable, isDeadline, isStreamDisconnect } = isRetryableGeminiError(errMsg);

      console.warn(`[FocusedEnrichment] Stage 1 attempt ${attempt} error (retryable=${retryable}, deadline=${isDeadline}, streamDisconnect=${isStreamDisconnect}): ${errMsg.substring(0, 200)}`);

      if (!retryable || attempt >= maxRetries) {
        throw apiError;
      }
    }

    if (attempt < maxRetries) {
      const isDeadline = text === '' || (response === undefined);
      const baseMs = isDeadline ? 5000 : 1000;
      const backoffMs = Math.min(baseMs * Math.pow(2, attempt - 1), 15000);
      console.log(`[FocusedEnrichment] Retrying Stage 1 in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  if (!text) {
    console.error('[FocusedEnrichment] Stage 1 failed after all retries - returning empty result');
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'classify-property',
      entityType: 'property',
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

  const sources = extractGroundedSources(response);
  const parsed = parseJsonResponse(text);

  try {
    validateStage1Schema(parsed);
  } catch (schemaErr) {
    console.warn(`[FocusedEnrichment] Stage 1 schema validation failed: ${schemaErr instanceof Error ? schemaErr.message : schemaErr}`);
    console.warn(`[FocusedEnrichment] Stage 1 raw response: ${text.substring(0, 300)}`);
  }

  trackCostFireAndForget({
    provider: 'gemini',
    endpoint: 'classify-property',
    entityType: 'property',
    success: true,
    metadata: { sourcesCount: sources.length },
  });

  console.log(`[FocusedEnrichment] Stage 1 complete with ${sources.length} grounded sources`);

  const aiClass = parsed.class ?? parsed.property_class ?? null;
  const aiClassConfidence = parsed.cc ?? parsed.property_class_confidence ?? null;
  const finalClass = aiClass || classEstimate.propertyClass;
  const finalClassConfidence = aiClass ? (aiClassConfidence ?? 0.7) : classEstimate.confidence;

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
  };
}
