import { NextRequest, NextResponse } from 'next/server';
import { getRedis, isRedisConfigured, increment, expire } from '@/lib/redis';

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

// In-memory rate limit storage for when Redis is unavailable
const inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries periodically
const cleanupInMemoryRateLimits = () => {
  const now = Date.now();
  for (const [key, value] of inMemoryRateLimits.entries()) {
    if (value.resetAt < now) {
      inMemoryRateLimits.delete(key);
    }
  }
};

// Run cleanup every minute
setInterval(cleanupInMemoryRateLimits, 60000);

/**
 * Check rate limit using sliding window algorithm
 * @param identifier - User ID or IP address
 * @param route - API route name (e.g., '/api/contacts', '/api/enrich')
 * @param limit - Max requests allowed (default: 100)
 * @param windowSeconds - Time window in seconds (default: 60)
 */
export async function checkRateLimit(
  identifier: string,
  route: string,
  limit: number = 100,
  windowSeconds: number = 60
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
  const windowStart = now - windowSeconds;
  const resetAt = now + windowSeconds;
  const resetAtMs = resetAt * 1000;

  const key = `gf:ratelimit:${identifier}:${route}:${windowStart}`;

  // Try to use Redis if available
  if (isRedisConfigured()) {
    try {
      const redis = getRedis();
      if (redis) {
        // Use INCR and EXPIRE for sliding window
        const count = await increment(key);
        
        // Set expiry on first increment
        if (count === 1) {
          await expire(key, windowSeconds + 1); // Add 1 second buffer
        }

        const remaining = Math.max(0, limit - count);
        const success = count <= limit;

        return {
          success,
          limit,
          remaining,
          resetAt: resetAtMs,
        };
      }
    } catch (error) {
      console.error('[RateLimit] Redis error, falling back to in-memory:', error);
      // Fall through to in-memory handling
    }
  }

  // In-memory fallback when Redis is unavailable
  const existingEntry = inMemoryRateLimits.get(key);
  
  if (!existingEntry || existingEntry.resetAt < now * 1000) {
    // Create new entry
    inMemoryRateLimits.set(key, {
      count: 1,
      resetAt: resetAtMs,
    });
    
    return {
      success: true,
      limit,
      remaining: limit - 1,
      resetAt: resetAtMs,
    };
  }

  // Increment existing entry
  existingEntry.count++;
  const remaining = Math.max(0, limit - existingEntry.count);
  const success = existingEntry.count <= limit;

  return {
    success,
    limit,
    remaining,
    resetAt: existingEntry.resetAt,
  };
}

/**
 * Get default rate limit for a route
 */
function getDefaultLimit(route: string): number {
  // Expensive endpoints: enrich, validate-email, etc.
  if (
    route.includes('/enrich') ||
    route.includes('/validate-email') ||
    route.includes('/waterfall-email') ||
    route.includes('/waterfall-phone') ||
    route.includes('/linkedin')
  ) {
    return 20;
  }

  // Search endpoints
  if (route.includes('/search') || route.includes('/typeahead')) {
    return 50;
  }

  // Standard endpoints
  return 100;
}

/**
 * Extract identifier from request (user ID or IP address)
 */
export function getIdentifier(request: NextRequest): string {
  // Try to get user ID from auth header or custom header
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    // Extract from Bearer token if present
    const match = authHeader.match(/^Bearer\s+(.+)$/);
    if (match) {
      return `user:${match[1].substring(0, 32)}`; // Use first 32 chars of token as user ID
    }
  }

  // Try to get from X-User-ID header
  const userId = request.headers.get('x-user-id');
  if (userId) {
    return `user:${userId}`;
  }

  // Fall back to IP address
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  return `ip:${ip}`;
}

/**
 * Create a rate limiting middleware for Next.js API routes
 * Usage:
 *   const rateLimitCheck = rateLimitMiddleware(50, 60);
 *   const result = await rateLimitCheck(request);
 *   if (result) return result; // Rate limit exceeded
 *
 * @param limit - Max requests allowed (uses default if not specified)
 * @param windowSeconds - Time window in seconds (default: 60)
 */
export function rateLimitMiddleware(
  limit?: number,
  windowSeconds: number = 60
) {
  return async (request: NextRequest): Promise<NextResponse | null> => {
    try {
      // Get route from request pathname
      const route = new URL(request.url).pathname;
      
      // Determine limit
      const effectiveLimit = limit ?? getDefaultLimit(route);
      
      // Get identifier
      const identifier = getIdentifier(request);

      // Check rate limit
      const result = await checkRateLimit(identifier, route, effectiveLimit, windowSeconds);

      // If rate limit exceeded, return 429 response
      if (!result.success) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
        
        return new NextResponse(
          JSON.stringify({
            error: 'Too many requests',
            retryAfter,
            limit: result.limit,
            remaining: result.remaining,
          }),
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(result.limit),
              'X-RateLimit-Remaining': String(result.remaining),
              'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
              'Content-Type': 'application/json',
            },
          }
        );
      }

      // Rate limit not exceeded - return null to allow request to proceed
      // The response headers will be added by the handler
      return null;
    } catch (error) {
      console.error('[RateLimit] Middleware error:', error);
      // On error, allow request to proceed (fail open)
      return null;
    }
  };
}

/**
 * Add rate limit headers to a NextResponse
 * Call this in your API handler after processing the request
 */
export function addRateLimitHeaders(
  response: NextResponse,
  rateLimitResult: RateLimitResult
): NextResponse {
  response.headers.set('X-RateLimit-Limit', String(rateLimitResult.limit));
  response.headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(rateLimitResult.resetAt / 1000)));
  return response;
}
