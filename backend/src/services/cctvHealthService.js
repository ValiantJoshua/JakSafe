import { cctvHealthCache } from './cacheService.js';
import { loadCatalog } from './cctvCatalog.js';
import { assertPublicHttpUrl, FrameError } from './cctvFrame.js';
import { isMongoActive } from '../db/storageService.js';
import { CctvStatus } from '../db/models/CctvStatus.js';

export const HEALTH_RAM_TTL_MS = 15 * 60 * 1000;
export const HEALTH_DB_TTL_MS = 30 * 60 * 1000;
export const OFFLINE_RAM_TTL_MS = 5 * 60 * 1000;
export const OFFLINE_DB_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
export const PROBE_TIMEOUT_MS = 6000;
export const PROBE_RETRY_DELAY_MS = 350;
export const SWEEP_CONCURRENCY = 12;

const MAX_REDIRECTS = 3;
const VALID_STATUSES = new Set(['online', 'offline', 'unknown']);
const STATUS_PRIORITY = { online: 0, unknown: 1, offline: 2 };

let sweepPromise = null;
let sweepTimer = null;
let lastSweepStats = null;
let hydratedCount = 0;

/**
 * Retrieve cached health status for a single camera.
 * @param {string} cameraId
 * @returns {{ status: 'online'|'offline'|'unknown', reason: string|null, latencyMs: number|null, checkedAt: string|null }}
 */
export function getCameraHealth(cameraId) {
  const entry = cameraId ? cctvHealthCache.get(cameraId) : null;
  if (!entry) {
    return { status: 'unknown', reason: null, latencyMs: null, checkedAt: null };
  }
  return entry;
}

/**
 * Enrich a sanitized public camera view with cached health metadata.
 * @param {object} publicCam
 * @returns {object}
 */
export function attachHealth(publicCam) {
  const health = getCameraHealth(publicCam.id);
  return {
    ...publicCam,
    status: health.status,
    statusReason: health.reason,
    lastCheckedAt: health.checkedAt,
  };
}

/**
 * Compute aggregate camera health counts from the in-memory cache.
 * @param {Array<{id: string}>} [cameras]
 * @returns {object}
 */
export function getHealthSummary(cameras = loadCatalog()) {
  let online = 0;
  let offline = 0;
  let unknown = 0;

  for (const cam of cameras) {
    const { status } = getCameraHealth(cam.id);
    if (status === 'online') online += 1;
    else if (status === 'offline') offline += 1;
    else unknown += 1;
  }

  return {
    total: cameras.length,
    online,
    offline,
    unknown,
    sweepInProgress: Boolean(sweepPromise),
    hydratedFromDb: hydratedCount,
    lastSweep: lastSweepStats,
  };
}

/**
 * Persist or update a single camera health entry in RAM LRU cache and optionally MongoDB.
 * Used both by the periodic background sweep and passively by /frame/:id or agent tools.
 * @param {string} cameraId
 * @param {object} details
 * @returns {object|null}
 */
export function recordCameraHealth(
  cameraId,
  { status, reason = null, latencyMs = null, checkedAt = new Date(), syncDb = true } = {}
) {
  if (!cameraId || !VALID_STATUSES.has(status)) return null;

  const checkedDate = checkedAt instanceof Date ? checkedAt : new Date(checkedAt);
  const checkedIso = Number.isNaN(checkedDate.getTime()) ? new Date().toISOString() : checkedDate.toISOString();
  const normalizedLatency = Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : null;

  const entry = {
    status,
    reason: reason ? String(reason).slice(0, 120) : null,
    latencyMs: normalizedLatency,
    checkedAt: checkedIso,
  };

  const ramTtlMs = entry.status === 'offline' ? OFFLINE_RAM_TTL_MS : HEALTH_RAM_TTL_MS;
  const dbTtlMs = entry.status === 'offline' ? OFFLINE_DB_TTL_MS : HEALTH_DB_TTL_MS;
  cctvHealthCache.set(cameraId, entry, ramTtlMs);

  if (syncDb && isMongoActive()) {
    const expiresAt = new Date(Date.now() + dbTtlMs);
    CctvStatus.updateOne(
      { cameraId },
      {
        $set: {
          cameraId,
          status: entry.status,
          reason: entry.reason,
          latencyMs: entry.latencyMs,
          checkedAt: new Date(checkedIso),
          expiresAt,
        },
      },
      { upsert: true }
    ).catch((err) => {
      console.warn('[cctvHealth] async Mongo upsert skipped:', err?.message || err);
    });
  }

  return entry;
}

