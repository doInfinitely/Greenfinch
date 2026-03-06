// ============================================================================
// AI Enrichment — Utility AI Functions
//
// Two standalone LLM calls that don't fit into the main 3-stage pipeline:
//
//   cleanupAISummary          – Polishes raw enrichment summaries into
//                               readable prose (lower temperature for
//                               deterministic output).
//   searchForReplacementContact – Searches the web for a replacement when
//                               a contact's job_change_detected flag fires.
// ============================================================================

import { stripInternalMessages } from '../helpers';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import {
  THINKING_LEVELS, STAGE_MODELS, STAGE_TEMPERATURES, STAGE_TIMEOUTS, RETRIES,
} from '../config';
import { getStageConfig } from '../runtime-config';
import { getLLMAdapter } from '../llm';

/**
 * Rewrite a raw enrichment summary into a polished, user-facing paragraph.
 *
 * Uses a lower temperature (CLEANUP_TEMPERATURE = 0.1) for consistent,
 * deterministic output.  Falls back to regex-based cleanup if the LLM fails.
 */
export async function cleanupAISummary(rawSummary: string): Promise<string> {
  if (!rawSummary || rawSummary.trim().length === 0) {
    return '';
  }

  const preCleaned = stripInternalMessages(rawSummary);
  if (!preCleaned || preCleaned.length < 10) {
    return '';
  }

  const stageConfig = getStageConfig('summary_cleanup');
  const adapter = getLLMAdapter(stageConfig.provider);

  const prompt = `You are an editor polishing a research summary for greenfinch.ai, a commercial real estate prospecting tool.

Edit the following research summary into a flowing, natural paragraph:
1. Combine information into 3-4 sentences that read naturally as a cohesive paragraph
2. Remove citation numbers like [1], [2], etc. - just integrate the information smoothly
3. Remove any system references, error messages, or technical debug info
4. Focus on key facts: property type, ownership, management, and notable features
5. Write in professional but conversational tone - avoid bullet points or fragmented phrases
6. Do NOT truncate or cut off mid-sentence - complete each thought naturally

IMPORTANT: Return ONLY the polished paragraph. No explanations, no markdown, no quotes.

Raw summary to polish:
${preCleaned}`;

  try {
    const response = await adapter.call(prompt, {
      model: STAGE_MODELS.SUMMARY_CLEANUP,
      temperature: STAGE_TEMPERATURES.SUMMARY_CLEANUP,
      thinkingLevel: THINKING_LEVELS.SUMMARY_CLEANUP,
      timeoutMs: STAGE_TIMEOUTS.SUMMARY_CLEANUP,
      stageName: 'summary-cleanup',
      searchGrounding: false,
    });

    const cleaned = response.text?.trim() || preCleaned;
    console.log(`[FocusedEnrichment] Summary cleaned: ${rawSummary.length} chars -> ${cleaned.length} chars`);
    trackCostFireAndForget({
      provider: stageConfig.provider,
      endpoint: 'cleanup-summary',
      entityType: 'property',
      success: true,
    });
    return cleaned;
  } catch (error) {
    trackCostFireAndForget({
      provider: stageConfig.provider,
      endpoint: 'cleanup-summary',
      entityType: 'property',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.warn('[FocusedEnrichment] Summary cleanup failed, using regex fallback:', error instanceof Error ? error.message : error);
    return stripInternalMessages(rawSummary);
  }
}

/**
 * Search the web for a replacement person when a contact has left their role.
 *
 * Called by the job-change detection system when PDL data shows someone is
 * no longer at their employer.  Returns the new person's name/title/email
 * or null if no replacement is found.
 */
function isRetryableReplacementError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('quota') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE')
  );
}

export async function searchForReplacementContact(
  roleDesc: string,
  company: string,
  propertyAddress?: string
): Promise<{ name: string | null; title: string | null; email: string | null; company: string } | null> {
  const stageConfig = getStageConfig('replacement_search');
  const adapter = getLLMAdapter(stageConfig.provider);
  const maxAttempts = RETRIES.REPLACEMENT_SEARCH + 1;

  const addressContext = propertyAddress ? ` at ${propertyAddress}` : '';
  const prompt = `Search the web to find the current ${roleDesc}${addressContext} for ${company}. The previous person in this role has left. I need the name and title of their replacement. Return ONLY valid JSON.

{
  "name": "Full Name | null",
  "title": "Job Title | null",
  "email": "email@domain.com | null",
  "company": "${company}"
}

If you cannot find a replacement, return {"name": null}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await adapter.call(prompt, {
        model: STAGE_MODELS.REPLACEMENT_SEARCH,
        temperature: STAGE_TEMPERATURES.REPLACEMENT_SEARCH,
        thinkingLevel: THINKING_LEVELS.REPLACEMENT_SEARCH,
        timeoutMs: STAGE_TIMEOUTS.REPLACEMENT_SEARCH,
        stageName: 'replacement-search',
        searchGrounding: stageConfig.searchGrounding,
      });

      const text = response.text?.trim() || '';
      if (!text) {
        trackCostFireAndForget({
          provider: stageConfig.provider,
          endpoint: 'replacement-search',
          entityType: 'contact',
          success: false,
          errorMessage: 'Empty response',
        });
        return null;
      }

      let parsed: any;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        trackCostFireAndForget({
          provider: stageConfig.provider,
          endpoint: 'replacement-search',
          entityType: 'contact',
          success: false,
          errorMessage: 'Parse error',
        });
        return null;
      }

      trackCostFireAndForget({
        provider: stageConfig.provider,
        endpoint: 'replacement-search',
        entityType: 'contact',
        success: true,
        metadata: { found: !!parsed?.name, role: roleDesc, company },
      });

      if (!parsed?.name) return null;
      return { name: parsed.name, title: parsed.title || null, email: parsed.email || null, company: parsed.company || company };

    } catch (error) {
      const retryable = isRetryableReplacementError(error);
      const errMsg = error instanceof Error ? error.message : String(error);

      if (!retryable || attempt >= maxAttempts) {
        trackCostFireAndForget({
          provider: stageConfig.provider,
          endpoint: 'replacement-search',
          entityType: 'contact',
          success: false,
          errorMessage: errMsg,
        });
        console.error(`[ReplacementSearch] LLM error (attempt ${attempt}/${maxAttempts}, giving up): ${errMsg}`);
        return null;
      }

      const backoffMs = Math.min(2_000 * Math.pow(2, attempt - 1), 16_000);
      console.warn(`[ReplacementSearch] Retryable error (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms: ${errMsg}`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  return null;
}
