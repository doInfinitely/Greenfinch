// ============================================================================
// AI Enrichment — Utility AI Functions
//
// Two standalone Gemini calls that don't fit into the main 3-stage pipeline:
//
//   cleanupAISummary          – Polishes raw enrichment summaries into
//                               readable prose (lower temperature for
//                               deterministic output).
//   searchForReplacementContact – Searches the web for a replacement when
//                               a contact's job_change_detected flag fires.
// ============================================================================

import { getGeminiClient, streamGeminiResponse, callGeminiWithTimeout } from '../client';
import { stripInternalMessages } from '../helpers';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import {
  CLEANUP_TEMPERATURE, THINKING_LEVELS, GOOGLE_SEARCH_TOOL,
} from '../config';

/**
 * Rewrite a raw enrichment summary into a polished, user-facing paragraph.
 *
 * Uses a lower temperature (CLEANUP_TEMPERATURE = 0.1) for consistent,
 * deterministic output.  Falls back to regex-based cleanup if Gemini fails.
 */
export async function cleanupAISummary(rawSummary: string): Promise<string> {
  if (!rawSummary || rawSummary.trim().length === 0) {
    return '';
  }
  
  const preCleaned = stripInternalMessages(rawSummary);
  if (!preCleaned || preCleaned.length < 10) {
    return '';
  }
  
  const client = getGeminiClient();
  
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
    const response = await callGeminiWithTimeout(
      () => streamGeminiResponse(client, prompt, {
        temperature: CLEANUP_TEMPERATURE,
        thinkingLevel: THINKING_LEVELS.SUMMARY_CLEANUP,
        stageName: 'summary-cleanup',
      }),
      1
    );
    
    const cleaned = response.text?.trim() || preCleaned;
    console.log(`[FocusedEnrichment] Summary cleaned: ${rawSummary.length} chars -> ${cleaned.length} chars`);
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'cleanup-summary',
      entityType: 'property',
      tokenUsage: response.tokenUsage,
      success: true,
    });
    return cleaned;
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
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
export async function searchForReplacementContact(
  roleDesc: string,
  company: string,
  propertyAddress?: string
): Promise<{ name: string | null; title: string | null; email: string | null; company: string } | null> {
  const client = getGeminiClient();

  const addressContext = propertyAddress ? ` at ${propertyAddress}` : '';
  const prompt = `Search the web to find the current ${roleDesc}${addressContext} for ${company}. The previous person in this role has left. I need the name and title of their replacement. Return ONLY valid JSON.

{
  "name": "Full Name | null",
  "title": "Job Title | null",
  "email": "email@domain.com | null",
  "company": "${company}"
}

If you cannot find a replacement, return {"name": null}`;

  try {
    const response = await callGeminiWithTimeout(
      () => streamGeminiResponse(client, prompt, {
        tools: GOOGLE_SEARCH_TOOL,
        thinkingLevel: THINKING_LEVELS.REPLACEMENT_SEARCH,
        stageName: 'replacement-search',
      }),
      1
    );

    const text = response.text?.trim() || '';
    if (!text) {
      trackCostFireAndForget({
        provider: 'gemini',
        endpoint: 'replacement-search',
        entityType: 'contact',
        tokenUsage: response.tokenUsage,
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
        provider: 'gemini',
        endpoint: 'replacement-search',
        entityType: 'contact',
        tokenUsage: response.tokenUsage,
        success: false,
        errorMessage: 'Parse error',
      });
      return null;
    }

    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'replacement-search',
      entityType: 'contact',
      tokenUsage: response.tokenUsage,
      success: true,
      metadata: { found: !!parsed?.name, role: roleDesc, company },
    });

    if (!parsed?.name) return null;
    return { name: parsed.name, title: parsed.title || null, email: parsed.email || null, company: parsed.company || company };
  } catch (error) {
    trackCostFireAndForget({
      provider: 'gemini',
      endpoint: 'replacement-search',
      entityType: 'contact',
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error(`[ReplacementSearch] Gemini error: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
