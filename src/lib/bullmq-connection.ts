export interface BullMQRedisConfig {
  host: string;
  port: number;
  password: string;
  maxRetriesPerRequest: null;
  tls: Record<string, never>;
  connectTimeout: number;
  lazyConnect: boolean;
  keepAlive: number;
  enableReadyCheck: boolean;
}

export function getBullMQRedisConfig(): BullMQRedisConfig {
  const host = process.env.UPSTASH_REDIS_HOST;
  const port = parseInt(process.env.UPSTASH_REDIS_PORT || '6379', 10);
  const password = process.env.UPSTASH_REDIS_PASSWORD;

  if (!host || !password) {
    throw new Error('UPSTASH_REDIS_HOST and UPSTASH_REDIS_PASSWORD are required for BullMQ');
  }

  return {
    host,
    port,
    password,
    maxRetriesPerRequest: null,
    tls: {},
    connectTimeout: 30000,
    lazyConnect: true,
    keepAlive: 10000,
    enableReadyCheck: false,
  };
}

export function isBullMQConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_HOST && process.env.UPSTASH_REDIS_PASSWORD);
}
