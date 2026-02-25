'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, RotateCcw, Save, ChevronDown, Check, AlertTriangle, Cpu, Search, Thermometer, Brain, Repeat, Timer } from 'lucide-react';
import Link from 'next/link';

type ThinkingLevel = 'NONE' | 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

interface StageConfig {
  model: string;
  searchGrounding: boolean;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  dynamicThreshold: number;
  maxRetries: number;
  timeoutMs: number;
}

const TIMEOUT_PRESETS = [30_000, 60_000, 90_000, 120_000, 180_000];
function formatTimeout(ms: number): string {
  return `${ms / 1000}s`;
}

type StageKey = 'stage1_classify' | 'stage2_ownership' | 'stage3_contacts' | 'summary_cleanup' | 'replacement_search' | 'domain_retry';
type RuntimeConfig = Record<StageKey, StageConfig>;

const THINKING_LEVELS: ThinkingLevel[] = ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];

const THINKING_DESCRIPTIONS: Record<ThinkingLevel, string> = {
  NONE: 'No reasoning',
  MINIMAL: 'Fast, simple lookups',
  LOW: 'Balanced reasoning',
  MEDIUM: 'Multi-step research',
  HIGH: 'Deep analysis',
};

function isGemini3(model: string): boolean {
  return model.includes('gemini-3');
}

function supportsThinking(model: string): boolean {
  return /gemini-(2\.5-.+-preview|3[\.\-])/i.test(model);
}

function getModelFamily(model: string): string {
  if (model.includes('gemini-3')) return 'Gemini 3';
  if (model.includes('gemini-2.5')) return 'Gemini 2.5';
  if (model.includes('gemini-2.0')) return 'Gemini 2.0';
  return 'Unknown';
}

function getSearchGroundingNote(model: string): string {
  if (isGemini3(model)) return 'Gemini 3: $0.035 per search query';
  return 'Flat $0.035 per prompt when search is triggered';
}

