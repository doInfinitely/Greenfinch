import pLimit from 'p-limit';

enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  rollingWindowMs?: number;
}

export class CircuitBreakerOpenError extends Error {
  serviceName: string;
  retryAfterMs: number;
  constructor(serviceName: string, retryAfterMs: number) {
    super(`Circuit breaker is open for ${serviceName}. Retry after ${retryAfterMs}ms.`);
    this.name = 'CircuitBreakerOpenError';
    this.serviceName = serviceName;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isCircuitBreakerError(error: any): error is CircuitBreakerOpenError {
  return error instanceof CircuitBreakerOpenError;
}

function isCircuitBreakerQualifyingError(error: any): boolean {
  const status = error?.status || error?.statusCode || error?.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (error instanceof RateLimitError) return true;
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnrefused') || msg.includes('econnreset')) return true;
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded')) return true;
  return false;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureTimestamps: number[] = [];
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly rollingWindowMs: number;
  private readonly serviceName: string;
  private openedAt: number = 0;
  private currentResetTimeout: number;
  private consecutiveHalfOpenFailures: number = 0;

  constructor(serviceName: string, config: CircuitBreakerConfig = {}) {
    this.serviceName = serviceName;
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30000;
    this.rollingWindowMs = config.rollingWindowMs ?? 60000;
    this.currentResetTimeout = this.resetTimeoutMs;
  }

  get currentState(): CircuitBreakerState {
    if (this.state === CircuitBreakerState.OPEN) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.currentResetTimeout) {
        this.state = CircuitBreakerState.HALF_OPEN;
      }
    }
    return this.state;
  }

  check(): void {
    const state = this.currentState;
    if (state === CircuitBreakerState.OPEN) {
      const retryAfterMs = Math.max(0, this.currentResetTimeout - (Date.now() - this.openedAt));
      throw new CircuitBreakerOpenError(this.serviceName, retryAfterMs);
    }
  }

  recordSuccess(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.CLOSED;
      this.consecutiveHalfOpenFailures = 0;
      this.currentResetTimeout = this.resetTimeoutMs;
    }
    this.failureTimestamps = [];
  }

  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureTimestamps = [];
    this.openedAt = 0;
    this.consecutiveHalfOpenFailures = 0;
    this.currentResetTimeout = this.resetTimeoutMs;
    console.log(`[CircuitBreaker] ${this.serviceName} manually reset to CLOSED`);
  }

  recordFailure(error: any): void {
    if (!isCircuitBreakerQualifyingError(error)) return;

    const now = Date.now();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.consecutiveHalfOpenFailures++;
      this.currentResetTimeout = this.resetTimeoutMs * Math.pow(2, Math.min(this.consecutiveHalfOpenFailures, 5));
      this.state = CircuitBreakerState.OPEN;
      this.openedAt = now;
      console.warn(`[CircuitBreaker] ${this.serviceName} half-open test failed, reopening with ${this.currentResetTimeout}ms cooldown`);
      return;
    }

    this.failureTimestamps.push(now);
    const windowStart = now - this.rollingWindowMs;
    this.failureTimestamps = this.failureTimestamps.filter(ts => ts > windowStart);

    if (this.failureTimestamps.length >= this.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.openedAt = now;
      console.warn(`[CircuitBreaker] ${this.serviceName} opened after ${this.failureTimestamps.length} failures in ${this.rollingWindowMs}ms window`);
    }
  }
}

interface RateLimiterConfig {
  maxPerMinute?: number;
  maxConcurrent?: number;
  name: string;
  circuitBreaker?: CircuitBreakerConfig;
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
  private circuitBreaker: CircuitBreaker | null = null;

  constructor(config: RateLimiterConfig) {
    this.name = config.name;
    this.bucket = config.maxPerMinute ? new TokenBucket(config.maxPerMinute) : null;
    this.concurrencyLimiter = pLimit(config.maxConcurrent || Infinity);
    if (config.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(config.name, config.circuitBreaker);
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.circuitBreaker) {
      this.circuitBreaker.check();
    }
    await this.waitForToken();
    return this.concurrencyLimiter(async () => {
      try {
        const result = await fn();
        if (this.circuitBreaker) {
          this.circuitBreaker.recordSuccess();
        }
        return result;
      } catch (error) {
        if (this.circuitBreaker) {
          this.circuitBreaker.recordFailure(error);
        }
        throw error;
      }
    });
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

  get circuitBreakerState(): string {
    if (!this.circuitBreaker) return 'none';
    return this.circuitBreaker.currentState;
  }

  resetCircuitBreaker(): void {
    if (this.circuitBreaker) {
      this.circuitBreaker.reset();
    }
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

      if (isCircuitBreakerError(error)) {
        throw error;
      }

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
  gemini: new ServiceRateLimiter({ name: 'Gemini', maxPerMinute: 900, maxConcurrent: 50, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30000 } }),
  findymail: new ServiceRateLimiter({ name: 'Findymail', maxConcurrent: 250, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30000 } }),
  crustdata: new ServiceRateLimiter({ name: 'Crustdata', maxPerMinute: 14, maxConcurrent: 5, circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 60000 } }),
  pdlPerson: new ServiceRateLimiter({ name: 'PDL Person', maxPerMinute: 90, maxConcurrent: 30, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30000 } }),
  pdlCompany: new ServiceRateLimiter({ name: 'PDL Company', maxPerMinute: 90, maxConcurrent: 30, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30000 } }),
};
