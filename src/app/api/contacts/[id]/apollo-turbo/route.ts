import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { auth } from '@clerk/nextjs/server';
import { apolloTurboEnrich } from '@/lib/apollo';
import { parseFullName } from '@/lib/utils';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid contact ID format' }, { status: 400 });
    }

    const { orgId } = await auth();

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const fullName = contact.fullName || '';
    if (!fullName) {
      return NextResponse.json({ error: 'Contact has no name' }, { status: 400 });
    }

    const { firstName, lastName } = parseFullName(fullName);
    const domain = contact.companyDomain;

    if (!domain) {
      return NextResponse.json({ error: 'Contact has no company domain — cannot enrich' }, { status: 400 });
    }

    const apolloResult = await apolloTurboEnrich({
      firstName,
      lastName,
      domain,
      email: contact.email || undefined,
      linkedinUrl: contact.linkedinUrl || undefined,
      title: contact.title || undefined,
    });

    if (!apolloResult.found) {
      return NextResponse.json({ enriched: false, message: 'No match found in Apollo' });
    }

    // Merge Apollo data into contact — only fill empty fields
    const updates: Record<string, any> = {};
    if (apolloResult.email && !contact.email) updates.email = apolloResult.email;
    if (apolloResult.phone && !contact.phone) updates.phone = apolloResult.phone;
    if (apolloResult.title && !contact.title) updates.title = apolloResult.title;
    if (apolloResult.linkedinUrl && !contact.linkedinUrl) updates.linkedinUrl = apolloResult.linkedinUrl;

    if (Object.keys(updates).length > 0) {
      await db.update(contacts).set(updates).where(eq(contacts.id, id));
    }

    return NextResponse.json({
      enriched: true,
      fieldsUpdated: Object.keys(updates),
      apollo: {
        email: apolloResult.email,
        phone: apolloResult.phone,
        title: apolloResult.title,
        company: apolloResult.company,
        linkedinUrl: apolloResult.linkedinUrl,
        seniority: apolloResult.seniority,
      },
    });
  } catch (error) {
    console.error('[Apollo Turbo] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
