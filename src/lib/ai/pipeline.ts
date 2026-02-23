// ============================================================================
// AI Enrichment — Pipeline Orchestrator
// Runs the full enrichment pipeline (Stage 1 → 2 → 3) with checkpoint-based
// resumption so partial results survive failures.
// ============================================================================

import type { CommercialProperty } from "../snowflake";
import type {
  StageResult, PropertyPhysicalData, PropertyClassification,
  OwnershipInfo, DiscoveredContact, FocusedEnrichmentResult,
  EnrichmentStageCheckpoint
} from './types';
import { EnrichmentStageError } from './errors';
import { classifyAndVerifyProperty } from './stages/classify';
import { identifyOwnership } from './stages/ownership';
import { discoverContacts } from './stages/contacts';

export async function runFocusedEnrichment(
  property: CommercialProperty,
  checkpoint?: EnrichmentStageCheckpoint | null
): Promise<FocusedEnrichmentResult & { checkpoint: EnrichmentStageCheckpoint }> {
  const startTotal = Date.now();
  const timing: Record<string, number> = { ...(checkpoint?.timing || {}) };
  let physical: StageResult<PropertyPhysicalData>;
  let classification: StageResult<PropertyClassification>;
  let ownership: StageResult<OwnershipInfo>;
  let contacts: StageResult<{ contacts: DiscoveredContact[] }>;
  let contactIdentificationMs = 0;
  let contactEnrichmentMs = 0;

  if (checkpoint?.classification && checkpoint?.physical) {
    classification = checkpoint.classification;
    physical = checkpoint.physical;
    console.log('[FocusedEnrichment] Resuming from checkpoint - skipping Stage 1 (classification)');
  } else {
    try {
      const startStage1 = Date.now();
      const stage1Result = await classifyAndVerifyProperty(property);
      const stage1Ms = Date.now() - startStage1;
      timing.physicalMs = stage1Ms;
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
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new EnrichmentStageError(errMsg, 'classification', {
        lastCompletedStage: null,
        timing,
        failedStage: 'classification',
        failureError: errMsg,
      });
    }
  }

  if (checkpoint?.ownership) {
    ownership = checkpoint.ownership;
    console.log('[FocusedEnrichment] Resuming from checkpoint - skipping Stage 2 (ownership)');
  } else {
    try {
      const startOwnership = Date.now();
      ownership = await identifyOwnership(property, classification.data);
      const ownershipMs = Date.now() - startOwnership;
      timing.ownershipMs = ownershipMs;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
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

  if (checkpoint?.contacts) {
    contacts = checkpoint.contacts;
    console.log('[FocusedEnrichment] Resuming from checkpoint - skipping Stage 3 (contacts)');
  } else {
    try {
      const startContacts = Date.now();
      const contactsResult = await discoverContacts(property, classification.data, ownership.data);
      const contactsMs = Date.now() - startContacts;
      timing.contactsMs = contactsMs;
      timing.contactIdentificationMs = contactsResult.contactIdentificationMs;
      timing.contactEnrichmentMs = contactsResult.contactEnrichmentMs;
      contactIdentificationMs = contactsResult.contactIdentificationMs;
      contactEnrichmentMs = contactsResult.contactEnrichmentMs;

      contacts = {
        data: contactsResult.data,
        summary: contactsResult.summary,
        sources: contactsResult.sources,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
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

  const totalMs = Date.now() - startTotal;
  timing.totalMs = totalMs;

  console.log(`[FocusedEnrichment] All stages complete in ${totalMs}ms (3a: ${contactIdentificationMs}ms, 3b: ${contactEnrichmentMs}ms)`);

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
    checkpoint: {
      lastCompletedStage: 'contacts',
      classification,
      physical,
      ownership,
      contacts,
      timing,
    },
  };
}
