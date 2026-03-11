// ============================================================================
// Enrichment A/B Experiments
//
// Deterministic hash-based routing between V1 (legacy), V2, and V3 cascade
// enrichment pipelines. Configurable traffic percentage for gradual rollout.
//
// Routing priority: V3 checked first, then V2, then V1
//   ENRICHMENT_V3_PERCENTAGE → if not V3, check ENRICHMENT_V2_PERCENTAGE → V1
// ============================================================================

const DEFAULT_NEW_PIPELINE_PERCENTAGE = 100; // V2 pipeline active
const DEFAULT_V3_PIPELINE_PERCENTAGE = 0; // V3 pipeline off by default

/** Environment-configurable traffic percentage for V2 pipeline (0-100). */
function getNewPipelinePercentage(): number {
  const envVal = process.env.ENRICHMENT_V2_PERCENTAGE;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  }
  return DEFAULT_NEW_PIPELINE_PERCENTAGE;
}

/** Environment-configurable traffic percentage for V3 pipeline (0-100). */
function getV3PipelinePercentage(): number {
  const envVal = process.env.ENRICHMENT_V3_PERCENTAGE;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  }
  return DEFAULT_V3_PIPELINE_PERCENTAGE;
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
 * Determine whether a property should use the V3 pipeline.
 * V3 is checked first — if it matches, V2 is skipped.
 */
export function shouldUseV3Pipeline(propertyKey: string): boolean {
  const percentage = getV3PipelinePercentage();
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  // Use a different seed so V3 routing is independent of V2
  const hash = hashString('v3:' + propertyKey) % 100;
  return hash < percentage;
}

/**
 * Force the V3 pipeline (testing/debug).
 */
export function shouldForceV3Pipeline(): boolean {
  return process.env.ENRICHMENT_FORCE_V3 === 'true';
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
  pipelineVersion: 'v1' | 'v2' | 'v3';
  percentage: number;
  v3Percentage: number;
  comparisonMode: boolean;
  forced: boolean;
} {
  const forcedV3 = shouldForceV3Pipeline();
  const forcedV2 = shouldForceNewPipeline();

  let pipelineVersion: 'v1' | 'v2' | 'v3' = 'v1';
  if (forcedV3 || shouldUseV3Pipeline(propertyKey)) {
    pipelineVersion = 'v3';
  } else if (forcedV2 || shouldUseNewPipeline(propertyKey)) {
    pipelineVersion = 'v2';
  }

  return {
    pipelineVersion,
    percentage: getNewPipelinePercentage(),
    v3Percentage: getV3PipelinePercentage(),
    comparisonMode: isComparisonModeEnabled(),
    forced: forcedV2 || forcedV3,
  };
}
