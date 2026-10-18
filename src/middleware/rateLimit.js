/**
 * API-02: Rate Limiting Middleware.
 * Laravel leaned on the cache store; here an in-process TTL map does the same
 * job for a single node. Swap the store for Redis when running more than one.
 */
const buckets = new Map();

function resolveKey(req) {
  const apiKey = req.headers['x-api-key']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return apiKey || req.ip;
}

export function rateLimit(maxAttempts = 60, decayMinutes = 1) {
  return function rateLimitMiddleware(req, res, next) {
    const key = `rate_limit:${resolveKey(req)}`;
    const now = Date.now();
    const windowMs = decayMinutes * 60 * 1000;

    const bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      buckets.set(key, { attempts: 1, expiresAt: now + windowMs });
      res.set({
        'X-RateLimit-Limit': String(maxAttempts),
        'X-RateLimit-Remaining': String(maxAttempts - 1),
      });
      return next();
    }

    if (bucket.attempts >= maxAttempts) {
      res.set({
        'X-RateLimit-Limit': String(maxAttempts),
        'X-RateLimit-Remaining': '0',
        'Retry-After': String(decayMinutes * 60),
      });
      return res.status(429).json({
        error: 'Too many requests.',
        message: `Rate limit of ${maxAttempts} requests per ${decayMinutes} minute(s) exceeded.`,
        retry_after: decayMinutes * 60,
      });
    }

    bucket.attempts += 1;
    res.set({
      'X-RateLimit-Limit': String(maxAttempts),
      'X-RateLimit-Remaining': String(Math.max(0, maxAttempts - bucket.attempts)),
    });
    return next();
  };
}

// Drop expired buckets so the map cannot grow without bound.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
}, 60_000);
sweeper.unref?.();

export default rateLimit;
