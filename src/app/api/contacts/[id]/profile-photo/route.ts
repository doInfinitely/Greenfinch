import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getProfilePicture } from '@/lib/enrichlayer';
import { cacheGet, cacheSet } from '@/lib/redis';

const PHOTO_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days
const PHOTO_NOT_FOUND_TTL = 60 * 60 * 24; // 1 day for negative cache

function photoCacheKey(linkedinUrl: string): string {
  const normalized = linkedinUrl.toLowerCase().replace(/\/+$/, '');
  return `photo:${normalized}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, id),
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (contact.photoUrl) {
      return NextResponse.json({ 
        success: true, 
        url: contact.photoUrl,
        cached: true 
      });
    }

    if (!contact.linkedinUrl) {
      return NextResponse.json({ 
        success: false, 
        error: 'No LinkedIn URL available to fetch profile photo' 
      });
    }

    const cacheKey = photoCacheKey(contact.linkedinUrl);
    const cached = await cacheGet<{ url: string | null }>(cacheKey);
    if (cached !== null) {
      if (cached.url) {
        await db.update(contacts)
          .set({ photoUrl: cached.url, updatedAt: new Date() })
          .where(eq(contacts.id, id));
        return NextResponse.json({ success: true, url: cached.url, cached: true });
      }
      return NextResponse.json({ success: false, error: 'No profile photo found (cached)' });
    }

    const PHOTO_TIMEOUT_MS = 5000;
    let result: { success: boolean; url?: string; error?: string };
    try {
      result = await Promise.race([
        getProfilePicture(contact.linkedinUrl),
        new Promise<{ success: false; error: string }>((_, reject) =>
          setTimeout(() => reject(new Error('EnrichLayer photo timeout')), PHOTO_TIMEOUT_MS)
        ),
      ]);
    } catch (timeoutErr) {
      console.warn(`[API] Profile photo timed out after ${PHOTO_TIMEOUT_MS}ms for contact ${id}`);
      await cacheSet(cacheKey, { url: null }, PHOTO_NOT_FOUND_TTL);
      return NextResponse.json({ success: false, error: 'Profile photo lookup timed out' });
    }

    if (result.success && result.url) {
      await Promise.all([
        db.update(contacts)
          .set({ photoUrl: result.url, updatedAt: new Date() })
          .where(eq(contacts.id, id)),
        cacheSet(cacheKey, { url: result.url }, PHOTO_CACHE_TTL),
      ]);

      return NextResponse.json({ 
        success: true, 
        url: result.url,
        cached: false 
      });
    }

    await cacheSet(cacheKey, { url: null }, PHOTO_NOT_FOUND_TTL);

    return NextResponse.json({ 
      success: false, 
      error: result.error || 'No profile photo found via EnrichLayer' 
    });
  } catch (error) {
    console.error('[API] Profile photo fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile photo' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, id),
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (!contact.linkedinUrl) {
      return NextResponse.json({ 
        success: false, 
        error: 'No LinkedIn URL available to fetch profile photo' 
      });
    }

    const PHOTO_TIMEOUT_MS = 5000;
    let result: { success: boolean; url?: string; error?: string };
    try {
      result = await Promise.race([
        getProfilePicture(contact.linkedinUrl),
        new Promise<{ success: false; error: string }>((_, reject) =>
          setTimeout(() => reject(new Error('EnrichLayer photo timeout')), PHOTO_TIMEOUT_MS)
        ),
      ]);
    } catch {
      console.warn(`[API] Profile photo refresh timed out for contact ${id}`);
      return NextResponse.json({ success: false, error: 'Profile photo lookup timed out' });
    }

    if (result.success && result.url) {
      const cacheKey = photoCacheKey(contact.linkedinUrl);
      await Promise.all([
        db.update(contacts)
          .set({ photoUrl: result.url, updatedAt: new Date() })
          .where(eq(contacts.id, id)),
        cacheSet(cacheKey, { url: result.url }, PHOTO_CACHE_TTL),
      ]);

      return NextResponse.json({ 
        success: true, 
        url: result.url,
        refreshed: true 
      });
    }

    return NextResponse.json({ 
      success: false, 
      error: result.error || 'No profile photo found via EnrichLayer' 
    });
  } catch (error) {
    console.error('[API] Profile photo refresh error:', error);
    return NextResponse.json(
      { error: 'Failed to refresh profile photo' },
      { status: 500 }
    );
  }
}