/**
 * Hydrate non-expired camera health records from MongoDB into the fast in-memory LRU cache.
 * Runs cleanly as a no-op if MongoDB is disconnected.
 * @returns {Promise<{ hydrated: number, skipped: boolean }>}
 */
export async function hydrateHealthFromMongo() {
  if (!isMongoActive()) {
    return { hydrated: 0, skipped: true };
  }

  try {
    const nowMs = Date.now();
    const docs = await CctvStatus.find({ expiresAt: { $gt: new Date(nowMs) } }).lean();
    let count = 0;

    for (const doc of docs) {
      if (!doc?.cameraId || !VALID_STATUSES.has(doc.status)) continue;
      const remainingDbMs = new Date(doc.expiresAt).getTime() - nowMs;
      if (remainingDbMs <= 1000) continue;

      const maxRamTtl = doc.status === 'offline' ? OFFLINE_RAM_TTL_MS : HEALTH_RAM_TTL_MS;
      const ttlMs = Math.min(maxRamTtl, remainingDbMs);
      cctvHealthCache.set(
        doc.cameraId,
        {
          status: doc.status,
          reason: doc.reason || null,
          latencyMs: Number.isFinite(doc.latencyMs) ? doc.latencyMs : null,
          checkedAt: doc.checkedAt ? new Date(doc.checkedAt).toISOString() : null,
        },
        ttlMs
      );
      count += 1;
    }

    hydratedCount = count;
    return { hydrated: count, skipped: false };
  } catch (err) {
    console.warn('[cctvHealth] failed to hydrate from MongoDB:', err?.message || err);
    return { hydrated: 0, skipped: true };
  }
}

