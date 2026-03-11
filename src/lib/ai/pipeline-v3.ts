// ============================================================================
// AI Enrichment — Pipeline V3 Orchestrator
//
// Runs the full V3 enrichment pipeline in sequence:
//   Stage 1 (classify) → Stage 2/2R (ownership) → Stage 3 (contacts)
//
// Key differences from V1 pipeline:
//   - Accepts MarketConfig for multi-market support (no hardcoded geography)
//   - Branches on property type: commercial → Stage 2, residential → Stage 2R
//   - Passes market config to all stages for parameterized prompts/PDL queries
//   - Supports checkpoint-based resumption (same pattern as V1)
// ============================================================================

import type { CommercialProperty } from '../property-types';
import type { MarketConfig } from '../markets/types';
import type {
  StageResult, PropertyPhysicalData, PropertyClassification,
  OwnershipInfo, DiscoveredContact, FocusedEnrichmentResult,
  EnrichmentStageCheckpoint, StageMetadata
} from './types';
import { EnrichmentStageError } from './errors';
import { classifyAndVerifyProperty } from './stages/classify';
import { identifyOwnership } from './stages/ownership';
import { identifyResidentialOwner } from './stages/residential-owner';
import { discoverContacts } from './stages/contacts';
import { runWithCallLog, getGeminiCallLog } from './client';

/** Property type classification used for pipeline branching. */
type PropertyType = 'commercial' | 'residential';

/**
 * Determine whether a property should take the residential or commercial path.
 * Uses the DCAD division code + SPTD code as primary signals.
 */
function classifyPropertyType(property: CommercialProperty): PropertyType {
  // DCAD divisionCd: 'RES' = residential, 'COM' = commercial
  if (property.divisionCd === 'RES') return 'residential';
  if (property.divisionCd === 'COM') return 'commercial';

  // SPTD code fallback: B11 = apartments/multifamily (treat as commercial)
  // A* = residential, F* = commercial/industrial
  if (property.sptdCode?.startsWith('A')) return 'residential';

  return 'commercial';
}

/**
 * Run the complete V3 AI enrichment pipeline for a single property.
 *
 * @param property    – Raw property record from CAD staging data
 * @param market      – Market configuration for geography parameterization
 * @param checkpoint  – Optional checkpoint from a previous failed run
 * @returns Full enrichment result plus a new checkpoint
 */
