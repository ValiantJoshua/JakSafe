// TomTom Traffic Service with Vector Tile Proxy, Caching & Budget Governor.
// Adapted from God's Eye View (MIT License) — src/data/tomtomTiles.js & vite.config.js tomtomProxy.
// See THIRD_PARTY_NOTICES.md.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const MIN_TILE_ZOOM = 8;
export const MAX_TILE_ZOOM = 18;
const MERCATOR_LAT_LIMIT = 85.05112878;

const TILE_TTL_MS = 180_000; // 3 minutes
const MEM_MAX_ENTRIES = 512;
const UPSTREAM_TIMEOUT_MS = 15_000;
const DEFAULT_DAILY_BUDGET = 6000; // Generous cap well under 200k/month TomTom freemium pool
const RASTER_STYLES = new Set([
  'relative0',
  'relative0-dark',
  'relative',
  'relative-delay',
  'absolute',
  'reduced-sensitivity',
]);
const TRANSPARENT_1PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64'
);

const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'tomtom');
const BUDGET_PATH = path.join(CACHE_DIR, 'budget.json');

/** Memory cache for tiles -> { at: number, buf: Buffer } */
const tileMemCache = new Map();
/** In-flight deduplication per tile */
const tileInflight = new Map();

/** Memory cache for segment data: key `lat,lon` -> { at: number, data: object } */
const segmentMemCache = new Map();

let budgetState = null;
let budgetLoaded = false;

// ── Tile Math & Validation (Adapted from GEV tomtomTiles.js) ──

function isWithinTileGrid(z, x, y) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > MAX_TILE_ZOOM) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

export function isValidTileCoord(z, x, y) {
  return z >= MIN_TILE_ZOOM && isWithinTileGrid(z, x, y);
}

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const clampedLat = Math.max(-MERCATOR_LAT_LIMIT, Math.min(MERCATOR_LAT_LIMIT, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

export function utcDayKey(epochMs = Date.now()) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function normalizeBudget(state, dayKey) {
  const valid = Boolean(state)
    && state.date === dayKey
    && Number.isFinite(state.count)
    && state.count >= 0;
  return valid ? state : { date: dayKey, count: 0 };
}

export function isOverBudget(budget, limit) {
  return (budget?.count ?? 0) >= limit;
}

export function getDailyBudgetLimit() {
  const raw = Number.parseInt(process.env.TOMTOM_DAILY_TILE_BUDGET || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_BUDGET;
}

// ── Persistent Budget Accounting ──

async function loadBudgetOnce() {
  if (budgetLoaded) return;
  budgetLoaded = true;
  try {
    const raw = await fsp.readFile(BUDGET_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.date === 'string' && Number.isFinite(parsed.count)) {
      budgetState = parsed;
    }
  } catch {
    // Budget file does not exist yet
  }
}

async function persistBudget() {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(BUDGET_PATH, JSON.stringify(budgetState), 'utf8');
  } catch (err) {
    console.warn('[tomtom] budget write failed:', err?.message || err);
  }
}

export async function getCurrentBudget() {
  await loadBudgetOnce();
  budgetState = normalizeBudget(budgetState, utcDayKey());
  return budgetState;
}

async function recordUpstreamFetch() {
  const b = await getCurrentBudget();
  b.count += 1;
  void persistBudget();
}

// ── Disk Tile Cache ──

const tileDiskPath = (diskFile) => path.join(CACHE_DIR, diskFile);

async function readDiskTile(diskFile) {
  try {
    const filePath = tileDiskPath(diskFile);
    const [stat, buf] = await Promise.all([
      fsp.stat(filePath),
      fsp.readFile(filePath),
    ]);
    return { at: stat.mtimeMs, buf };
  } catch {
    return null;
  }
}

async function writeDiskTile(diskFile, buf) {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(tileDiskPath(diskFile), buf);
  } catch (err) {
    console.warn(`[tomtom] tile cache write failed for ${diskFile}:`, err?.message || err);
  }
}

function memSetTile(key, entry) {
  if (!tileMemCache.has(key) && tileMemCache.size >= MEM_MAX_ENTRIES) {
    const oldest = tileMemCache.keys().next().value;
    tileMemCache.delete(oldest);
  }
  tileMemCache.set(key, entry);
}

// ── Upstream Fetchers ──

async function fetchTileUpstream(buildUrl) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error('no_key');

  const url = buildUrl(apiKey);
  await recordUpstreamFetch();

  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('empty tile body');
  return buf;
}

