import { NextRequest, NextResponse } from 'next/server';
import { PMTiles } from 'pmtiles';
import * as fs from 'fs';
import * as path from 'path';

// Cache the PMTiles instance
let pmtiles: PMTiles | null = null;

function getPMTiles(): PMTiles | null {
  if (pmtiles) return pmtiles;

  // Check for external URL first
  const externalUrl = process.env.PMTILES_URL;
  if (externalUrl && externalUrl.startsWith('http')) {
    pmtiles = new PMTiles(externalUrl);
    return pmtiles;
  }

  // Fall back to local file
  const filePath = path.join(process.cwd(), 'public', 'tiles', 'dfw_parcels.pmtiles');
  if (!fs.existsSync(filePath)) return null;

  pmtiles = new PMTiles(new FileSource(filePath));
  return pmtiles;
}

// File source for local PMTiles files
class FileSource {
  private fd: number;
  private path: string;

  constructor(path: string) {
    this.path = path;
    this.fd = fs.openSync(path, 'r');
  }

  getKey() { return this.path; }

  async getBytes(offset: number, length: number): Promise<{ data: ArrayBuffer }> {
    const buffer = Buffer.alloc(length);
    fs.readSync(this.fd, buffer, 0, length, offset);
    return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y: yRaw } = await params;
  // Strip .mvt extension if present
  const y = yRaw.replace(/\.mvt$/, '');

  const tiles = getPMTiles();
  if (!tiles) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const tile = await tiles.getZxy(parseInt(z), parseInt(x), parseInt(y));
    if (!tile || !tile.data) {
      return new NextResponse(null, { status: 204 });
    }

    return new NextResponse(tile.data, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
