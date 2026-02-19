import pLimit from 'p-limit';

interface RateLimiterConfig {
  maxPerMinute?: number;
  maxConcurrent?: number;
  name: string;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxPerMinute: number) {
    this.maxTokens = maxPerMinute;
    this.tokens = maxPerMinute;
    this.lastRefill = Date.now();
    this.refillRate = maxPerMinute / 60000;
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillRate);
  }
}

export class ServiceRateLimiter {
  private bucket: TokenBucket | null;
  private concurrencyLimiter: ReturnType<typeof pLimit>;
  private readonly name: string;
  private waitQueue: Array<{ resolve: () => void }> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: RateLimiterConfig) {
    this.name = config.name;
    this.bucket = config.maxPerMinute ? new TokenBucket(config.maxPerMinute) : null;
    this.concurrencyLimiter = pLimit(config.maxConcurrent || Infinity);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForToken();
    return this.concurrencyLimiter(fn);
  }

  private async waitForToken(): Promise<void> {
    if (!this.bucket) return;

    if (this.bucket.tryConsume()) return;

    await new Promise<void>((resolve) => {
      this.waitQueue.push({ resolve });
      this.scheduleDrain();
    });
  }

  private scheduleDrain() {
    if (this.drainTimer) return;
    if (!this.bucket) return;

    const checkAndDrain = () => {
      this.drainTimer = null;
      while (this.waitQueue.length > 0 && this.bucket!.tryConsume()) {
        const item = this.waitQueue.shift()!;
        item.resolve();
      }
      if (this.waitQueue.length > 0) {
        const nextWait = this.bucket!.msUntilAvailable();
        this.drainTimer = setTimeout(checkAndDrain, Math.max(nextWait, 50));
      }
    };

    const waitMs = this.bucket.msUntilAvailable();
    this.drainTimer = setTimeout(checkAndDrain, Math.max(waitMs, 50));
  }

  get pending(): number {
    return this.waitQueue.length;
  }
}

export class RateLimitError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number = 5000) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    serviceName?: string;
    isRateLimitError?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 2000,
    serviceName = 'unknown',
    isRateLimitError = defaultIsRateLimitError,
  } = options;

  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (!isRateLimitError(error) || attempt === maxRetries) {
        throw error;
      }

      let delayMs: number;
      if (error instanceof RateLimitError) {
        delayMs = error.retryAfterMs;
      } else {
        const retryAfterHeader = error?.response?.headers?.get?.('retry-after');
        if (retryAfterHeader) {
          const seconds = parseInt(retryAfterHeader, 10);
          delayMs = isNaN(seconds) ? baseDelayMs * Math.pow(2, attempt) : seconds * 1000;
        } else {
          delayMs = baseDelayMs * Math.pow(2, attempt);
        }
      }

      const jitter = Math.random() * 1000;
      const totalDelay = delayMs + jitter;

      console.warn(
        `[RateLimit] ${serviceName} hit rate limit (attempt ${attempt + 1}/${maxRetries + 1}), ` +
        `retrying in ${Math.round(totalDelay / 1000)}s`
      );

      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }

  throw lastError;
}

function defaultIsRateLimitError(error: any): boolean {
  if (error instanceof RateLimitError) return true;
  const status = error?.status || error?.statusCode || error?.response?.status;
  if (status === 429) return true;
  const msg = (error?.message || '').toLowerCase();
  return msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded');
}

export const rateLimiters = {
  gemini: new ServiceRateLimiter({ name: 'Gemini', maxPerMinute: 900, maxConcurrent: 50 }),
  findymail: new ServiceRateLimiter({ name: 'Findymail', maxConcurrent: 250 }),
  crustdata: new ServiceRateLimiter({ name: 'Crustdata', maxPerMinute: 14, maxConcurrent: 5 }),
  pdlPerson: new ServiceRateLimiter({ name: 'PDL Person', maxPerMinute: 90, maxConcurrent: 30 }),
  pdlCompany: new ServiceRateLimiter({ name: 'PDL Company', maxPerMinute: 90, maxConcurrent: 30 }),
};