/**
 * Shared multi-level tile cache, single-flight deduplication, and budget governor.
 */
async function getCachedTile({ cacheKey, diskFile, buildUrl }) {
  const now = Date.now();

  let entry = tileMemCache.get(cacheKey);
  if (!entry) {
    entry = await readDiskTile(diskFile);
    if (entry) memSetTile(cacheKey, entry);
  }

  // Fresh cache hit
  if (entry && (now - entry.at) < TILE_TTL_MS) {
    return { buf: entry.buf, cacheStatus: 'HIT' };
  }

  // Budget check: serve stale tile if available over budget
  const budget = await getCurrentBudget();
  const limit = getDailyBudgetLimit();
  if (isOverBudget(budget, limit)) {
    if (entry) {
      return { buf: entry.buf, cacheStatus: 'STALE-BUDGET' };
    }
    throw new Error('budget_exceeded');
  }

  if (!process.env.TOMTOM_API_KEY) {
    throw new Error('no_key');
  }

  // Single-flight fetch
  if (!tileInflight.has(cacheKey)) {
    tileInflight.set(
      cacheKey,
      fetchTileUpstream(buildUrl)
        .then(async (buf) => {
          const fresh = { at: Date.now(), buf };
          memSetTile(cacheKey, fresh);
          await writeDiskTile(diskFile, buf);
          return fresh;
        })
        .catch((err) => {
          console.warn(`[tomtom] tile ${cacheKey} fetch failed (${err.message}) — serving stale if any`);
          return null;
        })
        .finally(() => tileInflight.delete(cacheKey))
    );
  }

  const fresh = await tileInflight.get(cacheKey);
  if (fresh) {
    return { buf: fresh.buf, cacheStatus: 'MISS' };
  }
  if (entry) {
    return { buf: entry.buf, cacheStatus: 'STALE-ERROR' };
  }
  throw new Error('upstream_error');
}

/**
 * Fetch a vector flow tile with multi-level caching, single-flight deduplication, and budget governing.
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {Promise<{ buf: Buffer, cacheStatus: string }>}
 */
export async function getFlowTile(z, x, y) {
  if (!isValidTileCoord(z, x, y)) {
    throw new Error('invalid_tile');
  }

  return getCachedTile({
    cacheKey: `pbf:${z}/${x}/${y}`,
    diskFile: `flow-${z}-${x}-${y}.pbf`,
    buildUrl: (apiKey) =>
      `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.pbf?key=${encodeURIComponent(apiKey)}`,
  });
}

/**
 * Fetch a transparent PNG raster flow tile for Cesium ImageryLayer overlays.
 * Returns a 1x1 transparent PNG below MIN_TILE_ZOOM with zero upstream API hits.
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {{ style?: string, tileSize?: number }} [opts]
 * @returns {Promise<{ buf: Buffer, cacheStatus: string }>}
 */
export async function getFlowRasterTile(z, x, y, { style = 'relative0', tileSize = 512 } = {}) {
  if (!isWithinTileGrid(z, x, y)) {
    throw new Error('invalid_tile');
  }
  if (z < MIN_TILE_ZOOM) {
    return { buf: TRANSPARENT_1PX_PNG, cacheStatus: 'EMPTY-ZOOM' };
  }

  const safeStyle = RASTER_STYLES.has(style) ? style : 'relative0';
  const safeSize = Number(tileSize) === 256 ? 256 : 512;

  return getCachedTile({
    cacheKey: `png:${safeStyle}:${safeSize}:${z}/${x}/${y}`,
    diskFile: `flow-${safeStyle}-${safeSize}-${z}-${x}-${y}.png`,
    buildUrl: (apiKey) =>
      `https://api.tomtom.com/traffic/map/4/tile/flow/${safeStyle}/${z}/${x}/${y}.png?tileSize=${safeSize}&key=${encodeURIComponent(apiKey)}`,
  });
}

/**
 * Fetch traffic speed & delay segment data for a coordinate (e.g. for AI Agent / scoring).
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object>}
 */
