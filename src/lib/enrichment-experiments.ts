// ============================================================================
// Enrichment A/B Experiments
//
// Deterministic hash-based routing between V1 (legacy) and V2 (new) cascade
// enrichment pipelines. Configurable traffic percentage for gradual rollout.
//
// Usage:
//   if (shouldUseNewPipeline(propertyKey)) { ... V2 ... } else { ... V1 ... }
// ============================================================================

const DEFAULT_NEW_PIPELINE_PERCENTAGE = 0; // Start at 0%, increase gradually

/** Environment-configurable traffic percentage for new pipeline (0-100). */
function getNewPipelinePercentage(): number {
  const envVal = process.env.ENRICHMENT_V2_PERCENTAGE;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  }
  return DEFAULT_NEW_PIPELINE_PERCENTAGE;
}

/**
 * Simple hash function for deterministic routing.
 * Same propertyKey always routes to the same pipeline.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Determine whether a property should use the new cascade pipeline.
 * Uses deterministic hashing so the same property always gets the same result.
 */
export function shouldUseNewPipeline(propertyKey: string): boolean {
  const percentage = getNewPipelinePercentage();
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  const hash = hashString(propertyKey) % 100;
  return hash < percentage;
}

/**
 * Force the new pipeline for a specific property (testing/debug).
 */
export function shouldForceNewPipeline(): boolean {
  return process.env.ENRICHMENT_FORCE_V2 === 'true';
}

/**
 * Check if side-by-side comparison mode is enabled.
 * When enabled, both V1 and V2 run and results are compared.
 */
export function isComparisonModeEnabled(): boolean {
  return process.env.ENRICHMENT_COMPARISON_MODE === 'true';
}

/**
 * Get experiment metadata for logging.
 */
export function getExperimentInfo(propertyKey: string): {
  pipelineVersion: 'v1' | 'v2';
  percentage: number;
  comparisonMode: boolean;
  forced: boolean;
} {
  const forced = shouldForceNewPipeline();
  const useNew = forced || shouldUseNewPipeline(propertyKey);
  return {
    pipelineVersion: useNew ? 'v2' : 'v1',
    percentage: getNewPipelinePercentage(),
    comparisonMode: isComparisonModeEnabled(),
    forced,
  };
}
