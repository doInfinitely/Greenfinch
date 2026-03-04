import { NextRequest } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { mergeOrganizationPair } from '@/lib/deduplication';
import { apiSuccess, apiError, apiBadRequest, apiUnauthorized } from '@/lib/api-response';

export async function POST(req: NextRequest) {
  try {
    await requireAdminAccess();
  } catch {
    return apiUnauthorized();
  }

  try {
    const body = await req.json();
    const { keepOrgId, deleteOrgId } = body;

    if (!keepOrgId || !deleteOrgId) {
      return apiBadRequest('Missing keepOrgId or deleteOrgId');
    }

    if (keepOrgId === deleteOrgId) {
      return apiBadRequest('Cannot merge an organization with itself');
    }

    const result = await mergeOrganizationPair(keepOrgId, deleteOrgId);

    if (!result.success) {
      return apiError(result.error || 'Merge failed', { status: 500 });
    }

    return apiSuccess({ merged: true, stats: result.stats });
  } catch (error) {
    console.error('[Admin] merge-orgs POST error:', error);
    return apiError('Failed to merge organizations', { status: 500 });
  }
}