export async function getFlowSegment(lat, lon) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error('no_key');

  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = segmentMemCache.get(key);
  if (hit && Date.now() - hit.at <= TILE_TTL_MS) {
    return hit.data;
  }

  const budget = await getCurrentBudget();
  if (isOverBudget(budget, getDailyBudgetLimit())) {
    if (hit) return hit.data;
    throw new Error('budget_exceeded');
  }

  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative/10/json?point=${lat},${lon}&key=${encodeURIComponent(apiKey)}`;
  await recordUpstreamFetch();

  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const seg = json.flowSegmentData || {};

  const result = {
    currentSpeedKmH: seg.currentSpeed ?? null,
    freeFlowSpeedKmH: seg.freeFlowSpeed ?? null,
    currentTravelTimeS: seg.currentTravelTime ?? null,
    freeFlowTravelTimeS: seg.freeFlowTravelTime ?? null,
    delayPercent: (seg.currentTravelTime && seg.freeFlowTravelTime && seg.currentTravelTime > seg.freeFlowTravelTime)
      ? Math.round(((seg.currentTravelTime - seg.freeFlowTravelTime) / seg.freeFlowTravelTime) * 100)
      : 0,
    confidence: seg.confidence ?? null,
    roadClosure: Boolean(seg.roadClosure),
  };

  segmentMemCache.set(key, { at: Date.now(), data: result });
  if (segmentMemCache.size > 200) segmentMemCache.delete(segmentMemCache.keys().next().value);
  return result;
}

/**
 * Pick representative interior coordinates along a route geometry for multi-segment traffic sampling.
 * Avoids the very first/last 5% of the geometry (parking lots / minor origin-destination alleys)
 * and adapts sample count to route distance:
 *  - < 3 km   : 2 interior segments (33%, 67%)
 *  - 3–10 km  : 3 interior segments (25%, 50%, 75%)
 *  - >= 10 km : 4 interior segments (20%, 40%, 60%, 80%)
 *
 * @param {Array<[number, number]|{lat:number, lon:number}>} geometry
 * @param {{ distanceM?: number, count?: number }} [opts]
 * @returns {Array<{ lat: number, lon: number, ratio: number }>}
 */
export function pickTrafficSamplePoints(geometry, { distanceM = 0, count } = {}) {
  if (!Array.isArray(geometry) || geometry.length === 0) return [];

  // Normalize to { lat, lon }
  const pts = geometry
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        return { lon: Number(item[0]), lat: Number(item[1]) };
      }
      if (item && typeof item === 'object') {
        return { lon: Number(item.lon), lat: Number(item.lat) };
      }
      return null;
    })
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (pts.length === 0) return [];
  if (pts.length === 1) return [{ ...pts[0], ratio: 0.5 }];

  let targetCount = count;
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    if (distanceM >= 10000) targetCount = 4;
    else if (distanceM >= 3000 || distanceM === 0) targetCount = 3;
    else targetCount = 2;
  }
  targetCount = Math.min(Math.max(targetCount, 1), 5);

  const seenKeys = new Set();
  const samples = [];

  for (let i = 1; i <= targetCount; i++) {
    const ratio = Number((i / (targetCount + 1)).toFixed(2));
    const idx = Math.min(pts.length - 1, Math.max(0, Math.round(ratio * (pts.length - 1))));
    const pt = pts[idx];
    const dedupKey = `${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`;
    if (!seenKeys.has(dedupKey)) {
      seenKeys.add(dedupKey);
      samples.push({ lat: pt.lat, lon: pt.lon, ratio });
    }
  }

  if (samples.length === 0) {
    const mid = pts[Math.floor(pts.length / 2)];
    samples.push({ lat: mid.lat, lon: mid.lon, ratio: 0.5 });
  }

  return samples;
}

/**
 * Aggregate multiple TomTom Flow Segment measurements along a route into a unified traffic report.
 * Uses a bottleneck-weighted delay formula (60% corridor average + 40% worst bottleneck)
 * so long routes reflect both overall corridor flow and severe localized bottlenecks.
 *
 * @param {Array<object>} segments
 * @returns {object|null}
 */
export function aggregateTrafficSegments(segments) {
  const valid = (Array.isArray(segments) ? segments : []).filter(
    (s) => s && Number.isFinite(Number(s.delayPercent))
  );
  if (valid.length === 0) return null;

  let sumDelay = 0;
  let maxDelay = 0;
  let sumSpeed = 0;
  let speedCount = 0;
  let minSpeed = Infinity;
  let sumFreeFlow = 0;
  let freeFlowCount = 0;
  let anyClosure = false;
  let worstSegment = valid[0];

  for (const seg of valid) {
    const delay = Math.max(0, Number(seg.delayPercent) || 0);
    sumDelay += delay;
    if (delay > maxDelay || seg.roadClosure) {
      if (delay > maxDelay) maxDelay = delay;
      worstSegment = seg;
    }
    if (seg.roadClosure) {
      anyClosure = true;
    }
    if (Number.isFinite(seg.currentSpeedKmH)) {
      sumSpeed += seg.currentSpeedKmH;
      speedCount += 1;
      if (seg.currentSpeedKmH < minSpeed) minSpeed = seg.currentSpeedKmH;
    }
    if (Number.isFinite(seg.freeFlowSpeedKmH)) {
      sumFreeFlow += seg.freeFlowSpeedKmH;
      freeFlowCount += 1;
    }
  }

  const avgDelayPercent = Math.round(sumDelay / valid.length);
  // Bottleneck-aware effective delay: 60% corridor average + 40% peak bottleneck
  const effectiveDelayPercent = valid.length === 1
    ? maxDelay
    : Math.round(avgDelayPercent * 0.60 + maxDelay * 0.40);

  return {
    lat: worstSegment.lat,
    lon: worstSegment.lon,
    currentSpeedKmH: speedCount > 0 ? Math.round(sumSpeed / speedCount) : null,
    minSpeedKmH: minSpeed !== Infinity ? Math.round(minSpeed) : null,
    freeFlowSpeedKmH: freeFlowCount > 0 ? Math.round(sumFreeFlow / freeFlowCount) : null,
    delayPercent: effectiveDelayPercent,
    avgDelayPercent,
    maxDelayPercent: maxDelay,
    roadClosure: anyClosure,
    sampleCount: valid.length,
    worstSegment: {
      lat: worstSegment.lat,
      lon: worstSegment.lon,
      ratio: worstSegment.ratio ?? 0.5,
      delayPercent: Math.max(0, Number(worstSegment.delayPercent) || 0),
      currentSpeedKmH: worstSegment.currentSpeedKmH ?? null,
      roadClosure: Boolean(worstSegment.roadClosure),
    },
    segments: valid,
  };
}

/**
 * Sample real-time TomTom traffic across multiple points along a route corridor in parallel.
 *
 * @param {object} opts
 * @param {Array} [opts.geometry] Route geometry [[lon, lat], ...]
 * @param {Array<{lat:number, lon:number}>} [opts.points] Explicit sample points
 * @param {number} [opts.distanceM] Route length in meters (for adaptive sample count)
 * @param {number} [opts.count] Explicit number of samples (1..5)
 * @returns {Promise<object>}
 */
export async function sampleRouteTraffic({ geometry, points, distanceM = 0, count } = {}) {
  const samplePts = Array.isArray(points) && points.length > 0
    ? pickTrafficSamplePoints(points, { distanceM, count: points.length })
    : pickTrafficSamplePoints(geometry, { distanceM, count });

  if (samplePts.length === 0) {
    throw new Error('invalid_coordinates');
  }

  const settled = await Promise.allSettled(
    samplePts.map(async (pt) => {
      const seg = await getFlowSegment(pt.lat, pt.lon);
      return {
        lat: pt.lat,
        lon: pt.lon,
        ratio: pt.ratio ?? 0.5,
        ...seg,
      };
    })
  );

  const fulfilled = [];
  let lastError = null;
  for (const item of settled) {
    if (item.status === 'fulfilled' && item.value) {
      fulfilled.push(item.value);
    } else if (item.status === 'rejected') {
      lastError = item.reason;
    }
  }

  if (fulfilled.length === 0) {
    throw lastError || new Error('upstream_error');
  }

  return aggregateTrafficSegments(fulfilled);
}
