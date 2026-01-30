import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { triggerWaterfallPhone } from '@/lib/apollo';
import { requireSession, requireAdminAccess } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseNameParts(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    await requireAdminAccess();
    
    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid contact ID format' },
        { status: 400 }
      );
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (!contact.fullName) {
      return NextResponse.json({ error: 'Contact has no name' }, { status: 400 });
    }

    const { firstName, lastName } = parseNameParts(contact.fullName);

    console.log(`[WaterfallPhone] Triggering for contact: ${contact.fullName} (${id})`);

    const result = await triggerWaterfallPhone({
      apolloId: contact.providerId || undefined,
      linkedinUrl: contact.linkedinUrl || undefined,
      firstName,
      lastName,
      domain: contact.companyDomain || undefined,
      email: contact.email || undefined,
    });

    if (!result.success) {
      console.error(`[WaterfallPhone] Failed for ${contact.fullName}:`, result.error);
      return NextResponse.json(
        { 
          error: 'Waterfall phone request failed', 
          details: result.error,
          waterfallStatus: result.waterfallStatus,
        },
        { status: 422 }
      );
    }

    if (result.apolloId && !contact.providerId) {
      await db.update(contacts)
        .set({ 
          providerId: result.apolloId,
          enrichmentSource: 'apollo',
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id));
    }

    console.log(`[WaterfallPhone] Request accepted for ${contact.fullName}, Apollo ID: ${result.apolloId}`);

    return NextResponse.json({
      success: true,
      message: 'Phone lookup initiated. Results will arrive shortly via webhook.',
      requestId: result.requestId,
      apolloId: result.apolloId,
      waterfallStatus: result.waterfallStatus,
    });
  } catch (error) {
    console.error('[WaterfallPhone] API error:', error);
    
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message.startsWith('FORBIDDEN')) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to trigger phone lookup' },
      { status: 500 }
    );
  }
}
