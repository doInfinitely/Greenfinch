/**
 * Admin API: Deduplication
 * 
 * Auto-merges contacts by email/LinkedIn. Flags name/domain matches for admin review.
 * Keeps the most recently Apollo-enriched record.
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
    
    const orgDuplicates = await findDuplicateOrganizations();
    const { autoMerge, potentialDuplicates } = await findDuplicateContacts();
    
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
      contactsAutoMerge: autoMerge.map(g => ({
        key: g.key,
        count: g.items.length,
        keepId: g.keepId,
        keepName: g.items.find(i => i.id === g.keepId)?.fullName,
        deleteCount: g.deleteIds.length,
        deleteNames: g.items.filter(i => g.deleteIds.includes(i.id)).map(i => i.fullName),
      })),
      contactsPotentialDuplicates: potentialDuplicates,
      summary: {
        organizationGroupsToMerge: orgDuplicates.length,
        organizationsToDelete: orgDuplicates.reduce((sum, g) => sum + g.deleteIds.length, 0),
        contactGroupsToAutoMerge: autoMerge.length,
        contactsToAutoMerge: autoMerge.reduce((sum, g) => sum + g.deleteIds.length, 0),
        potentialDuplicatesToFlag: potentialDuplicates.length,
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
      potentialDuplicatesFlagged: result.potentialDuplicatesFlagged,
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
