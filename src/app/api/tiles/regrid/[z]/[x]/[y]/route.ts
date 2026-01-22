import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = '/tmp/regrid-tiles';
const CACHE_MAX_AGE_HOURS = 24 * 7;

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch {
  }
}

function getCachePath(z: string, x: string, y: string): string {
  return path.join(CACHE_DIR, `${z}_${x}_${y}.mvt`);
}

function getMetaPath(z: string, x: string, y: string): string {
  return path.join(CACHE_DIR, `${z}_${x}_${y}.meta.json`);
}

async function isCacheValid(metaPath: string): Promise<boolean> {
  try {
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent);
    const cachedAt = new Date(meta.cachedAt).getTime();
    const maxAge = CACHE_MAX_AGE_HOURS * 60 * 60 * 1000;
    return Date.now() - cachedAt < maxAge;
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  try {
    const { z, x, y } = await params;
    const apiKey = process.env.REGRID_API_KEY;

    if (!apiKey) {
      return new NextResponse('Regrid API key not configured', { status: 500 });
    }

    await ensureCacheDir();

    const cachePath = getCachePath(z, x, y);
    const metaPath = getMetaPath(z, x, y);

    if (await isCacheValid(metaPath)) {
      try {
        const cachedTile = await fs.readFile(cachePath);
        return new NextResponse(cachedTile, {
          headers: {
            'Content-Type': 'application/x-protobuf',
            'Content-Encoding': 'gzip',
            'Cache-Control': 'public, max-age=86400',
            'X-Cache': 'HIT',
          },
        });
      } catch {
      }
    }

    const regridUrl = `https://tiles.regrid.com/api/v1/parcels/${z}/${x}/${y}.mvt?token=${apiKey}`;
    
    const response = await fetch(regridUrl, {
      headers: {
        'Accept-Encoding': 'gzip',
      },
    });

    if (!response.ok) {
      if (response.status === 204 || response.status === 404) {
        return new NextResponse(null, { status: 204 });
      }
      return new NextResponse(`Regrid API error: ${response.status}`, { 
        status: response.status 
      });
    }

    const tileData = Buffer.from(await response.arrayBuffer());

    try {
      await fs.writeFile(cachePath, tileData);
      await fs.writeFile(metaPath, JSON.stringify({
        cachedAt: new Date().toISOString(),
        z, x, y,
        size: tileData.length,
      }));
    } catch (cacheError) {
      console.warn('[Tile Cache] Failed to write cache:', cacheError);
    }

    return new NextResponse(tileData, {
      headers: {
        'Content-Type': 'application/x-protobuf',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'public, max-age=86400',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('[Tile Cache] Error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
