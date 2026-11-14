/**
 * Middleware Rate Limiter berbasis in-memory fixed window untuk Express.
 * Tanpa dependensi eksternal, mendukung header standar RateLimit-* & Retry-After,
 * serta pembersihan bucket kedaluwarsa otomatis via timer `.unref()`.
 */

/**
 * Normalisasi alamat IP klien agar konsisten antara IPv4 dan IPv6-mapped.
 * @param {import('express').Request} req
 * @returns {string}
 */
export function normalizeClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const raw = typeof forwarded === 'string' && forwarded.length > 0
    ? forwarded.split(',')[0].trim()
    : (req.ip || req.socket?.remoteAddress || 'unknown');
  return String(raw).replace(/^::ffff:/i, '');
}

/**
 * Buat instance middleware rate limiter independen.
 * @param {object} [opts]
 * @param {string} [opts.name='api']
 * @param {number} [opts.windowMs=60000]
 * @param {number|((req: import('express').Request) => number)} [opts.max=120]
 * @param {(req: import('express').Request) => string} [opts.keyGenerator]
 * @param {(req: import('express').Request) => boolean} [opts.skip]
 * @param {string} [opts.message]
 */
export function createRateLimiter({
  name = 'api',
  windowMs = 60_000,
  max = 120,
  keyGenerator = (req) => `${name}:${normalizeClientIp(req)}`,
  skip = null,
  message = 'Terlalu banyak permintaan dari alamat Anda. Silakan coba lagi sebentar lagi.',
} = {}) {
  const safeWindowMs = Math.max(1000, Number(windowMs) || 60_000);
  const buckets = new Map();
  const telemetry = {
    name,
    windowMs: safeWindowMs,
    max: typeof max === 'function' ? 'dynamic' : Math.max(1, Number(max) || 120),
    allowed: 0,
    blocked: 0,
    lastBlockedAt: null,
  };

  function pruneExpired(now) {
    for (const [k, entry] of buckets.entries()) {
      if (now >= entry.resetAt) {
        buckets.delete(k);
      }
    }
  }

  const cleanupInterval = setInterval(() => pruneExpired(Date.now()), Math.max(safeWindowMs, 60_000));
  cleanupInterval.unref?.();

  function middleware(req, res, next) {
    if (typeof skip === 'function' && skip(req)) {
      return next();
    }

    const now = Date.now();
    const limit = Math.max(1, Number(typeof max === 'function' ? max(req) : max) || 120);
    const key = String(keyGenerator(req) || `${name}:unknown`);

    let entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + safeWindowMs };
      buckets.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, limit - entry.count);
    const retryAfterS = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(retryAfterS));

    if (entry.count > limit) {
      telemetry.blocked += 1;
      telemetry.lastBlockedAt = new Date(now).toISOString();
      res.setHeader('Retry-After', String(retryAfterS));
      return res.status(429).json({
        ok: false,
        error: message,
        limiter: name,
        retryAfterS,
      });
    }

    telemetry.allowed += 1;
    return next();
  }

  middleware.getStats = () => {
    pruneExpired(Date.now());
    return {
      ...telemetry,
      activeKeys: buckets.size,
    };
  };

  middleware.reset = () => {
    buckets.clear();
    telemetry.allowed = 0;
    telemetry.blocked = 0;
    telemetry.lastBlockedAt = null;
  };

  middleware.stop = () => {
    clearInterval(cleanupInterval);
  };

  return middleware;
}
