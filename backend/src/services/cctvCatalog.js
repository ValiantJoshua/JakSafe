// CCTV catalog: loads cctvCatalog.json, validates entries, finds nearest cameras.
// Camera source URLs are NEVER exposed to API clients (see publicView) — frames are
// only fetched server-side via cctvFrame.js, by camera id.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  getCatalogOverridesMapSync,
  getCatalogOverridesVersion,
  upsertCatalogOverride,
  removeCatalogOverride,
} from '../db/cctvCatalogStore.js';
import { cctvVisionCache, cctvHealthCache } from './cacheService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '../data/cctvCatalog.json');

let baseCache = { file: null, mtimeMs: 0, cameras: [] };
let mergedCache = { file: null, mtimeMs: 0, overridesVersion: -1, allNonDeleted: [], activeOnly: [] };

export class CatalogError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CatalogError';
    this.status = status;
  }
}

export function catalogPath() {
  return process.env.CCTV_FILE_PATH
    ? path.resolve(process.cwd(), process.env.CCTV_FILE_PATH)
    : DEFAULT_PATH;
}

function isBlockedHostLiteral(host) {
  const clean = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean) return true;
  if (clean === 'localhost' || clean.endsWith('.local') || clean.endsWith('.internal')) return true;
  if (net.isIPv4(clean)) {
    const [a, b] = clean.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(clean)) {
    return clean === '::1' || clean === '::' || clean.startsWith('fc') || clean.startsWith('fd')
      || clean.startsWith('fe80') || clean.startsWith('::ffff:');
  }
  return false;
}

function isSafeHttpUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) return false;
  let parsed;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return !isBlockedHostLiteral(parsed.hostname);
}

function isValid(c) {
  return c && typeof c.id === 'string' && c.id.trim().length > 0
    && typeof c.name === 'string' && c.name.trim().length > 0
    && typeof c.url === 'string' && /^https?:\/\//i.test(c.url)
    && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))
    && Math.abs(Number(c.lat)) <= 90 && Math.abs(Number(c.lon)) <= 180;
}