export async function runFocusedEnrichmentV3(
  property: CommercialProperty,
  market: MarketConfig,
  checkpoint?: EnrichmentStageCheckpoint | null
): Promise<FocusedEnrichmentResult & { checkpoint: EnrichmentStageCheckpoint }> {
  return runWithCallLog(async () => {
    const startTotal = Date.now();
    const timing: Record<string, number> = { ...(checkpoint?.timing || {}) };
    let physical: StageResult<PropertyPhysicalData>;
    let classification: StageResult<PropertyClassification>;
    let ownership: StageResult<OwnershipInfo>;
    let contacts: StageResult<{ contacts: DiscoveredContact[] }>;
    let contactIdentificationMs = 0;
    let contactEnrichmentMs = 0;
    const stageMetadata: { classify?: StageMetadata; ownership?: StageMetadata; contacts?: StageMetadata } = {};

    const propertyType = classifyPropertyType(property);
    console.log(`[PipelineV3] Property type: ${propertyType} (divisionCd=${property.divisionCd}, sptdCode=${property.sptdCode})`);

    // ---- Stage 1: Classification & Physical Verification --------------------
    if (checkpoint?.classification && checkpoint?.physical) {
      classification = checkpoint.classification;
      physical = checkpoint.physical;
      console.log('[PipelineV3] Resuming from checkpoint — skipping Stage 1');
    } else {
      try {
        const startStage1 = Date.now();
        const stage1Result = await classifyAndVerifyProperty(property, { market });
        timing.physicalMs = Date.now() - startStage1;
        timing.classificationMs = 0;

        physical = {
          data: stage1Result.data.physical,
          summary: stage1Result.summary,
          sources: stage1Result.sources,
        };
        classification = {
          data: stage1Result.data.classification,
          summary: stage1Result.summary,
          sources: stage1Result.sources,
        };
        if (stage1Result.metadata) stageMetadata.classify = stage1Result.metadata;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logCostSummary(property);
        throw new EnrichmentStageError(errMsg, 'classification', {
          lastCompletedStage: null,
          timing,
          failedStage: 'classification',
          failureError: errMsg,
        });
      }
    }

    // ---- Stage 2 / 2R: Ownership (branches on property type) ----------------
    if (checkpoint?.ownership) {
      ownership = checkpoint.ownership;
      console.log('[PipelineV3] Resuming from checkpoint — skipping Stage 2');
    } else {
      try {
        const startOwnership = Date.now();

        if (propertyType === 'residential' && market.residentialEnabled) {
          // Stage 2R: Simplified residential owner lookup
          ownership = await identifyResidentialOwner(property, classification.data, { market });
        } else {
          // Stage 2: Full commercial ownership search
          ownership = await identifyOwnership(property, classification.data, { market });
        }

        timing.ownershipMs = Date.now() - startOwnership;
        if (ownership.metadata) stageMetadata.ownership = ownership.metadata;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logCostSummary(property);
        throw new EnrichmentStageError(errMsg, 'ownership', {
          lastCompletedStage: 'classification',
          classification,
          physical,
          timing,
          failedStage: 'ownership',
          failureError: errMsg,
        });
      }
    }

    // ---- Stage 3: Contact Discovery -----------------------------------------
    if (checkpoint?.contacts) {
      contacts = checkpoint.contacts;
      console.log('[PipelineV3] Resuming from checkpoint — skipping Stage 3');
    } else {
      try {
        const startContacts = Date.now();
        const contactsResult = await discoverContacts(property, classification.data, ownership.data, { market });
        timing.contactsMs = Date.now() - startContacts;
        timing.contactIdentificationMs = contactsResult.contactIdentificationMs;
        timing.contactEnrichmentMs = contactsResult.contactEnrichmentMs;
        contactIdentificationMs = contactsResult.contactIdentificationMs;
        contactEnrichmentMs = contactsResult.contactEnrichmentMs;

        contacts = {
          data: contactsResult.data,
          summary: contactsResult.summary,
          sources: contactsResult.sources,
        };
        if (contactsResult.metadata) stageMetadata.contacts = contactsResult.metadata;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logCostSummary(property);
        throw new EnrichmentStageError(errMsg, 'contacts', {
          lastCompletedStage: 'ownership',
          classification,
          physical,
          ownership,
          timing,
          failedStage: 'contacts',
          failureError: errMsg,
        });
      }
    }

    // ---- All stages complete ------------------------------------------------
    const totalMs = Date.now() - startTotal;
    timing.totalMs = totalMs;

    logCostSummary(property);
    console.log(`[PipelineV3] All stages complete in ${totalMs}ms (type=${propertyType})`);

    return {
      propertyKey: property.parcelId || property.accountNum,
      physical,
      classification,
      ownership,
      contacts,
      timing: {
        physicalMs: (timing.physicalMs as number) || 0,
        classificationMs: 0,
        ownershipMs: (timing.ownershipMs as number) || 0,
        contactsMs: (timing.contactsMs as number) || 0,
        contactIdentificationMs,
        contactEnrichmentMs,
        totalMs,
      },
      stageMetadata: Object.keys(stageMetadata).length > 0 ? stageMetadata : undefined,
      checkpoint: {
        lastCompletedStage: 'contacts',
        classification,
        physical,
        ownership,
        contacts,
        timing,
      },
    };
  });
}

function logCostSummary(property: CommercialProperty): void {
  const callLog = getGeminiCallLog();
  if (callLog.length === 0) return;

  const totalCalls = callLog.length;
  const errorCalls = callLog.filter(c => c.error).length;
  const searchCalls = callLog.filter(c => c.searchGroundingUsed).length;
  const totalQueries = callLog.reduce((acc, c) => acc + c.searchGroundingQueryCount, 0);
  const totals = callLog.reduce((acc, c) => ({
    prompt: acc.prompt + c.promptTokens,
    response: acc.response + c.responseTokens,
    thinking: acc.thinking + c.thinkingTokens,
    total: acc.total + c.totalTokens,
    cost: acc.cost + c.costUsd,
    groundingCost: acc.groundingCost + c.searchGroundingCostUsd,
  }), { prompt: 0, response: 0, thinking: 0, total: 0, cost: 0, groundingCost: 0 });

  const propId = property.parcelId || property.accountNum;
  console.log(`\n========== V3 COST SUMMARY for ${propId} ==========`);
  console.log(`Calls: ${totalCalls} total (${errorCalls} errors, ${searchCalls} with search grounding, ${totalQueries} total queries)`);
  for (const c of callLog) {
    const gNote = c.searchGroundingUsed ? ` [${c.searchGroundingQueryCount}q=$${c.searchGroundingCostUsd.toFixed(4)}]` : '';
    console.log(`  ${c.error ? 'ERR' : 'OK '} ${c.stageName.padEnd(35)} prompt=${String(c.promptTokens).padStart(7)} resp=${String(c.responseTokens).padStart(7)} think=${String(c.thinkingTokens).padStart(7)} total=${String(c.totalTokens).padStart(7)} cost=$${c.costUsd.toFixed(6)}${gNote}`);
  }
  console.log(`TOTALS:${' '.repeat(36)} prompt=${String(totals.prompt).padStart(7)} resp=${String(totals.response).padStart(7)} think=${String(totals.thinking).padStart(7)} total=${String(totals.total).padStart(7)} cost=$${totals.cost.toFixed(6)} (grounding=${totalQueries}q=$${totals.groundingCost.toFixed(4)})`);
  console.log(`==========================================================\n`);
}
