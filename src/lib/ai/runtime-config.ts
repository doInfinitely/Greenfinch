import * as fs from 'fs';
import * as path from 'path';
import { GEMINI_MODEL } from '../constants';
import type { LLMProvider } from './llm/types';

const CONFIG_FILE = path.join(process.cwd(), 'ai-stage-config.json');

export type ThinkingLevel = 'NONE' | 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface StageConfig {
  provider: LLMProvider;
  model: string;
  searchGrounding: boolean;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  dynamicThreshold: number;
  maxRetries: number;
  timeoutMs: number;
}

export type StageKey =
  | 'stage1_classify'
  | 'stage2_ownership'
  | 'stage3_contacts'
  | 'summary_cleanup'
  | 'replacement_search'
  | 'domain_retry';

export const STAGE_LABELS: Record<StageKey, string> = {
  stage1_classify: 'Stage 1 — Classification',
  stage2_ownership: 'Stage 2 — Ownership',
  stage3_contacts: 'Stage 3 — Contacts',
  summary_cleanup: 'Summary Cleanup',
  replacement_search: 'Replacement Search',
  domain_retry: 'Domain Retry',
};

export const AVAILABLE_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
] as const;

export const AVAILABLE_MODELS_BY_PROVIDER: Record<LLMProvider, readonly string[]> = {
  gemini: AVAILABLE_MODELS,
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
  claude: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514'],
} as const;

/**
 * Thinking levels supported by each model, based on official Vertex AI docs.
 *
 * gemini-3-flash-preview : MINIMAL | LOW | MEDIUM | HIGH  (always thinks — no NONE)
 * gemini-3-pro-preview   : LOW | HIGH only               (no NONE, MINIMAL, or MEDIUM)
 * gemini-2.5-*           : NONE | MINIMAL | LOW | MEDIUM | HIGH
 * gemini-2.0-*           : NONE only (no thinking support)
 */
export const MODEL_THINKING_LEVELS: Record<string, ThinkingLevel[]> = {
  'gemini-3-flash-preview': ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  'gemini-3-pro-preview':   ['LOW', 'HIGH'],
  'gemini-2.5-flash':       ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  'gemini-2.5-pro':         ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  'gemini-2.0-flash':       ['NONE'],
  'gemini-2.0-flash-lite':  ['NONE'],
};

/** Default thinking level to use when the current level is invalid for a new model. */
export function clampThinkingLevel(model: string, level: ThinkingLevel): ThinkingLevel {
  const valid = MODEL_THINKING_LEVELS[model];
  if (!valid) return level;
  if (valid.includes(level)) return level;
  // Pick the closest valid level by preference order
  const preference: ThinkingLevel[] = ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
  const levelIdx = preference.indexOf(level);
  // Walk down from current level to find nearest valid lower level
  for (let i = levelIdx; i >= 0; i--) {
    if (valid.includes(preference[i])) return preference[i];
  }
  // Walk up if nothing lower works
  for (let i = levelIdx + 1; i < preference.length; i++) {
    if (valid.includes(preference[i])) return preference[i];
  }
  return valid[0];
}

export type RuntimeConfig = Record<StageKey, StageConfig>;

function defaultStageConfig(overrides?: Partial<StageConfig>): StageConfig {
  return {
    provider: 'gemini',
    model: GEMINI_MODEL,
    searchGrounding: true,
    thinkingLevel: 'MINIMAL',
    temperature: 1.0,
    dynamicThreshold: 0.3,
    maxRetries: 3,
    timeoutMs: 120_000,
    ...overrides,
  };
}

const FACTORY_DEFAULTS: RuntimeConfig = {
  stage1_classify: defaultStageConfig({ thinkingLevel: 'MINIMAL', maxRetries: 3, timeoutMs: 90_000 }),
  stage2_ownership: defaultStageConfig({ thinkingLevel: 'LOW', maxRetries: 3, timeoutMs: 120_000 }),
  stage3_contacts: defaultStageConfig({ thinkingLevel: 'MEDIUM', maxRetries: 3, timeoutMs: 120_000 }),
  summary_cleanup: defaultStageConfig({ thinkingLevel: 'MINIMAL', temperature: 0.2, searchGrounding: false, maxRetries: 1, timeoutMs: 60_000 }),
  replacement_search: defaultStageConfig({ thinkingLevel: 'MEDIUM', maxRetries: 3, timeoutMs: 60_000 }),
  domain_retry: defaultStageConfig({ thinkingLevel: 'MINIMAL', maxRetries: 1, timeoutMs: 60_000 }),
};

