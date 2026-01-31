import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    console.warn('[Redis] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured - falling back to in-memory');
    return null;
  }
  
  redis = new Redis({ url, token });
  console.log('[Redis] Connected to Upstash Redis');
  return redis;
}

export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

const CACHE_PREFIX = 'gf:cache:';
const QUEUE_PREFIX = 'gf:queue:';
const LOCK_PREFIX = 'gf:lock:';

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  
  try {
    const value = await r.get<T>(`${CACHE_PREFIX}${key}`);
    return value;
  } catch (error) {
    console.error('[Redis] Cache get error:', error);
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  
  try {
    await r.set(`${CACHE_PREFIX}${key}`, value, { ex: ttlSeconds });
    return true;
  } catch (error) {
    console.error('[Redis] Cache set error:', error);
    return false;
  }
}

export async function cacheDelete(key: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  
  try {
    await r.del(`${CACHE_PREFIX}${key}`);
    return true;
  } catch (error) {
    console.error('[Redis] Cache delete error:', error);
    return false;
  }
}

export async function acquireLock(lockName: string, ttlSeconds: number = 30): Promise<boolean> {
  const r = getRedis();
  if (!r) return true;
  
  try {
    const lockKey = `${LOCK_PREFIX}${lockName}`;
    const result = await r.set(lockKey, Date.now(), { nx: true, ex: ttlSeconds });
    return result === 'OK';
  } catch (error) {
    console.error('[Redis] Acquire lock error:', error);
    return true;
  }
}

export async function releaseLock(lockName: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return true;
  
  try {
    await r.del(`${LOCK_PREFIX}${lockName}`);
    return true;
  } catch (error) {
    console.error('[Redis] Release lock error:', error);
    return false;
  }
}

export async function queuePush(queueName: string, item: unknown): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  
  try {
    await r.rpush(`${QUEUE_PREFIX}${queueName}`, JSON.stringify(item));
    return true;
  } catch (error) {
    console.error('[Redis] Queue push error:', error);
    return false;
  }
}

export async function queuePop<T>(queueName: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  
  try {
    const item = await r.lpop<string>(`${QUEUE_PREFIX}${queueName}`);
    if (!item) return null;
    return JSON.parse(item) as T;
  } catch (error) {
    console.error('[Redis] Queue pop error:', error);
    return null;
  }
}

export async function queueLength(queueName: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  
  try {
    return await r.llen(`${QUEUE_PREFIX}${queueName}`);
  } catch (error) {
    console.error('[Redis] Queue length error:', error);
    return 0;
  }
}

export async function hashSet(hashName: string, field: string, value: unknown): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  
  try {
    await r.hset(hashName, { [field]: JSON.stringify(value) });
    return true;
  } catch (error) {
    console.error('[Redis] Hash set error:', error);
    return false;
  }
}

export async function hashGet<T>(hashName: string, field: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  
  try {
    const value = await r.hget<string>(hashName, field);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    console.error('[Redis] Hash get error:', error);
    return null;
  }
}

export async function hashGetAll<T>(hashName: string): Promise<Record<string, T>> {
  const r = getRedis();
  if (!r) return {};
  
  try {
    const all = await r.hgetall<Record<string, string>>(hashName);
    if (!all) return {};
    
    const result: Record<string, T> = {};
    for (const [key, value] of Object.entries(all)) {
      try {
        result[key] = JSON.parse(value) as T;
      } catch {
        result[key] = value as unknown as T;
      }
    }
    return result;
  } catch (error) {
    console.error('[Redis] Hash get all error:', error);
    return {};
  }
}

export async function hashDelete(hashName: string, field: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  
  try {
    await r.hdel(hashName, field);
    return true;
  } catch (error) {
    console.error('[Redis] Hash delete error:', error);
    return false;
  }
}

export async function setWithExpiry(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  
  try {
    await r.set(key, JSON.stringify(value), { ex: ttlSeconds });
    return true;
  } catch (error) {
    console.error('[Redis] Set with expiry error:', error);
    return false;
  }
}

export async function get<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  
  try {
    const value = await r.get<string>(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    console.error('[Redis] Get error:', error);
    return null;
  }
}

export async function increment(key: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  
  try {
    return await r.incr(key);
  } catch (error) {
    console.error('[Redis] Increment error:', error);
    return 0;
  }
}

export async function expire(key: string, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  
  try {
    await r.expire(key, ttlSeconds);
    return true;
  } catch (error) {
    console.error('[Redis] Expire error:', error);
    return false;
  }
}
