import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { supportTickets, notifications, users } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { trackCostFireAndForget } from '@/lib/cost-tracker';
import { computeClaudeCostUsd } from '@/lib/pricing-config';
import {
  getSession as getChatSession,
  markEscalated,
} from '@/lib/support/chat-session';


let _client: Anthropic | null = null;
function getClaudeClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function POST(request: NextRequest) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, userSummary } = body as { sessionId: string; userSummary: string };

    if (!sessionId || !userSummary?.trim()) {
      return NextResponse.json({ error: 'Missing sessionId or summary' }, { status: 400 });
    }

    // Load chat session
    const chatSession = await getChatSession(session.user.id, sessionId);
    if (!chatSession || chatSession.messages.length === 0) {
      return NextResponse.json({ error: 'No chat session found' }, { status: 404 });
    }

    if (chatSession.escalated) {
      return NextResponse.json({ error: 'Already escalated' }, { status: 409 });
    }

    // Generate AI summary of transcript
    let aiSummary = '';
    try {
      const client = getClaudeClient();
      const transcriptText = chatSession.messages
        .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
        .join('\n\n');

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: `Summarize this support chat transcript in 2-3 sentences. Focus on the user's issue and what was discussed:\n\n${transcriptText}`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      aiSummary = textBlock?.text || '';

      const costUsd = computeClaudeCostUsd(
        'claude-sonnet-4',
        response.usage.input_tokens,
        response.usage.output_tokens,
      );
      trackCostFireAndForget({
        provider: 'claude',
        endpoint: 'support-chat-summary',
        costOverrideUsd: costUsd,
        entityType: 'support-ticket',
        entityId: sessionId,
        triggeredBy: session.user.id,
        clerkOrgId: authData.orgId,
        success: true,
        metadata: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      });
    } catch (err) {
      console.error('[SupportChat] AI summary failed:', err);
      aiSummary = 'AI summary unavailable';
    }

    // Create support ticket
    const [ticket] = await db.insert(supportTickets).values({
      clerkOrgId: authData.orgId,
      userId: session.user.id,
      subject: userSummary.trim().substring(0, 200),
      transcript: chatSession.messages,
      userSummary: userSummary.trim(),
      aiSummary,
      status: 'open',
      priority: 'medium',
    }).returning();

    // Mark session as escalated
    await markEscalated(session.user.id, sessionId);

    // Notify Greenfinch internal admins
    try {
      // Find internal admin users (Greenfinch org members)
      // We look for users who are admins - they'll see tickets in the admin panel
      const adminUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.isActive, true),
            eq(users.role, 'system_admin'),
          )
        );

      const senderName = [session.user.firstName, session.user.lastName].filter(Boolean).join(' ') || 'A user';

      for (const admin of adminUsers) {
        await db.insert(notifications).values({
          clerkOrgId: authData.orgId,
          recipientUserId: admin.id,
          senderUserId: session.user.id,
          type: 'support_ticket',
          title: `New support ticket from ${senderName}`,
          message: userSummary.trim().substring(0, 200),
        });
      }
    } catch (err) {
      console.error('[SupportChat] Failed to notify admins:', err);
    }

    return NextResponse.json({
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        createdAt: ticket.createdAt,
      },
    });
  } catch (error) {
    console.error('[SupportChat] Escalate error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
