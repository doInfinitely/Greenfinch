import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { propertyPipeline } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { increment, expire } from '@/lib/redis';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { computeClaudeCostUsd } from '@/lib/pricing-config';
import { buildSystemPrompt } from '@/lib/support/system-prompt';
import {
  getOrCreateSession,
  appendMessage,
  getContextMessages,
} from '@/lib/support/chat-session';
import type { ChatMessage } from '@/lib/support/types';

let _client: Anthropic | null = null;
function getClaudeClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

const MODEL = 'claude-sonnet-4-20250514';
const RATE_LIMIT_KEY_PREFIX = 'gf:support-ratelimit:';
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60; // seconds

export async function POST(request: NextRequest) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = await getSession();
    if (!session) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Rate limiting
    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}${session.user.id}`;
    const count = await increment(rateLimitKey);
    if (count === 1) {
      await expire(rateLimitKey, RATE_LIMIT_WINDOW);
    }
    if (count > RATE_LIMIT_MAX) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { message, sessionId } = body as { message: string; sessionId: string };

    if (!message?.trim() || !sessionId) {
      return new Response(JSON.stringify({ error: 'Missing message or sessionId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load or create chat session
    const chatSession = await getOrCreateSession(
      session.user.id,
      sessionId,
      authData.orgId,
    );

    // Append user message
    const userMessage: ChatMessage = {
      role: 'user',
      content: message.trim(),
      timestamp: Date.now(),
    };
    await appendMessage(session.user.id, sessionId, userMessage);

    // Fetch account context for system prompt (pipeline is org-scoped)
    const [pipelineCountResult] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(propertyPipeline)
        .where(eq(propertyPipeline.clerkOrgId, authData.orgId)),
    ]);

    const systemPrompt = buildSystemPrompt({
      userName: [session.user.firstName, session.user.lastName].filter(Boolean).join(' ') || 'User',
      userEmail: session.user.email,
      orgName: authData.orgSlug || null,
      role: session.user.role,
      propertyCount: pipelineCountResult[0]?.count ?? 0,
    });

    // Build messages for Claude
    const contextMessages = getContextMessages({
      ...chatSession,
      messages: [...chatSession.messages, userMessage],
    });

    const claudeMessages: Anthropic.MessageParam[] = contextMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Stream response
    const encoder = new TextEncoder();
    const client = getClaudeClient();

    const stream = new ReadableStream({
      async start(controller) {
        let fullText = '';
        let inputTokens = 0;
        let outputTokens = 0;

        try {
          const response = client.messages.stream({
            model: MODEL,
            max_tokens: 1024,
            temperature: 0.7,
            system: systemPrompt,
            messages: claudeMessages,
          });

          response.on('text', (text) => {
            fullText += text;
            const chunk = `data: ${JSON.stringify({ type: 'delta', text })}\n\n`;
            controller.enqueue(encoder.encode(chunk));
          });

          const finalMessage = await response.finalMessage();
          inputTokens = finalMessage.usage.input_tokens;
          outputTokens = finalMessage.usage.output_tokens;

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Stream error';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`),
          );
          controller.close();
          return;
        }

        // Save assistant message to session
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: fullText,
          timestamp: Date.now(),
        };
        await appendMessage(session.user.id, sessionId, assistantMessage);

        // Track cost
        const costUsd = computeClaudeCostUsd(MODEL, inputTokens, outputTokens);
        trackCostFireAndForget({
          provider: 'claude',
          endpoint: 'support-chat',
          costOverrideUsd: costUsd,
          entityType: 'support-chat',
          entityId: sessionId,
          triggeredBy: session.user.id,
          clerkOrgId: authData.orgId,
          success: true,
          metadata: { inputTokens, outputTokens },
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[SupportChat] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