function loadBaseCatalog() {
  const file = catalogPath();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    console.warn(`[cctv] catalog not found: ${file}`);
    baseCache = { file, mtimeMs: 0, cameras: [] };
    return baseCache;
  }
  if (baseCache.file === file && baseCache.mtimeMs === stat.mtimeMs) return baseCache;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[cctv] invalid JSON in ${file}: ${e.message}`);
    return baseCache;
  }
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const cameras = [];
  for (const c of list) {
    if (!isValid(c)) {
      console.warn(`[cctv] skipped invalid entry: ${c?.id ?? '(no id)'}`);
      continue;
    }
    if (seen.has(c.id)) {
      console.warn(`[cctv] skipped duplicate id: ${c.id}`);
      continue;
    }
    seen.add(c.id);
    cameras.push({ feedType: 'image', ...c, lat: Number(c.lat), lon: Number(c.lon) });
  }
  baseCache = { file, mtimeMs: stat.mtimeMs, cameras };
  console.log(`[cctv] loaded ${cameras.length} cameras from ${file}`);
  return baseCache;
}

/**
 * Muat katalog CCTV dengan penggabungan override admin persisten.
 * Secara bawaan (`includeDisabled = false`) hanya kamera aktif yang dikembalikan
 * sehingga kamera nonaktif otomatis dikecualikan dari routing, frame proxy, dan peta publik.
 */
export function loadCatalog({ includeDisabled = false } = {}) {
  const base = loadBaseCatalog();
  const overridesVersion = getCatalogOverridesVersion();

  if (
    mergedCache.file === base.file
    && mergedCache.mtimeMs === base.mtimeMs
    && mergedCache.overridesVersion === overridesVersion
  ) {
    return includeDisabled ? mergedCache.allNonDeleted : mergedCache.activeOnly;
  }

  const overrides = getCatalogOverridesMapSync();
  const allNonDeleted = [];
  const seenIds = new Set();

  for (const baseCam of base.cameras) {
    const ov = overrides.get(baseCam.id);
    if (ov?.deleted) {
      seenIds.add(baseCam.id);
      continue;
    }
    const merged = {
      ...baseCam,
      ...(ov?.patch || {}),
      id: baseCam.id,
      enabled: ov ? ov.enabled !== false : true,
      isCustom: false,
      hasOverride: Boolean(ov),
    };
    if (isValid(merged)) {
      seenIds.add(merged.id);
      allNonDeleted.push({
        ...merged,
        lat: Number(merged.lat),
        lon: Number(merged.lon),
      });
    }
  }

  for (const ov of overrides.values()) {
    if (!ov?.isCustom || ov.deleted || seenIds.has(ov.cameraId)) continue;
    const candidate = {
      feedType: 'image',
      ...(ov.patch || {}),
      id: ov.cameraId,
      enabled: ov.enabled !== false,
      isCustom: true,
      hasOverride: true,
    };
    if (isValid(candidate)) {
      seenIds.add(candidate.id);
      allNonDeleted.push({
        ...candidate,
        lat: Number(candidate.lat),
        lon: Number(candidate.lon),
      });
    }
  }

  const activeOnly = allNonDeleted.filter((c) => c.enabled !== false);
  mergedCache = {
    file: base.file,
    mtimeMs: base.mtimeMs,
    overridesVersion,
    allNonDeleted,
    activeOnly,
  };

  return includeDisabled ? mergedCache.allNonDeleted : mergedCache.activeOnly;
}

export function getCameraById(id, { includeDisabled = false } = {}) {
  return loadCatalog({ includeDisabled }).find((c) => c.id === id) || null;
}

/** Haversine distance in meters. */
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Cameras within radiusM of a point, nearest first. */
export function findNearest(lat, lon, { radiusM = 500, limit = 3, includeDisabled = false } = {}) {
  return loadCatalog({ includeDisabled })
    .map((c) => ({ camera: c, distanceM: Math.round(distanceM(lat, lon, c.lat, c.lon)) }))
    .filter((x) => x.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/** Safe-to-expose camera info (no source URL). */
export function publicView(c) {
  return {
    id: c.id,
    name: c.name,
    city: c.city ?? null,
    provider: c.provider ?? null,
    lat: c.lat,
    lon: c.lon,
    headingDeg: c.headingDeg ?? null,
    pitchDeg: c.pitchDeg ?? null,
    fovDeg: c.fovDeg ?? null,
    rangeM: c.rangeM ?? null,
    feedType: c.feedType,
    hasLiveStream: Boolean(c.hlsUrl),
    license: c.license ?? null,
  };
}

/** Detail kamera lengkap khusus panel administrator (menyertakan URL sumber dan status override). */
export function adminView(c) {
  return {
    ...publicView(c),
    cityId: c.cityId ?? null,
    mountHeightM: c.mountHeightM ?? null,
    url: c.url,
    hlsUrl: c.hlsUrl ?? null,
    enabled: c.enabled !== false,
    isCustom: Boolean(c.isCustom),
    hasOverride: Boolean(c.hasOverride),
  };
}

function optFiniteNumber(val, min, max) {
  if (val === undefined) return undefined;
  if (val === null || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num < min || num > max) return NaN;
  return num;
}

function slugifyId(name) {
  const base = String(name || 'cam')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'cam';
  return `custom-${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function buildValidatedPatch(input, { requireAll = false, existing = {} } = {}) {
  const patch = {};

  if (requireAll || input.name !== undefined) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new CatalogError('Nama kamera wajib diisi.', 400);
    patch.name = name.slice(0, 160);
  }

  if (requireAll || input.url !== undefined) {
    const url = String(input.url ?? '').trim();
    if (!isSafeHttpUrl(url)) {
      throw new CatalogError('URL snapshot kamera harus berupa HTTP/HTTPS publik yang valid.', 400);
    }
    patch.url = url;
  }

  if (input.hlsUrl !== undefined) {
    const hls = String(input.hlsUrl ?? '').trim();
    if (!hls) {
      patch.hlsUrl = null;
    } else if (!isSafeHttpUrl(hls)) {
      throw new CatalogError('URL stream HLS harus berupa HTTP/HTTPS publik yang valid.', 400);
    } else {
      patch.hlsUrl = hls;
    }
  }

  if (requireAll || input.lat !== undefined) {
    const lat = Number(input.lat);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
      throw new CatalogError('Latitude kamera tidak valid (-90 s.d. 90).', 400);
    }
    patch.lat = lat;
  }

  if (requireAll || input.lon !== undefined) {
    const lon = Number(input.lon);
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
      throw new CatalogError('Longitude kamera tidak valid (-180 s.d. 180).', 400);
    }
    patch.lon = lon;
  }

  for (const [key, limit] of [
    ['city', 80],
    ['cityId', 40],
    ['provider', 80],
    ['license', 120],
  ]) {
    if (input[key] !== undefined) {
      const s = String(input[key] ?? '').trim();
      patch[key] = s ? s.slice(0, limit) : null;
    }
  }

  for (const [key, min, max] of [
    ['headingDeg', 0, 360],
    ['pitchDeg', -90, 90],
    ['fovDeg', 10, 180],
    ['rangeM', 10, 5000],
    ['mountHeightM', 1, 200],
  ]) {
    if (input[key] !== undefined) {
      const parsed = optFiniteNumber(input[key], min, max);
      if (Number.isNaN(parsed)) {
        throw new CatalogError(`Nilai ${key} di luar rentang valid (${min}..${max}).`, 400);
      }
      patch[key] = parsed;
    }
  }

  const candidate = { feedType: 'image', ...existing, ...patch };
  if (requireAll && !isValid({ ...candidate, id: existing.id || 'temp-id' })) {
    throw new CatalogError('Data kamera tidak memenuhi format katalog.', 400);
  }
  return patch;
}

