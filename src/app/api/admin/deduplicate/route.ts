/**
 * Admin API: Deduplication
 * 
 * Merges duplicate organizations (by domain) and contacts (by name+domain)
 * Keeps the most recently Apollo-enriched record
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { 
  runDeduplication, 
  findDuplicateOrganizations, 
  findDuplicateContacts 
} from '@/lib/deduplication';

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    await requireAdminAccess();
    
    // Preview mode - show what would be merged
    const orgDuplicates = await findDuplicateOrganizations();
    const contactDuplicates = await findDuplicateContacts();
    
    return NextResponse.json({
      preview: true,
      organizations: orgDuplicates.map(g => ({
        domain: g.key,
        count: g.items.length,
        keepId: g.keepId,
        keepName: g.items.find(i => i.id === g.keepId)?.name,
        deleteCount: g.deleteIds.length,
        deleteNames: g.items.filter(i => g.deleteIds.includes(i.id)).map(i => i.name),
      })),
      contacts: contactDuplicates.map(g => ({
        key: g.key,
        count: g.items.length,
        keepId: g.keepId,
        keepName: g.items.find(i => i.id === g.keepId)?.fullName,
        deleteCount: g.deleteIds.length,
        deleteNames: g.items.filter(i => g.deleteIds.includes(i.id)).map(i => i.fullName),
      })),
      summary: {
        organizationGroupsToMerge: orgDuplicates.length,
        organizationsToDelete: orgDuplicates.reduce((sum, g) => sum + g.deleteIds.length, 0),
        contactGroupsToMerge: contactDuplicates.length,
        contactsToDelete: contactDuplicates.reduce((sum, g) => sum + g.deleteIds.length, 0),
      },
    });
  } catch (error) {
    console.error('[Deduplicate] Preview error:', error);
    
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message.startsWith('FORBIDDEN')) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to preview deduplication' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    await requireAdminAccess();
    
    console.log('[Deduplicate] Starting deduplication run...');
    
    const result = await runDeduplication();
    
    return NextResponse.json({
      success: true,
      organizationsMerged: result.organizationsMerged,
      contactsMerged: result.contactsMerged,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[Deduplicate] Run error:', error);
    
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message.startsWith('FORBIDDEN')) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to run deduplication' },
      { status: 500 }
    );
  }
}
