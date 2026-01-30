import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = '/tmp/regrid-tiles';
const CACHE_MAX_AGE_DAYS = 90; // 90 days for tile expiration (parcels rarely change)

// Empty MVT tile - zero bytes is valid for "no data" in MVT format
const EMPTY_TILE = Buffer.alloc(0);

// ============================================================================
// LRU In-Memory Cache for Hot Tiles
// ============================================================================
// Keeps frequently accessed tiles in memory to avoid disk I/O
// Limited to ~500 tiles (~100MB assuming ~200KB avg tile size)

interface LRUCacheEntry {
  data: Buffer;
  accessedAt: number;
  empty: boolean;
}

class LRUTileCache {
  private cache = new Map<string, LRUCacheEntry>();
  private maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  get(key: string): LRUCacheEntry | null {
    const entry = this.cache.get(key);
    if (entry) {
      // Update access time and move to end (most recently used)
      entry.accessedAt = Date.now();
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry;
    }
    return null;
  }

  set(key: string, data: Buffer, empty: boolean = false): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, {
      data,
      accessedAt: Date.now(),
      empty,
    });
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  get size(): number {
    return this.cache.size;
  }
}

// Global in-memory cache instance
const memoryCache = new LRUTileCache(500);

// ============================================================================
// In-Flight Request Deduplication
// ============================================================================
// Prevents multiple concurrent requests for the same tile from all hitting Regrid
// All waiting requests share the same fetch promise

const inFlightRequests = new Map<string, Promise<{ data: Buffer; empty: boolean } | null>>();

// ============================================================================
// File Cache Helpers
// ============================================================================

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // Directory exists or can't be created
  }
}

function getCacheKey(z: string, x: string, y: string): string {
  return `${z}_${x}_${y}`;
}

function getCachePath(z: string, x: string, y: string): string {
  return path.join(CACHE_DIR, `${z}_${x}_${y}.mvt`);
}

function getMetaPath(z: string, x: string, y: string): string {
  return path.join(CACHE_DIR, `${z}_${x}_${y}.meta.json`);
}

interface CacheMeta {
  cachedAt: string;
  z: string;
  x: string;
  y: string;
  size: number;
  empty?: boolean;
}

async function getFileCacheMeta(metaPath: string): Promise<CacheMeta | null> {
  try {
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent) as CacheMeta;
    const cachedAt = new Date(meta.cachedAt).getTime();
    const maxAge = CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - cachedAt < maxAge) {
      return meta;
    }
    return null; // Expired
  } catch {
    return null;
  }
}

async function fetchFromRegrid(
  z: string, 
  x: string, 
  y: string, 
  apiKey: string
): Promise<{ data: Buffer; empty: boolean } | null> {
  const regridUrl = `https://tiles.regrid.com/api/v1/parcels/${z}/${x}/${y}.mvt?token=${apiKey}`;
  
  // Add timeout to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  let response: Response;
  try {
    response = await fetch(regridUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 204 || response.status === 404) {
      // Empty tile - no parcels in this area
      return { data: EMPTY_TILE, empty: true };
    }
    console.error(`[Tile Cache] Regrid API error for ${z}/${x}/${y}: ${response.status}`);
    return null; // Error - don't cache
  }

  const tileData = Buffer.from(await response.arrayBuffer());
  return { data: tileData, empty: false };
}

async function writeToDiskCache(
  z: string, 
  x: string, 
  y: string, 
  data: Buffer, 
  empty: boolean
): Promise<void> {
  try {
    const cachePath = getCachePath(z, x, y);
    const metaPath = getMetaPath(z, x, y);
    
    await fs.writeFile(cachePath, data);
    await fs.writeFile(metaPath, JSON.stringify({
      cachedAt: new Date().toISOString(),
      z, x, y,
      size: data.length,
      empty,
    }));
  } catch (cacheError) {
    console.warn('[Tile Cache] Failed to write disk cache:', cacheError);
  }
}

// ============================================================================
// Main Request Handler
// ============================================================================

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

    const cacheKey = getCacheKey(z, x, y);

    // ========================================
    // Layer 1: In-Memory LRU Cache (fastest)
    // ========================================
    const memoryEntry = memoryCache.get(cacheKey);
    if (memoryEntry) {
      return new NextResponse(memoryEntry.data, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.mapbox-vector-tile',
          'Cache-Control': 'public, max-age=7776000',
          'X-Cache': memoryEntry.empty ? 'HIT-MEMORY-EMPTY' : 'HIT-MEMORY',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ========================================
    // Layer 2: File System Cache
    // ========================================
    await ensureCacheDir();
    const cachePath = getCachePath(z, x, y);
    const metaPath = getMetaPath(z, x, y);

    const cachedMeta = await getFileCacheMeta(metaPath);
    if (cachedMeta) {
      if (cachedMeta.empty) {
        // Promote to memory cache
        memoryCache.set(cacheKey, EMPTY_TILE, true);
        return new NextResponse(EMPTY_TILE, { 
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.mapbox-vector-tile',
            'Cache-Control': 'public, max-age=7776000',
            'X-Cache': 'HIT-DISK-EMPTY',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }
      try {
        const cachedTile = await fs.readFile(cachePath);
        // Promote to memory cache
        memoryCache.set(cacheKey, cachedTile, false);
        return new NextResponse(cachedTile, {
          headers: {
            'Content-Type': 'application/vnd.mapbox-vector-tile',
            'Cache-Control': 'public, max-age=7776000',
            'X-Cache': 'HIT-DISK',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch {
        // Cache file missing, refetch
      }
    }

    // ========================================
    // Layer 3: Deduplicated Fetch from Regrid
    // ========================================
    
    // Check if there's already an in-flight request for this tile
    let fetchPromise = inFlightRequests.get(cacheKey);
    
    if (!fetchPromise) {
      // No in-flight request, create one
      fetchPromise = (async () => {
        try {
          return await fetchFromRegrid(z, x, y, apiKey);
        } finally {
          // Clean up in-flight tracking when done
          inFlightRequests.delete(cacheKey);
        }
      })();
      
      inFlightRequests.set(cacheKey, fetchPromise);
    }

    const result = await fetchPromise;

    if (!result) {
      return new NextResponse('Regrid API error', { status: 502 });
    }

    // Store in both caches
    memoryCache.set(cacheKey, result.data, result.empty);
    await writeToDiskCache(z, x, y, result.data, result.empty);

    return new NextResponse(result.data, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=7776000',
        'X-Cache': result.empty ? 'MISS-EMPTY' : 'MISS',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[Tile Cache] Error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