let _lastMtimeMs = 0;
let _cached: RuntimeConfig | null = null;

function loadConfig(): RuntimeConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const stat = fs.statSync(CONFIG_FILE);
      if (_cached && stat.mtimeMs === _lastMtimeMs) {
        return _cached;
      }
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
      const config = structuredClone(FACTORY_DEFAULTS);
      for (const key of Object.keys(FACTORY_DEFAULTS) as StageKey[]) {
        if (parsed[key]) {
          const merged = { ...FACTORY_DEFAULTS[key], ...parsed[key] };
          // Validate provider
          const validProviders: LLMProvider[] = ['gemini', 'openai', 'claude'];
          if (!validProviders.includes(merged.provider)) {
            console.warn(`[AIConfig] Stage ${key} has invalid provider "${merged.provider}", falling back to "gemini"`);
            merged.provider = 'gemini';
          }
          // Validate model against provider's available models
          const validModels = AVAILABLE_MODELS_BY_PROVIDER[merged.provider] || AVAILABLE_MODELS;
          if (!validModels.includes(merged.model)) {
            console.warn(`[AIConfig] Stage ${key} has unavailable model "${merged.model}" for provider "${merged.provider}", falling back to default "${FACTORY_DEFAULTS[key].model}"`);
            merged.model = FACTORY_DEFAULTS[key].model;
            merged.provider = FACTORY_DEFAULTS[key].provider;
          }
          config[key] = merged;
        }
      }
      _cached = config;
      _lastMtimeMs = stat.mtimeMs;
      return config;
    }
  } catch (e) {
    console.warn('[AIConfig] Failed to load config, using defaults:', e);
  }
  return structuredClone(FACTORY_DEFAULTS);
}

function saveConfig(config: RuntimeConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    const stat = fs.statSync(CONFIG_FILE);
    _cached = config;
    _lastMtimeMs = stat.mtimeMs;
  } catch (e) {
    console.error('[AIConfig] Failed to save config:', e);
  }
}

export function getStageConfig(stage: StageKey): StageConfig {
  return loadConfig()[stage];
}

export function getAllStageConfigs(): RuntimeConfig {
  return structuredClone(loadConfig());
}

export function updateStageConfig(stage: StageKey, updates: Partial<StageConfig>): StageConfig {
  const config = loadConfig();
  const merged = { ...config[stage], ...updates };
  merged.thinkingLevel = clampThinkingLevel(merged.model, merged.thinkingLevel);
  config[stage] = merged;
  saveConfig(config);
  console.log(`[AIConfig] Updated ${stage}:`, JSON.stringify(config[stage]));
  return config[stage];
}

export function updateAllStageConfigs(newConfig: RuntimeConfig): RuntimeConfig {
  const config = structuredClone(FACTORY_DEFAULTS);
  for (const key of Object.keys(FACTORY_DEFAULTS) as StageKey[]) {
    if (newConfig[key]) {
      const merged = { ...FACTORY_DEFAULTS[key], ...newConfig[key] };
      merged.thinkingLevel = clampThinkingLevel(merged.model, merged.thinkingLevel);
      config[key] = merged;
    }
  }
  saveConfig(config);
  console.log('[AIConfig] Bulk updated all stages');
  return config;
}

export function resetToDefaults(): RuntimeConfig {
  const config = structuredClone(FACTORY_DEFAULTS);
  saveConfig(config);
  console.log('[AIConfig] Reset all stages to factory defaults');
  return config;
}

export function getFactoryDefaults(): RuntimeConfig {
  return structuredClone(FACTORY_DEFAULTS);
}
