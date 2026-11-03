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
 * Extract a human-readable street corridor summary (e.g. "Jl. KH Mas Mansyur, Jl. Medan Merdeka Selatan")
 * from an OSRM route object using step distances and leg summaries.
 * Avoids repeating identical summaries across alternatives by highlighting unique streets.
 */
function extractRouteSummary(route, index = 0, usedSummaries = new Set()) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const distanceByStreet = new Map();

  for (const leg of legs) {
    const steps = Array.isArray(leg?.steps) ? leg.steps : [];
    for (const step of steps) {
      const rawName = String(step?.name || '').trim();
      if (!rawName || rawName.length < 3) continue;
      const dist = Number(step?.distance) || 0;
      distanceByStreet.set(rawName, (distanceByStreet.get(rawName) || 0) + dist);
    }
  }

  if (distanceByStreet.size > 0) {
    const sortedStreets = [...distanceByStreet.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    let candidate = sortedStreets.slice(0, 2).join(', ');
    if (usedSummaries.has(candidate) && sortedStreets.length > 2) {
      // Pick a distinguishing street from rank 2..N
      for (let i = 2; i < sortedStreets.length; i++) {
        const altCandidate = `${sortedStreets[0]}, ${sortedStreets[i]}`;
        if (!usedSummaries.has(altCandidate)) {
          candidate = altCandidate;
          break;
        }
      }
    }
    usedSummaries.add(candidate);
    return candidate;
  }

  const legSummaries = legs
    .map((l) => String(l?.summary || '').trim())
    .filter(Boolean);
  if (legSummaries.length > 0) {
    const candidate = [...new Set(legSummaries.join(', ').split(',').map((s) => s.trim()).filter(Boolean))]
      .slice(0, 2)
      .join(', ');
    usedSummaries.add(candidate);
    return candidate;
  }

  return index === 0 ? 'Jalur Utama' : `Jalur Alternatif ${index + 1}`;
}

/**
 * Fetch raw OSRM route JSON for a coordinate list.
 */
async function fetchOsrmRaw(p, coordList, { alternatives = false, timeoutMs = TIMEOUT_MS } = {}) {
  const coordStr = coordList.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const altParam = alternatives ? '3' : 'false';
  const url = `${OSRM_BASE}/routed-${p}/route/v1/${OSRM_PROFILE[p]}/${coordStr}`
    + `?overview=full&geometries=geojson&alternatives=${altParam}&steps=true`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)' },
    });
    if (!res.ok) throw new RouteError('routing service unavailable', 502);
    return await res.json();
  } catch (e) {
    if (e instanceof RouteError) throw e;
    throw new RouteError(e.name === 'AbortError' ? 'routing timeout' : 'routing service error', 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch route(s) from OSRM.
 * @param {object} opts
 * @param {string} [opts.profile='car']  car | bike | foot
 * @param {number[][]} opts.coords       [[lon, lat], ...]
 * @param {boolean} [opts.alternatives]  request alternative routes (for multi-criteria comparison)
 * @returns {Promise<{profile: string, routes: {distanceM: number, durationS: number, summary: string, geometry: number[][]}[]}>}
 */
export async function getRoutes({ profile = 'car', coords, alternatives = false }) {
  const p = PROFILE_ALIASES[String(profile).toLowerCase()];
  if (!p) throw new RouteError('invalid profile');

  const coordStr = coords.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const key = `${p}|${alternatives}|${coordStr}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) return hit.payload;

  const data = await fetchOsrmRaw(p, coords, { alternatives });
  if (data?.code !== 'Ok' || !data.routes?.length) throw new RouteError('no route found', 404);

  const rawRoutes = [...data.routes];

  // If alternatives were requested for an A->B pair and OSRM returned fewer than 3 routes,
  // probe perpendicular via-corridors so the user always gets 2-3 realistic street route options.
  if (alternatives && coords.length === 2 && rawRoutes.length < 3) {
    const [lon1, lat1] = coords[0];
    const [lon2, lat2] = coords[1];
    const dLon = lon2 - lon1;
    const dLat = lat2 - lat1;
    const distDeg = Math.hypot(dLon, dLat);

    if (distDeg > 0.002) {
      const midLon = (lon1 + lon2) / 2;
      const midLat = (lat1 + lat2) / 2;
      // Unit perpendicular vector
      const pLon = -dLat / distDeg;
      const pLat = dLon / distDeg;
      const offset = Math.max(0.0045, Math.min(0.025, distDeg * 0.24));

      const viaCandidates = [
        [Number((midLon + pLon * offset).toFixed(5)), Number((midLat + pLat * offset).toFixed(5))],
        [Number((midLon - pLon * offset).toFixed(5)), Number((midLat - pLat * offset).toFixed(5))],
      ];

      const viaResults = await Promise.allSettled(
        viaCandidates.map((via) =>
          fetchOsrmRaw(p, [coords[0], via, coords[1]], { alternatives: false, timeoutMs: 4500 })
        )
      );

      for (const res of viaResults) {
        if (rawRoutes.length >= 3) break;
        if (res.status === 'fulfilled' && res.value?.code === 'Ok' && res.value.routes?.length) {
          const candidate = res.value.routes[0];
          const candSummary = extractRouteSummary(candidate, rawRoutes.length);
          const isDuplicate = rawRoutes.some((existing, idx) => {
            const exSummary = extractRouteSummary(existing, idx);
            const distDiffRatio = Math.abs(existing.distance - candidate.distance) / Math.max(existing.distance, 1);
            return distDiffRatio < 0.025 && exSummary === candSummary;
          });
          // Also avoid absurdly long detours (> 1.85x primary route distance)
          const maxAllowedDist = rawRoutes[0].distance * 1.85;
          if (!isDuplicate && candidate.distance <= maxAllowedDist) {
            rawRoutes.push(candidate);
          }
        }
      }
    }
  }

  const usedSummaries = new Set();
  const payload = {
    profile: p,
    routes: rawRoutes.slice(0, 3).map((r, idx) => ({
      distanceM: Math.round(r.distance),
      durationS: Math.round(r.duration),
      summary: extractRouteSummary(r, idx, usedSummaries),
      geometry: r.geometry.coordinates,
    })),
  };

  cache.set(key, { payload, at: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return payload;
}