export async function createCamera(input = {}, { updatedBy = null } = {}) {
  const rawId = input.id !== undefined ? String(input.id).trim() : '';
  const id = rawId || slugifyId(input.name);
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id)) {
    throw new CatalogError('ID kamera hanya boleh berisi huruf, angka, tanda hubung (-), atau garis bawah (_).', 400);
  }

  const existingAll = loadCatalog({ includeDisabled: true });
  const baseMatch = loadBaseCatalog().cameras.find((c) => c.id === id);
  if (existingAll.some((c) => c.id === id) || baseMatch) {
    throw new CatalogError(`Kamera dengan ID "${id}" sudah ada di katalog.`, 409);
  }

  const patch = buildValidatedPatch(
    { city: 'Jakarta', provider: 'Kustom Admin', ...input },
    { requireAll: true }
  );
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : true;

  await upsertCatalogOverride(id, {
    isCustom: true,
    enabled,
    deleted: false,
    patch,
    updatedBy,
  });

  cctvVisionCache.delete(`cctv:${id}`);
  cctvHealthCache.delete(id);
  return getCameraById(id, { includeDisabled: true });
}

export async function updateCamera(id, input = {}, { updatedBy = null } = {}) {
  const existing = getCameraById(id, { includeDisabled: true });
  if (!existing) {
    throw new CatalogError('Kamera tidak ditemukan di katalog.', 404);
  }

  const overrides = getCatalogOverridesMapSync();
  const prevOv = overrides.get(id);
  const patch = buildValidatedPatch(input, { requireAll: false, existing });
  const nextPatch = { ...(prevOv?.patch || {}), ...patch };
  const nextEnabled = input.enabled !== undefined
    ? Boolean(input.enabled)
    : (prevOv ? prevOv.enabled !== false : existing.enabled !== false);

  await upsertCatalogOverride(id, {
    isCustom: Boolean(existing.isCustom),
    enabled: nextEnabled,
    deleted: false,
    patch: nextPatch,
    updatedBy,
  });

  cctvVisionCache.delete(`cctv:${id}`);
  return getCameraById(id, { includeDisabled: true });
}

export async function setCameraEnabled(id, enabled, { updatedBy = null } = {}) {
  const existing = getCameraById(id, { includeDisabled: true });
  if (!existing) {
    throw new CatalogError('Kamera tidak ditemukan di katalog.', 404);
  }

  const overrides = getCatalogOverridesMapSync();
  const prevOv = overrides.get(id);

  await upsertCatalogOverride(id, {
    isCustom: Boolean(existing.isCustom),
    enabled: Boolean(enabled),
    deleted: false,
    patch: prevOv?.patch || {},
    updatedBy,
  });

  cctvVisionCache.delete(`cctv:${id}`);
  return getCameraById(id, { includeDisabled: true });
}

export async function deleteCamera(id, { updatedBy = null } = {}) {
  const existing = getCameraById(id, { includeDisabled: true });
  if (!existing) {
    throw new CatalogError('Kamera tidak ditemukan di katalog.', 404);
  }

  const isBase = loadBaseCatalog().cameras.some((c) => c.id === id);
  if (existing.isCustom && !isBase) {
    await removeCatalogOverride(id);
  } else {
    const prevOv = getCatalogOverridesMapSync().get(id);
    await upsertCatalogOverride(id, {
      isCustom: false,
      enabled: false,
      deleted: true,
      patch: prevOv?.patch || {},
      updatedBy,
    });
  }

  cctvVisionCache.delete(`cctv:${id}`);
  cctvHealthCache.delete(id);
  return { id, deleted: true, recoverable: isBase };
}

export async function restoreCamera(id) {
  const isBase = loadBaseCatalog().cameras.some((c) => c.id === id);
  if (!isBase) {
    throw new CatalogError('Hanya kamera bawaan katalog dasar yang dapat dipulihkan.', 404);
  }
  await removeCatalogOverride(id);
  cctvVisionCache.delete(`cctv:${id}`);
  return getCameraById(id, { includeDisabled: true });
}

export function getCatalogOverrideStats() {
  const overrides = getCatalogOverridesMapSync();
  let customCount = 0;
  let disabledCount = 0;
  let modifiedBaseCount = 0;
  let deletedBaseCount = 0;

  for (const ov of overrides.values()) {
    if (ov.deleted) {
      if (!ov.isCustom) deletedBaseCount += 1;
      continue;
    }
    if (ov.isCustom) customCount += 1;
    else if (Object.keys(ov.patch || {}).length > 0) modifiedBaseCount += 1;
    if (ov.enabled === false) disabledCount += 1;
  }

  return {
    baseTotal: loadBaseCatalog().cameras.length,
    activeTotal: loadCatalog({ includeDisabled: false }).length,
    catalogTotal: loadCatalog({ includeDisabled: true }).length,
    customCount,
    disabledCount,
    modifiedBaseCount,
    deletedBaseCount,
  };
}
