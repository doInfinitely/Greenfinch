import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getRedis, isRedisConfigured } from '@/lib/redis';

export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  const dbStart = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      checks.database = { status: 'healthy', latencyMs: Date.now() - dbStart };
    } finally {
      client.release();
    }
  } catch (err) {
    checks.database = {
      status: 'unhealthy',
      latencyMs: Date.now() - dbStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  const redisStart = Date.now();
  if (isRedisConfigured()) {
    try {
      const redis = getRedis();
      if (redis) {
        await redis.ping();
        checks.redis = { status: 'healthy', latencyMs: Date.now() - redisStart };
      } else {
        checks.redis = { status: 'unhealthy', error: 'Redis client not initialized' };
      }
    } catch (err) {
      checks.redis = {
        status: 'unhealthy',
        latencyMs: Date.now() - redisStart,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  } else {
    checks.redis = { status: 'not_configured' };
  }

  const allHealthy = Object.values(checks).every(
    (c) => c.status === 'healthy' || c.status === 'not_configured'
  );

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