export default function AIConfigPage() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [defaults, setDefaults] = useState<RuntimeConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [stageLabels, setStageLabels] = useState<Record<StageKey, string>>({} as any);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/ai-config', { credentials: 'include' });
      const json = await res.json();
      if (json.success) {
        setConfig(json.data.config);
        setDefaults(json.data.defaults);
        setAvailableModels([...json.data.availableModels]);
        setStageLabels(json.data.stageLabels);
        setDirty(false);
      }
    } catch (e) {
      console.error('Failed to fetch AI config:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const updateStage = (stage: StageKey, updates: Partial<StageConfig>) => {
    if (!config) return;
    const updated = { ...config, [stage]: { ...config[stage], ...updates } };

    if (updates.model) {
      const newModel = updates.model;
      updated[stage].thinkingLevel = 'NONE';
      if (!supportsThinking(newModel)) {
        updated[stage].temperature = 1.0;
      }
    }

    if (updates.thinkingLevel && updates.thinkingLevel !== 'NONE') {
      updated[stage].temperature = 1.0;
    }

    setConfig(updated);
    setDirty(true);
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/admin/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ config }),
      });
      const json = await res.json();
      if (json.success) {
        setConfig(json.data.config);
        setDirty(false);
        setSaveMessage({ type: 'success', text: 'Configuration saved' });
      } else {
        setSaveMessage({ type: 'error', text: json.error || 'Save failed' });
      }
    } catch (e) {
      setSaveMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/admin/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ resetToDefaults: true }),
      });
      const json = await res.json();
      if (json.success) {
        setConfig(json.data.config);
        setDirty(false);
        setSaveMessage({ type: 'success', text: 'Reset to defaults' });
      }
    } catch (e) {
      setSaveMessage({ type: 'error', text: 'Reset failed' });
    } finally {
      setSaving(false);
    }
  };

  const isModified = (stage: StageKey, field: keyof StageConfig): boolean => {
    if (!config || !defaults) return false;
    return config[stage][field] !== defaults[stage][field];
  };

  if (loading || !config) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto" data-testid="ai-config-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  const stageKeys = Object.keys(config) as StageKey[];
  const primaryStages = stageKeys.filter(k => ['stage1_classify', 'stage2_ownership', 'stage3_contacts'].includes(k));
  const utilityStages = stageKeys.filter(k => ['summary_cleanup', 'replacement_search', 'domain_retry'].includes(k));

  return (
    <div className="p-6 max-w-[1200px] mx-auto" data-testid="ai-config-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/admin" data-testid="link-back-admin">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> Admin</Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900" data-testid="text-page-title">AI Enrichment Config</h1>
            <p className="text-sm text-gray-500">Configure model, search grounding, thinking level, timeout, and retry settings per stage</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveMessage && (
            <span className={`text-sm px-3 py-1 rounded-full ${saveMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`} data-testid="text-save-message">
              {saveMessage.text}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchConfig} disabled={saving} data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={saving} data-testid="button-reset">
            <RotateCcw className="w-4 h-4 mr-1" /> Reset Defaults
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !dirty} data-testid="button-save">
            <Save className="w-4 h-4 mr-1" /> {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {dirty && (
        <div className="mb-4 px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2 text-sm text-yellow-800" data-testid="text-unsaved-warning">
          <AlertTriangle className="w-4 h-4" />
          You have unsaved changes. Changes take effect on the next enrichment run after saving.
        </div>
      )}

      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">Pipeline Stages</h2>
          <div className="space-y-3">
            {primaryStages.map(stage => (
              <StageCard
                key={stage}
                stageKey={stage}
                config={config[stage]}
                label={stageLabels[stage]}
                availableModels={availableModels}
                isModified={isModified}
                onUpdate={(updates) => updateStage(stage, updates)}
              />
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">Utility Stages</h2>
          <div className="space-y-3">
            {utilityStages.map(stage => (
              <StageCard
                key={stage}
                stageKey={stage}
                config={config[stage]}
                label={stageLabels[stage]}
                availableModels={availableModels}
                isModified={isModified}
                onUpdate={(updates) => updateStage(stage, updates)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StageCard({
  stageKey,
  config,
  label,
  availableModels,
  isModified,
  onUpdate,
}: {
  stageKey: StageKey;
  config: StageConfig;
  label: string;
  availableModels: string[];
  isModified: (stage: StageKey, field: keyof StageConfig) => boolean;
  onUpdate: (updates: Partial<StageConfig>) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const modelFamily = getModelFamily(config.model);
  const thinkingSupported = supportsThinking(config.model);
  const gem3 = isGemini3(config.model);

  const hasChanges = (['model', 'searchGrounding', 'thinkingLevel', 'temperature', 'maxRetries', 'timeoutMs'] as (keyof StageConfig)[])
    .some(f => isModified(stageKey, f));

  return (
    <div className={`border rounded-lg bg-white ${hasChanges ? 'border-yellow-300 ring-1 ring-yellow-200' : 'border-gray-200'}`} data-testid={`card-stage-${stageKey}`}>
      <button
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors rounded-t-lg"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-toggle-${stageKey}`}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-gray-900">{label}</span>
          <span className="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">{config.model}</span>
          {hasChanges && <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded">modified</span>}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            <div data-testid={`select-model-${stageKey}`}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1.5">
                <Cpu className="w-3.5 h-3.5" /> Model
                {isModified(stageKey, 'model') && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
              </label>
              <select
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                value={config.model}
                onChange={e => onUpdate({ model: e.target.value })}
              >
                {availableModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">{modelFamily}</p>
            </div>

            <div data-testid={`select-thinking-${stageKey}`}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1.5">
                <Brain className="w-3.5 h-3.5" /> Thinking Level
                {isModified(stageKey, 'thinkingLevel') && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
              </label>
              {thinkingSupported ? (
                <select
                  className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                  value={config.thinkingLevel}
                  onChange={e => onUpdate({ thinkingLevel: e.target.value as ThinkingLevel })}
                >
                  {THINKING_LEVELS.map(level => (
                    <option key={level} value={level}>{level} — {THINKING_DESCRIPTIONS[level]}</option>
                  ))}
                </select>
              ) : (
                <div className="w-full border border-gray-100 rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-400">
                  Not supported by this model
                </div>
              )}
              {thinkingSupported && config.thinkingLevel !== 'NONE' && (
                <p className="text-xs text-amber-600 mt-1">Temperature locked to 1.0 when thinking is enabled</p>
              )}
            </div>

            <div data-testid={`input-temperature-${stageKey}`}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1.5">
                <Thermometer className="w-3.5 h-3.5" /> Temperature
                {isModified(stageKey, 'temperature') && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={e => onUpdate({ temperature: parseFloat(e.target.value) })}
                  disabled={thinkingSupported && config.thinkingLevel !== 'NONE'}
                  className="flex-1 accent-green-600"
                />
                <span className="text-sm font-mono w-8 text-right">{config.temperature.toFixed(1)}</span>
              </div>
            </div>

            <div data-testid={`toggle-grounding-${stageKey}`}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1.5">
                <Search className="w-3.5 h-3.5" /> Search Grounding
                {isModified(stageKey, 'searchGrounding') && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
              </label>
              <button
                className={`w-full border rounded-md px-3 py-2 text-sm text-left flex items-center justify-between transition-colors ${
                  config.searchGrounding
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-gray-50 text-gray-500'
                }`}
                onClick={() => onUpdate({ searchGrounding: !config.searchGrounding })}
              >
                <span>{config.searchGrounding ? 'Enabled' : 'Disabled'}</span>
                {config.searchGrounding && <Check className="w-4 h-4" />}
              </button>
              <p className="text-xs text-gray-400 mt-1">{getSearchGroundingNote(config.model)}</p>
            </div>


            <div data-testid={`input-retries-${stageKey}`}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1.5">
                <Repeat className="w-3.5 h-3.5" /> Max Retries
                {isModified(stageKey, 'maxRetries') && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
              </label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    className={`w-9 h-9 rounded-md text-sm font-medium border transition-colors ${
                      config.maxRetries === n
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => onUpdate({ maxRetries: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div data-testid={`input-timeout-${stageKey}`}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1.5">
                <Timer className="w-3.5 h-3.5" /> Timeout per Attempt
                {isModified(stageKey, 'timeoutMs') && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
              </label>
              <div className="flex items-center gap-2">
                {TIMEOUT_PRESETS.map(ms => (
                  <button
                    key={ms}
                    className={`px-2.5 h-9 rounded-md text-sm font-medium border transition-colors ${
                      config.timeoutMs === ms
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => onUpdate({ timeoutMs: ms })}
                  >
                    {formatTimeout(ms)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
