import crypto from 'node:crypto';

/**
 * Production-ready in-memory LRU Cache with TTL (Time-To-Live).
 * Uses native JavaScript Map which maintains key insertion order.
 * On get(), item is refreshed to the end (MRU).
 * On set() when capacity is reached, the oldest key is evicted (LRU).
 */
export class InMemoryLRUCache {
  /**
   * @param {object} [opts]
   * @param {number} [opts.max=500] Maximum entries allowed before eviction
   * @param {number} [opts.defaultTtlMs=60000] Default TTL in milliseconds
   * @param {string} [opts.name='default'] Name of this cache store for diagnostics
   */
  constructor({ max = 500, defaultTtlMs = 60_000, name = 'default' } = {}) {
    this.max = Math.max(1, Number(max) || 500);
    this.defaultTtlMs = Math.max(1, Number(defaultTtlMs) || 60_000);
    this.name = String(name || 'default');
    this.store = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
    };
  }

  /**
   * Retrieve an item from the cache.
   * If expired, removes the item and returns null.
   * If found and valid, refreshes its LRU position and returns the value.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }

    // Refresh LRU order: delete and re-insert at the end (MRU)
    this.store.delete(key);
    entry.hits = (entry.hits || 0) + 1;
    this.store.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Store an item in the cache with optional custom TTL.
   * Evicts the oldest entry if max capacity is exceeded.
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlMs] Custom TTL in milliseconds
   * @returns {any} Stored value
   */
  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.max) {
      // Evict oldest (first key in Map iterator)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    const duration = Math.max(1, Number(ttlMs) || this.defaultTtlMs);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + duration,
      createdAt: Date.now(),
      hits: 0,
    });
    this.stats.sets++;
    return value;
  }

  /**
   * Check if a key exists and has not expired.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a key from the cache.
   * @param {string} key
   * @returns {boolean} True if deleted
   */
  delete(key) {
    return this.store.delete(key);
  }

  /**
   * Clear all entries and reset stats.
   */
  clear() {
    this.store.clear();
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  /**
   * Prune expired entries to reclaim memory.
   * @returns {number} Count of removed entries
   */
  prune() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Current valid entry count after pruning.
   * @returns {number}
   */
  size() {
    this.prune();
    return this.store.size;
  }

  /**
   * Returns operational diagnostics and hit rate.
   * @returns {object}
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0
      ? ((this.stats.hits / totalRequests) * 100).toFixed(1) + '%'
      : '0.0%';

    return {
      name: this.name,
      size: this.store.size,
      max: this.max,
      defaultTtlMs: this.defaultTtlMs,
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      evictions: this.stats.evictions,
      hitRate,
    };
  }
}

/**
 * Fast 16-character SHA-256 hash helper for cache keys.
 * @param {string} str
 * @returns {string}
 */
export function hashKey(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex').slice(0, 16);
}

// ── Specialized Cache Stores for JakSafe ──

/**
 * CCTV Gemini Vision Analysis Cache
 * TTL: 90 seconds (frame updates every ~30-60s)
 * Max: 300 cameras
 */
export const cctvVisionCache = new InMemoryLRUCache({
  name: 'cctv_vision',
  max: 300,
  defaultTtlMs: 90_000,
});

/**
 * OSRM Route Geometry & Distance Cache
 * Physical road networks are static.
 * TTL: 2 hours
 * Max: 500 routes
 */
export const routeGeometryCache = new InMemoryLRUCache({
  name: 'route_geometry',
  max: 500,
  defaultTtlMs: 2 * 60 * 60 * 1000,
});

/**
 * ReAct Agent Navigation Recommendation Cache
 * Short TTL micro-cache for identical origin/destination queries.
 * TTL: 90 seconds
 * Max: 150 entries
 */
export const navigationCache = new InMemoryLRUCache({
  name: 'navigation_recommendations',
  max: 150,
  defaultTtlMs: 90_000,
});

/**
 * Geocoding & Reverse Geocoding Cache
 * Alamat dan nama tempat di Jakarta bersifat statis.
 * TTL: 24 hours
 * Max: 1000 entries
 */
export const geocodeCache = new InMemoryLRUCache({
  name: 'geocoding',
  max: 1000,
  defaultTtlMs: 24 * 60 * 60 * 1000,
});

export const cctvHealthCache = new InMemoryLRUCache({
  name: 'cctv_health',
  max: 1000,
  defaultTtlMs: 15 * 60 * 1000, // 15 minutes
});

/**
 * Get aggregated statistics for all registered cache stores.
 * @returns {object}
 */
export function getAllCacheStats() {
  return {
    cctvVision: cctvVisionCache.getStats(),
    cctvHealth: cctvHealthCache.getStats(),
    routeGeometry: routeGeometryCache.getStats(),
    navigation: navigationCache.getStats(),
    geocoding: geocodeCache.getStats(),
  };
}

/**
 * Clear all registered caches.
 */
export function clearAllCaches() {
  cctvVisionCache.clear();
  cctvHealthCache.clear();
  routeGeometryCache.clear();
  navigationCache.clear();
  geocodeCache.clear();
}
