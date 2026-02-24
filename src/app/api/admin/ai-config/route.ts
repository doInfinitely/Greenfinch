import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import {
  getAllStageConfigs,
  updateAllStageConfigs,
  resetToDefaults,
  getFactoryDefaults,
  AVAILABLE_MODELS,
  STAGE_LABELS,
  type RuntimeConfig,
  type StageKey,
} from '@/lib/ai/runtime-config';

export async function GET() {
  try {
    await requireAdminAccess();
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (error.message === 'FORBIDDEN') return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ success: false, error: 'Auth error' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      config: getAllStageConfigs(),
      defaults: getFactoryDefaults(),
      availableModels: AVAILABLE_MODELS,
      stageLabels: STAGE_LABELS,
    },
  });
}

export async function PUT(request: Request) {
  try {
    await requireAdminAccess();
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (error.message === 'FORBIDDEN') return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ success: false, error: 'Auth error' }, { status: 500 });
  }

  const body = await request.json();

  if (body.resetToDefaults) {
    const config = resetToDefaults();
    return NextResponse.json({ success: true, data: { config } });
  }

  if (!body.config) {
    return NextResponse.json({ success: false, error: 'Missing config' }, { status: 400 });
  }

  const validStageKeys: StageKey[] = [
    'stage1_classify', 'stage2_ownership', 'stage3_contacts',
    'summary_cleanup', 'replacement_search', 'domain_retry',
  ];

  const incoming = body.config as Partial<RuntimeConfig>;
  for (const key of Object.keys(incoming)) {
    if (!validStageKeys.includes(key as StageKey)) {
      return NextResponse.json({ success: false, error: `Invalid stage key: ${key}` }, { status: 400 });
    }
  }

  const updated = updateAllStageConfigs(incoming as RuntimeConfig);
  return NextResponse.json({ success: true, data: { config: updated } });
}
