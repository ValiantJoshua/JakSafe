// CCTV catalog: loads cctvCatalog.json, validates entries, finds nearest cameras.
// Camera source URLs are NEVER exposed to API clients (see publicView) — frames are
// only fetched server-side via cctvFrame.js, by camera id.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '../data/cctvCatalog.json');

let cache = { file: null, mtimeMs: 0, cameras: [] };

export function catalogPath() {
  return process.env.CCTV_FILE_PATH
    ? path.resolve(process.cwd(), process.env.CCTV_FILE_PATH)
    : DEFAULT_PATH;
}

function isValid(c) {
  return c && typeof c.id === 'string' && typeof c.name === 'string'
    && typeof c.url === 'string' && /^https?:\/\//i.test(c.url)
    && Number.isFinite(c.lat) && Number.isFinite(c.lon)
    && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180;
}

/** Load (and hot-reload on file change) the catalog. Invalid entries are skipped with a warning. */
export function loadCatalog() {
  const file = catalogPath();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    console.warn(`[cctv] catalog not found: ${file}`);
    cache = { file, mtimeMs: 0, cameras: [] };
    return cache.cameras;
  }
  if (cache.file === file && cache.mtimeMs === stat.mtimeMs) return cache.cameras;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[cctv] invalid JSON in ${file}: ${e.message}`);
    return cache.cameras;
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
    cameras.push({ feedType: 'image', ...c });
  }
  cache = { file, mtimeMs: stat.mtimeMs, cameras };
  console.log(`[cctv] loaded ${cameras.length} cameras from ${file}`);
  return cameras;
}

export function getCameraById(id) {
  return loadCatalog().find((c) => c.id === id) || null;
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
export function findNearest(lat, lon, { radiusM = 500, limit = 3 } = {}) {
  return loadCatalog()
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
    license: c.license ?? null,
  };
}
