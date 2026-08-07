// In-memory sliding-window rate limiter keyed per shop/account.
// Sufficient for a single Railway instance; swap for a shared (Redis/pgBoss-backed)
// limiter in P1 when the pipeline goes multi-instance.

const buckets = new Map()

export function rateLimit({ keyFn, windowMs, limit, errorMessage }) {
  return async (c, next) => {
    const key = keyFn(c)
    if (!key) {
      await next()
      return
    }

    const now = Date.now()
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { hits: [], resetAt: now + windowMs }
      buckets.set(key, bucket)
    }

    bucket.hits = bucket.hits.filter((t) => t > now - windowMs)
    if (bucket.hits.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000))
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: errorMessage || 'Too many requests' }, 429)
    }

    bucket.hits.push(now)
    await next()
  }
}

const timer = setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}, 60000)
if (timer.unref) timer.unref()
