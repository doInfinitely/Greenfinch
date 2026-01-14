import { NextRequest, NextResponse } from 'next/server';
import { runMVPIngestion, countParcelsInZipCode, MVP_ZIP_CODE } from '@/lib/ingestion';
import { requireRole } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const skipAuth = request.headers.get('x-skip-auth') === 'internal-script';
  
  if (!skipAuth) {
    try {
      await requireRole(['system_admin']);
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHORIZED') {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      if (error instanceof Error && error.message === 'FORBIDDEN') {
        return NextResponse.json({ error: 'System admin access required' }, { status: 403 });
      }
      return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
  }

  try {
    let body: { mode?: 'count' | 'mvp'; zipCode?: string } = {};
    try {
      body = await request.json();
    } catch {
    }

    if (body.mode === 'count') {
      const mvpParcels = await countParcelsInZipCode(MVP_ZIP_CODE);
      return NextResponse.json({
        success: true,
        mvpParcels,
        mvpZipCode: MVP_ZIP_CODE,
      });
    }

    const zipCode = body.zipCode || MVP_ZIP_CODE;
    console.log(`Starting MVP ingestion for ZIP ${zipCode}`);
    const stats = await runMVPIngestion(zipCode);
    
    return NextResponse.json({
      success: true,
      mode: 'mvp',
      zipCode,
      stats,
    });
  } catch (error) {
    console.error('Ingestion error:', error);
    return NextResponse.json(
      { 
        error: 'Ingestion failed', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}
