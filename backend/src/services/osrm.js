// OSRM routing service (public FOSSGIS servers; no API key required).
// Used by both the GET /api/route endpoint and the agent's Tool 1 (get_route).
// Request/validation approach adapted from God's Eye View (MIT) — vite.config.js `/api/route`.
// See THIRD_PARTY_NOTICES.md.

const OSRM_BASE = 'https://routing.openstreetmap.de';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const TIMEOUT_MS = 12_000;

const PROFILE_ALIASES = {
  car: 'car', driving: 'car',
  bike: 'bike', cycling: 'bike', bicycle: 'bike',
  foot: 'foot', walking: 'foot', walk: 'foot',
};
const OSRM_PROFILE = { car: 'driving', bike: 'bike', foot: 'foot' };

const cache = new Map();

export class RouteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Parse "lon,lat;lon,lat" into [[lon, lat], ...] with validation. */
export function parseCoords(raw, min = 2) {
  const pairs = String(raw || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (pairs.length < min || pairs.length > 12) {
    throw new RouteError(`need ${min}-12 coordinates`);
  }
  return pairs.map((p) => {
    const parts = p.split(',');
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(lon) || !Number.isFinite(lat)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new RouteError('invalid coordinate');
    }
    return [lon, lat];
  });
}

/**
 * Fetch route(s) from OSRM.
 * @param {object} opts
 * @param {string} [opts.profile='car']  car | bike | foot
 * @param {number[][]} opts.coords       [[lon, lat], ...]
 * @param {boolean} [opts.alternatives]  request alternative routes (for multi-criteria comparison)
 * @returns {Promise<{profile: string, routes: {distanceM: number, durationS: number, geometry: number[][]}[]}>}
 */
export async function getRoutes({ profile = 'car', coords, alternatives = false }) {
  const p = PROFILE_ALIASES[String(profile).toLowerCase()];
  if (!p) throw new RouteError('invalid profile');

  const coordStr = coords.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const key = `${p}|${alternatives}|${coordStr}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) return hit.payload;

  const url = `${OSRM_BASE}/routed-${p}/route/v1/${OSRM_PROFILE[p]}/${coordStr}`
    + `?overview=full&geometries=geojson&alternatives=${alternatives}&steps=false`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)' },
    });
    if (!res.ok) throw new RouteError('routing service unavailable', 502);
    data = await res.json();
  } catch (e) {
    if (e instanceof RouteError) throw e;
    throw new RouteError(e.name === 'AbortError' ? 'routing timeout' : 'routing service error', 502);
  } finally {
    clearTimeout(timer);
  }

  if (data?.code !== 'Ok' || !data.routes?.length) throw new RouteError('no route found', 404);

  const payload = {
    profile: p,
    routes: data.routes.map((r) => ({
      distanceM: Math.round(r.distance),
      durationS: Math.round(r.duration),
      geometry: r.geometry.coordinates,
    })),
  };

  cache.set(key, { payload, at: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return payload;
}