async function fetchProbeResponse(urlStr, { method, timeoutMs, fetchImpl }) {
  let currentUrl = urlStr;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHttpUrl(currentUrl);
    const res = await fetchImpl(currentUrl, {
      method,
      headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)', Accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`redirect ${res.status} without location`);
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

function validateImageHeaders(res) {
  if (!res.ok) {
    return {
      ok: false,
      reason: `HTTP ${res.status}`,
      retryable: res.status === 429 || res.status >= 500 || res.status === 408,
    };
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('image/svg+xml')) {
    return { ok: false, reason: 'svg offline placeholder', retryable: false };
  }
  if (contentType && !contentType.startsWith('image/')) {
    return { ok: false, reason: `non-image (${contentType.split(';')[0]})`, retryable: false };
  }
  const contentLength = res.headers.get('content-length');
  if (contentLength === '0') {
    return { ok: false, reason: 'empty frame (0 bytes)', retryable: true };
  }
  return { ok: true, hasImageType: contentType.startsWith('image/') };
}

async function hasNonEmptyBodyChunk(res) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = await res.arrayBuffer();
    return buf.byteLength > 0;
  }
  const reader = res.body.getReader();
  try {
    const { done, value } = await reader.read();
    return !done && Boolean(value && value.byteLength > 0);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function probeGetOnce(urlStr, { timeoutMs, fetchImpl }) {
  const getRes = await fetchProbeResponse(urlStr, { method: 'GET', timeoutMs, fetchImpl });
  const getCheck = validateImageHeaders(getRes);
  if (!getCheck.ok) {
    await getRes.body?.cancel().catch(() => {});
    return { ok: false, reason: getCheck.reason, retryable: getCheck.retryable };
  }

  const nonEmpty = await hasNonEmptyBodyChunk(getRes);
  return nonEmpty
    ? { ok: true, reason: null, retryable: false }
    : { ok: false, reason: 'empty frame body', retryable: true };
}

/**
 * Probe a single camera snapshot endpoint without consuming AI/Vision tokens.
 * Uses HTTP HEAD first, falls back to lightweight GET when needed, and performs
 * 1x automatic GET retry on transient timeouts/5xx to match cold-start wake-up behavior.
 * @param {object} camera
 * @param {object} [opts]
 * @returns {Promise<{ status: 'online'|'offline', reason: string|null, latencyMs: number }>}
 */
export async function checkCameraEndpoint(
  camera,
  { timeoutMs = PROBE_TIMEOUT_MS, retryDelayMs = PROBE_RETRY_DELAY_MS, fetchImpl = globalThis.fetch } = {}
) {
  if (!camera?.url) {
    return { status: 'offline', reason: 'missing snapshot url', latencyMs: 0 };
  }

  const startedAt = Date.now();
  let lastFailure = { reason: 'probe failed', retryable: true };

  // Attempt 1: fast HEAD (bounded at max 4.5s); fallback cleanly to GET if needed
  try {
    const headTimeoutMs = Math.min(timeoutMs, 4500);
    const headRes = await fetchProbeResponse(camera.url, {
      method: 'HEAD',
      timeoutMs: headTimeoutMs,
      fetchImpl,
    });
    await headRes.body?.cancel().catch(() => {});

    if (headRes.status !== 405 && headRes.status !== 501) {
      const headerCheck = validateImageHeaders(headRes);
      if (headerCheck.ok && headerCheck.hasImageType) {
        return { status: 'online', reason: null, latencyMs: Date.now() - startedAt };
      }
      if (!headerCheck.ok && !headerCheck.retryable) {
        return {
          status: 'offline',
          reason: headerCheck.reason,
          latencyMs: Date.now() - startedAt,
        };
      }
      lastFailure = {
        reason: headerCheck.ok ? 'missing content-type on HEAD' : headerCheck.reason,
        retryable: true,
      };
    } else {
      lastFailure = { reason: `HEAD ${headRes.status}`, retryable: true };
    }
  } catch (err) {
    if (err instanceof FrameError) {
      return {
        status: 'offline',
        reason: err.message,
        latencyMs: Date.now() - startedAt,
      };
    }
    lastFailure = {
      reason:
        err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? `timeout (${Math.min(timeoutMs, 4500)}ms)`
          : err?.message || 'probe failed',
      retryable: true,
    };
  }

  // Attempt 2 (& optional 1x retry): lightweight GET with header + first-chunk check
  const maxGetAttempts = lastFailure.retryable ? 2 : 1;
  for (let attempt = 0; attempt < maxGetAttempts; attempt += 1) {
    if (attempt > 0 && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    try {
      const res = await probeGetOnce(camera.url, { timeoutMs, fetchImpl });
      if (res.ok) {
        return { status: 'online', reason: null, latencyMs: Date.now() - startedAt };
      }
      lastFailure = res;
      if (!res.retryable) break;
    } catch (err) {
      if (err instanceof FrameError) {
        return {
          status: 'offline',
          reason: err.message,
          latencyMs: Date.now() - startedAt,
        };
      }
      lastFailure = {
        reason:
          err?.name === 'TimeoutError' || err?.name === 'AbortError'
            ? `timeout (${timeoutMs}ms)`
            : err?.message || 'probe failed',
        retryable: true,
      };
    }
  }

  return {
    status: 'offline',
    reason: String(lastFailure.reason || 'probe failed').slice(0, 120),
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * Scan all catalog cameras with bounded concurrency and batch-persist statuses to MongoDB.
 * Deduplicates concurrent sweep requests cleanly.
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export function runHealthSweep({
  cameras = loadCatalog(),
  concurrency = SWEEP_CONCURRENCY,
  timeoutMs = PROBE_TIMEOUT_MS,
  persistDb = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (sweepPromise) return sweepPromise;

  sweepPromise = (async () => {
    const startedAt = Date.now();
    const list = Array.isArray(cameras) ? cameras : [];
    const total = list.length;
    const batchOps = [];
    let cursor = 0;
    let online = 0;
    let offline = 0;

    const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, total));
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < total) {
        const idx = cursor;
        cursor += 1;
        const cam = list[idx];
        const result = await checkCameraEndpoint(cam, { timeoutMs, fetchImpl });
        const checkedAt = new Date();

        if (result.status === 'online') online += 1;
        else offline += 1;

        recordCameraHealth(cam.id, {
          status: result.status,
          reason: result.reason,
          latencyMs: result.latencyMs,
          checkedAt,
          syncDb: false,
        });

        batchOps.push({
          updateOne: {
            filter: { cameraId: cam.id },
            update: {
              $set: {
                cameraId: cam.id,
                status: result.status,
                reason: result.reason,
                latencyMs: result.latencyMs,
                checkedAt,
                expiresAt: new Date(
                  checkedAt.getTime() +
                    (result.status === 'offline' ? OFFLINE_DB_TTL_MS : HEALTH_DB_TTL_MS)
                ),
              },
            },
            upsert: true,
          },
        });
      }
    });

    await Promise.all(workers);

    let persistedToDb = false;
    if (persistDb && batchOps.length > 0 && isMongoActive()) {
      try {
        await CctvStatus.bulkWrite(batchOps, { ordered: false });
        persistedToDb = true;
      } catch (err) {
        console.warn('[cctvHealth] Mongo bulkWrite failed:', err?.message || err);
      }
    }

    lastSweepStats = {
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      total,
      online,
      offline,
      persistedToDb,
    };

    return lastSweepStats;
  })().finally(() => {
    sweepPromise = null;
  });

  return sweepPromise;
}

/**
 * Sort candidate `{ camera, distanceM }` objects so online cameras come first,
 * followed by unknown, and known-offline cameras last (preserving relative distance order).
 * @param {Array<{ camera: { id: string }, distanceM: number }>} candidates
 * @returns {Array<{ camera: { id: string }, distanceM: number }>}
 */
export function sortCandidatesByHealth(candidates) {
  if (!Array.isArray(candidates) || candidates.length <= 1) return candidates;
  return candidates
    .map((item, idx) => ({
      item,
      idx,
      prio: STATUS_PRIORITY[getCameraHealth(item.camera?.id).status] ?? STATUS_PRIORITY.unknown,
    }))
    .sort((a, b) => (a.prio !== b.prio ? a.prio - b.prio : a.idx - b.idx))
    .map((entry) => entry.item);
}

/**
 * Start background health hydration (from MongoDB) + periodic HTTP probe sweeps.
 * Uses an unref'd interval timer so Node test runners and clean shutdowns are never blocked.
 * @param {object} [opts]
 */
export async function startCctvHealthScheduler({
  intervalMs = DEFAULT_SWEEP_INTERVAL_MS,
  concurrency = SWEEP_CONCURRENCY,
} = {}) {
  const { hydrated } = await hydrateHealthFromMongo();
  const catalog = loadCatalog();

  if (hydrated > 0) {
    console.log(`[cctvHealth] Hydrated ${hydrated}/${catalog.length} camera statuses from MongoDB.`);
  }

  // Trigger an immediate background sweep if RAM/DB coverage is sparse (<50%)
  const covered = catalog.reduce(
    (acc, cam) => (cctvHealthCache.has(cam.id) ? acc + 1 : acc),
    0
  );
  if (covered < Math.ceil(catalog.length * 0.5)) {
    runHealthSweep({ cameras: catalog, concurrency })
      .then((stats) => {
        console.log(
          `[cctvHealth] Initial sweep done: ${stats.online} online, ${stats.offline} offline in ${stats.durationMs}ms (db=${stats.persistedToDb})`
        );
      })
      .catch((err) => console.warn('[cctvHealth] Initial sweep error:', err?.message || err));
  }

  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(() => {
    runHealthSweep({ concurrency }).catch((err) => {
      console.warn('[cctvHealth] Scheduled sweep error:', err?.message || err);
    });
  }, intervalMs);
  sweepTimer.unref?.();
}

export function stopCctvHealthScheduler() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

