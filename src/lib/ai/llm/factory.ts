// ============================================================================
// LLM Provider Factory
//
// Returns the appropriate LLMProviderAdapter based on provider name.
// Reads from runtime config by default, can be overridden per-call.
// ============================================================================

import type { LLMProvider, LLMProviderAdapter } from './types';
import { GeminiAdapter } from './gemini-adapter';
import { OpenAIAdapter } from './openai-adapter';
import { ClaudeAdapter } from './claude-adapter';

// Singleton instances (adapters are stateless)
const adapters: Record<LLMProvider, LLMProviderAdapter> = {
  gemini: new GeminiAdapter(),
  openai: new OpenAIAdapter(),
  claude: new ClaudeAdapter(),
};

/**
 * Get an LLM adapter for the specified provider.
 * Defaults to 'gemini' if no provider is specified.
 */
export function getLLMAdapter(provider?: LLMProvider): LLMProviderAdapter {
  const p = provider || 'gemini';
  const adapter = adapters[p];
  if (!adapter) {
    throw new Error(`Unknown LLM provider: ${p}. Supported: ${Object.keys(adapters).join(', ')}`);
  }
  return adapter;
}
