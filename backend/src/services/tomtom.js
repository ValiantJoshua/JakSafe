// TomTom Traffic Service with Vector Tile Proxy, Caching & Budget Governor.
// Adapted from God's Eye View (MIT License) — src/data/tomtomTiles.js & vite.config.js tomtomProxy.
// See THIRD_PARTY_NOTICES.md.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const MIN_TILE_ZOOM = 8;
export const MAX_TILE_ZOOM = 16;
const MERCATOR_LAT_LIMIT = 85.05112878;

const TILE_TTL_MS = 120_000; // 2 minutes
const MEM_MAX_ENTRIES = 256;
const UPSTREAM_TIMEOUT_MS = 15_000;
const DEFAULT_DAILY_BUDGET = 2400; // Safe cap under the 2,500/day free tier limit

const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'tomtom');
const BUDGET_PATH = path.join(CACHE_DIR, 'budget.json');

/** Memory cache for tiles: key `z/x/y` -> { at: number, buf: Buffer } */
const tileMemCache = new Map();
/** In-flight deduplication per tile */
const tileInflight = new Map();

/** Memory cache for segment data: key `lat,lon` -> { at: number, data: object } */
const segmentMemCache = new Map();

let budgetState = null;
let budgetLoaded = false;

// ── Tile Math & Validation (Adapted from GEV tomtomTiles.js) ──

export function isValidTileCoord(z, x, y) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < MIN_TILE_ZOOM || z > MAX_TILE_ZOOM) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
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

const tileDiskPath = (key) => path.join(CACHE_DIR, `flow-${key.replaceAll('/', '-')}.pbf`);

async function readDiskTile(key) {
  try {
    const [stat, buf] = await Promise.all([
      fsp.stat(tileDiskPath(key)),
      fsp.readFile(tileDiskPath(key)),
    ]);
    return { at: stat.mtimeMs, buf };
  } catch {
    return null;
  }
}

async function writeDiskTile(key, buf) {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(tileDiskPath(key), buf);
  } catch (err) {
    console.warn(`[tomtom] tile cache write failed for ${key}:`, err?.message || err);
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

async function fetchTileUpstream(z, x, y) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error('no_key');

  const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.pbf?key=${encodeURIComponent(apiKey)}`;
  await recordUpstreamFetch();

  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('empty tile body');
  return buf;
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

  const key = `${z}/${x}/${y}`;
  const now = Date.now();

  let entry = tileMemCache.get(key);
  if (!entry) {
    entry = await readDiskTile(key);
    if (entry) memSetTile(key, entry);
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
  if (!tileInflight.has(key)) {
    tileInflight.set(
      key,
      fetchTileUpstream(z, x, y)
        .then(async (buf) => {
          const fresh = { at: Date.now(), buf };
          memSetTile(key, fresh);
          await writeDiskTile(key, buf);
          return fresh;
        })
        .catch((err) => {
          console.warn(`[tomtom] tile ${key} fetch failed (${err.message}) — serving stale if any`);
          return null;
        })
        .finally(() => tileInflight.delete(key))
    );
  }

  const fresh = await tileInflight.get(key);
  if (fresh) {
    return { buf: fresh.buf, cacheStatus: 'MISS' };
  }
  if (entry) {
    return { buf: entry.buf, cacheStatus: 'STALE-ERROR' };
  }
  throw new Error('upstream_error');
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
