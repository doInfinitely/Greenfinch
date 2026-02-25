import * as fs from 'fs';
import * as path from 'path';
import { GEMINI_MODEL } from '../constants';

const CONFIG_FILE = path.join(process.cwd(), 'ai-stage-config.json');

export type ThinkingLevel = 'NONE' | 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface StageConfig {
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

export type RuntimeConfig = Record<StageKey, StageConfig>;

function defaultStageConfig(overrides?: Partial<StageConfig>): StageConfig {
  return {
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
  replacement_search: defaultStageConfig({ thinkingLevel: 'MEDIUM', maxRetries: 1, timeoutMs: 60_000 }),
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
      const validModels: readonly string[] = AVAILABLE_MODELS;
      for (const key of Object.keys(FACTORY_DEFAULTS) as StageKey[]) {
        if (parsed[key]) {
          const merged = { ...FACTORY_DEFAULTS[key], ...parsed[key] };
          if (!validModels.includes(merged.model)) {
            console.warn(`[AIConfig] Stage ${key} has unavailable model "${merged.model}", falling back to default "${FACTORY_DEFAULTS[key].model}"`);
            merged.model = FACTORY_DEFAULTS[key].model;
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
  config[stage] = { ...config[stage], ...updates };
  saveConfig(config);
  console.log(`[AIConfig] Updated ${stage}:`, JSON.stringify(config[stage]));
  return config[stage];
}

export function updateAllStageConfigs(newConfig: RuntimeConfig): RuntimeConfig {
  const config = structuredClone(FACTORY_DEFAULTS);
  for (const key of Object.keys(FACTORY_DEFAULTS) as StageKey[]) {
    if (newConfig[key]) {
      config[key] = { ...FACTORY_DEFAULTS[key], ...newConfig[key] };
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
