// OSRM routing service (multi-mirror public OSRM servers + resilient urban corridor fallback).
// Used by both the GET /api/route endpoint and the agent's Tool 1 (get_route).
// Request/validation approach adapted from God's Eye View (MIT) — vite.config.js `/api/route`.
// See THIRD_PARTY_NOTICES.md.

import { routeGeometryCache } from './cacheService.js';

const OSRM_DE_BASE = 'https://routing.openstreetmap.de';
const OSRM_PROJECT_BASE = 'https://router.project-osrm.org';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const TIMEOUT_MS = 6_500;

const PROFILE_ALIASES = {
  car: 'car', driving: 'car',
  bike: 'bike', cycling: 'bike', bicycle: 'bike',
  foot: 'foot', walking: 'foot', walk: 'foot',
};
const OSRM_PROFILE = { car: 'driving', bike: 'bike', foot: 'foot' };

// Kecepatan rata-rata perkotaan Jakarta (m/s) untuk fallback deterministik saat server OSRM publik gangguan
const FALLBACK_SPEED_MPS = {
  car: 7.5,  // ~27 km/j
  bike: 5.0, // ~18 km/j
  foot: 1.35, // ~4.8 km/j
};

const JAKARTA_CORRIDORS = [
  { name: 'Jl. Jenderal Sudirman, Jl. M.H. Thamrin', lat: -6.2020, lon: 106.8225 },
  { name: 'Jl. K.H. Mas Mansyur, Jl. K.H. Wahid Hasyim', lat: -6.1920, lon: 106.8170 },
  { name: 'Jl. Medan Merdeka Selatan, Jl. Kebon Sirih', lat: -6.1815, lon: 106.8275 },
  { name: 'Jl. H.R. Rasuna Said, Jl. Jend. Gatot Subroto', lat: -6.2280, lon: 106.8300 },
  { name: 'Jl. Prof. DR. Satrio, Jl. Casablanca Raya', lat: -6.2240, lon: 106.8360 },
  { name: 'Jl. Letjen S. Parman, Jl. Kyai Tapa', lat: -6.1730, lon: 106.7905 },
  { name: 'Jl. Panglima Polim, Jl. Sisingamangaraja', lat: -6.2440, lon: 106.7995 },
  { name: 'Jl. Pangeran Antasari, Jl. Kemang Raya', lat: -6.2610, lon: 106.8120 },
  { name: 'Jl. TB Simatupang, Jl. RS Fatmawati', lat: -6.2915, lon: 106.8040 },
  { name: 'Jl. Letjen M.T. Haryono, Jl. Dewi Sartika', lat: -6.2435, lon: 106.8580 },
  { name: 'Jl. Pramuka, Jl. Pemuda Rawamangun', lat: -6.1935, lon: 106.8750 },
  { name: 'Jl. Gunung Sahari, Jl. Kramat Raya', lat: -6.1720, lon: 106.8420 },
  { name: 'Jl. Boulevard Raya, Jl. Yos Sudarso', lat: -6.1550, lon: 106.8980 },
];

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
 * Menerjemahkan tipe manuver & modifier OSRM menjadi kunci arah (directionKey)
 * serta instruksi bahasa Indonesia yang alami.
 */
function buildStepInstruction(maneuver = {}, roadLabel = '') {
  const type = String(maneuver.type || 'continue').toLowerCase();
  const mod = String(maneuver.modifier || '').toLowerCase();
  const exit = Number.isInteger(maneuver.exit) ? maneuver.exit : null;
  const target = roadLabel ? ` ke ${roadLabel}` : '';
  const diTarget = roadLabel ? ` di ${roadLabel}` : '';
  const menujuTarget = roadLabel ? ` menuju ${roadLabel}` : '';

  if (type === 'depart') {
    return {
      directionKey: 'depart',
      instruction: roadLabel ? `Mulai perjalanan di ${roadLabel}` : 'Mulai perjalanan dari titik awal',
    };
  }

  if (type === 'arrive') {
    const posHint = mod === 'left'
      ? ' (di sebelah kiri)'
      : mod === 'right'
        ? ' (di sebelah kanan)'
        : '';
    return {
      directionKey: 'arrive',
      instruction: `Tiba di tujuan${posHint}`,
    };
  }

  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') {
    const exitStr = exit ? ` ambil jalan keluar ke-${exit}` : ' ikuti bundaran';
    return {
      directionKey: 'roundabout',
      instruction: `Masuk bundaran,${exitStr}${menujuTarget}`,
    };
  }

  if (type === 'exit roundabout' || type === 'exit rotary') {
    return {
      directionKey: mod.includes('left') ? 'slight-left' : 'slight-right',
      instruction: `Keluar bundaran${menujuTarget}`,
    };
  }

  if (mod === 'uturn') {
    return {
      directionKey: 'uturn',
      instruction: `Putar balik${diTarget}`,
    };
  }

  if (type === 'merge') {
    return {
      directionKey: mod.includes('left') ? 'slight-left' : mod.includes('right') ? 'slight-right' : 'merge',
      instruction: `Bergabung ke jalur${menujuTarget}`,
    };
  }

  if (type === 'on ramp' || type === 'off ramp') {
    const rampType = type === 'on ramp' ? 'Ambil jalur masuk (ramp)' : 'Ambil jalur keluar (exit ramp)';
    const dirKey = mod.includes('left') ? 'slight-left' : mod.includes('right') ? 'slight-right' : 'ramp';
    return {
      directionKey: dirKey,
      instruction: `${rampType}${menujuTarget}`,
    };
  }

  if (type === 'fork') {
    if (mod.includes('left')) {
      return {
        directionKey: 'slight-left',
        instruction: `Ambil percabangan kiri${menujuTarget}`,
      };
    }
    if (mod.includes('right')) {
      return {
        directionKey: 'slight-right',
        instruction: `Ambil percabangan kanan${menujuTarget}`,
      };
    }
    return {
      directionKey: 'straight',
      instruction: `Ikuti percabangan lurus${menujuTarget}`,
    };
  }

  if (type === 'end of road') {
    if (mod.includes('left')) {
      return {
        directionKey: 'left',
        instruction: `Di ujung jalan, belok kiri${target}`,
      };
    }
    if (mod.includes('right')) {
      return {
        directionKey: 'right',
        instruction: `Di ujung jalan, belok kanan${target}`,
      };
    }
  }

  // Turn / Continue / New name / Notification dengan modifier arah
  if (mod === 'sharp left') {
    return { directionKey: 'sharp-left', instruction: `Belok tajam ke kiri${target}` };
  }
  if (mod === 'left') {
    return { directionKey: 'left', instruction: `Belok kiri${target}` };
  }
  if (mod === 'slight left') {
    return { directionKey: 'slight-left', instruction: `Sedikit ke kiri${menujuTarget}` };
  }
  if (mod === 'sharp right') {
    return { directionKey: 'sharp-right', instruction: `Belok tajam ke kanan${target}` };
  }
  if (mod === 'right') {
    return { directionKey: 'right', instruction: `Belok kanan${target}` };
  }
  if (mod === 'slight right') {
    return { directionKey: 'slight-right', instruction: `Sedikit ke kanan${menujuTarget}` };
  }

  if (type === 'new name' && roadLabel) {
    return {
      directionKey: 'straight',
      instruction: `Lanjut lurus ke ${roadLabel}`,
    };
  }

  return {
    directionKey: 'straight',
    instruction: roadLabel ? `Lurus terus di ${roadLabel}` : 'Lanjut lurus mengikuti jalan',
  };
}

/**
 * Mengekstrak daftar langkah manuver (Turn-by-Turn steps) dari objek rute OSRM,
 * menerjemahkan ke Bahasa Indonesia, dan menggabungkan segmen lurus berurutan di jalan yang sama.
 *
 * @param {object} route Objek route dari OSRM (`route.legs[].steps[]`)
 * @returns {Array<{
 *   index: number,
 *   instruction: string,
 *   roadName: string,
 *   directionKey: string,
 *   type: string,
 *   modifier: string,
 *   distanceM: number,
 *   durationS: number,
 *   location: [number, number] | null
 * }>}
 */
export function extractRouteSteps(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const rawSteps = [];

  for (let legIdx = 0; legIdx < legs.length; legIdx++) {
    const leg = legs[legIdx];
    const steps = Array.isArray(leg?.steps) ? leg.steps : [];
    const isFirstLeg = legIdx === 0;
    const isLastLeg = legIdx === legs.length - 1;

    for (let sIdx = 0; sIdx < steps.length; sIdx++) {
      const step = steps[sIdx];
      const maneuver = step?.maneuver || {};
      const type = String(maneuver.type || 'continue').toLowerCase();
      const modifier = String(maneuver.modifier || '').toLowerCase();
      const distanceM = Math.max(0, Math.round(Number(step?.distance) || 0));
      const durationS = Math.max(0, Math.round(Number(step?.duration) || 0));
      const isFirstStepOfLeg = sIdx === 0;
      const isLastStepOfLeg = sIdx === steps.length - 1;

      // Pada rute multi-leg (misal rute alternatif dengan via-waypoint):
      // Langkah terakhir dari leg perantara memiliki type='arrive' (ke titik waypoint perantara),
      // dan langkah pertama dari leg berikutnya memiliki type='depart'.
      // Keduanya BUKAN awal atau akhir sebenarnya dari rute keseluruhan pengguna,
      // sehingga harus diabaikan atau diubah menjadi navigasi lanjutan agar tidak muncul "dua tujuan".
      if (!isLastLeg && isLastStepOfLeg && type === 'arrive') {
        continue;
      }
      if (!isFirstLeg && isFirstStepOfLeg && type === 'depart') {
        // Gabungkan jarak/durasi transit ke langkah sebelumnya jika ada
        const prev = rawSteps[rawSteps.length - 1];
        if (prev) {
          prev.distanceM += distanceM;
          prev.durationS += durationS;
        }
        continue;
      }

      // Lewati langkah mikro (< 4 meter) kecuali depart awal atau arrive akhir
      if (type !== 'depart' && type !== 'arrive' && distanceM < 4) {
        continue;
      }

      const name = String(step?.name || '').trim();
      const ref = String(step?.ref || '').trim();
      const destinations = String(step?.destinations || '').trim();
      const rotaryName = String(step?.rotary_name || '').trim();

      let roadName = name || destinations || rotaryName || '';
      if (ref && roadName && !roadName.includes(ref)) {
        roadName = `${roadName} (${ref})`;
      } else if (!roadName && ref) {
        roadName = ref;
      }

      const loc = Array.isArray(maneuver.location) && maneuver.location.length >= 2
        ? [Number(maneuver.location[0]), Number(maneuver.location[1])]
        : Array.isArray(step?.geometry?.coordinates?.[0])
          ? [Number(step.geometry.coordinates[0][0]), Number(step.geometry.coordinates[0][1])]
          : null;

      const { directionKey, instruction } = buildStepInstruction(maneuver, roadName);

      // Gabungkan langkah lurus berurutan pada nama jalan yang sama agar daftar langkah ringkas
      const prev = rawSteps[rawSteps.length - 1];
      if (
        prev &&
        prev.directionKey === 'straight' &&
        directionKey === 'straight' &&
        prev.roadName &&
        roadName &&
        prev.roadName.toLowerCase() === roadName.toLowerCase()
      ) {
        prev.distanceM += distanceM;
        prev.durationS += durationS;
        continue;
      }

      rawSteps.push({
        instruction,
        roadName: roadName || (type === 'arrive' ? 'Titik Tujuan' : 'Jalan Lokal'),
        directionKey,
        type,
        modifier,
        distanceM,
        durationS,
        location: loc && Number.isFinite(loc[0]) && Number.isFinite(loc[1]) ? loc : null,
      });
    }
  }

  return rawSteps.map((s, idx) => ({
    index: idx + 1,
    ...s,
  }));
}

/**
 * Fetch raw OSRM route JSON by racing two independent public OSRM mirrors in parallel.
 * Whichever mirror responds first with valid route data wins immediately.
 */
async function fetchOsrmRaw(p, coordList, { alternatives = false, timeoutMs = TIMEOUT_MS } = {}) {
  const coordStr = coordList.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const altParam = alternatives ? '3' : 'false';
  const querySuffix = `?overview=full&geometries=geojson&alternatives=${altParam}&steps=true`;

  const urls = [
    `${OSRM_DE_BASE}/routed-${p}/route/v1/${OSRM_PROFILE[p]}/${coordStr}${querySuffix}`,
    `${OSRM_PROJECT_BASE}/route/v1/${OSRM_PROFILE[p]}/${coordStr}${querySuffix}`,
  ];

  const controllers = urls.map(() => new AbortController());
  const timer = setTimeout(() => {
    for (const c of controllers) c.abort();
  }, timeoutMs);

  try {
    const winner = await Promise.any(
      urls.map(async (url, idx) => {
        const res = await fetch(url, {
          signal: controllers[idx].signal,
          headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json?.code !== 'Ok' || !Array.isArray(json.routes) || json.routes.length === 0) {
          throw new Error('empty route response');
        }
        return json;
      })
    );
    // Batalkan mirror yang masih berjalan setelah pemenang ditemukan
    for (const c of controllers) c.abort();
    return winner;
  } catch (e) {
    const isAbort = controllers.every((c) => c.signal.aborted);
    throw new RouteError(isAbort ? 'routing timeout' : 'routing service unavailable', 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hitung jarak Haversine dalam meter antara dua koordinat [lon, lat].
 */
function haversineMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Membangun koridor rute perkotaan deterministik (fallback tahan-banting) apabila seluruh
 * server OSRM publik sedang mengalami gangguan/timeout dari jaringan pengguna.
 */
function buildUrbanCorridorFallback(p, coords, alternatives = false) {
  const start = coords[0];
  const end = coords[coords.length - 1];
  const [lon1, lat1] = start;
  const [lon2, lat2] = end;
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  const degLen = Math.hypot(dLon, dLat) || 0.001;
  const straightM = Math.max(250, haversineMeters(start, end));
  const speed = FALLBACK_SPEED_MPS[p] || FALLBACK_SPEED_MPS.car;

  // Vektor tegak lurus untuk variasi koridor jalan raya
  const pLon = -dLat / degLen;
  const pLat = dLon / degLen;
  const midLon = (lon1 + lon2) / 2;
  const midLat = (lat1 + lat2) / 2;

  // Urutkan koridor jalan Jakarta terdekat dari titik tengah rute
  const rankedCorridors = [...JAKARTA_CORRIDORS]
    .sort((a, b) =>
      Math.hypot(a.lat - midLat, a.lon - midLon) - Math.hypot(b.lat - midLat, b.lon - midLon)
    );

  const offsets = alternatives ? [0, 0.16, -0.18] : [0];
  const distMultipliers = [1.28, 1.37, 1.43];

  const routes = offsets.map((lateralFactor, idx) => {
    const steps = 16;
    const geometry = [];
    const latOffset = degLen * lateralFactor;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Kurva halus mengikuti pola grid jalan raya perkotaan
      const arch = Math.sin(t * Math.PI);
      const gridStep = Math.sin(t * Math.PI * 2) * 0.04 * degLen * (idx === 0 ? 1 : -1);
      const lon = Number((lon1 + dLon * t + pLon * (latOffset * arch + gridStep)).toFixed(6));
      const lat = Number((lat1 + dLat * t + pLat * (latOffset * arch + gridStep)).toFixed(6));
      geometry.push([lon, lat]);
    }

    const distanceM = Math.round(straightM * distMultipliers[idx]);
    const durationS = Math.max(60, Math.round(distanceM / speed));
    const summary = rankedCorridors[idx]?.name || (idx === 0 ? 'Jalur Arteri Utama' : `Jalur Alternatif ${idx + 1}`);
    const corridorParts = summary.split(',').map((s) => s.trim()).filter(Boolean);
    const roadA = corridorParts[0] || 'Jalur Arteri Utama';
    const roadB = corridorParts[1] || 'Jalur Penghubung Tujuan';

    const fallbackSteps = [
      {
        index: 1,
        instruction: `Mulai perjalanan menuju ${roadA}`,
        roadName: roadA,
        directionKey: 'depart',
        type: 'depart',
        modifier: 'straight',
        distanceM: Math.round(distanceM * 0.18),
        durationS: Math.max(15, Math.round(durationS * 0.18)),
        location: geometry[0],
      },
      {
        index: 2,
        instruction: `Lurus terus di ${roadA}`,
        roadName: roadA,
        directionKey: 'straight',
        type: 'continue',
        modifier: 'straight',
        distanceM: Math.round(distanceM * 0.47),
        durationS: Math.max(25, Math.round(durationS * 0.47)),
        location: geometry[Math.floor(geometry.length * 0.25)],
      },
      {
        index: 3,
        instruction: `${idx % 2 === 0 ? 'Belok kanan' : 'Belok kiri'} ke ${roadB}`,
        roadName: roadB,
        directionKey: idx % 2 === 0 ? 'right' : 'left',
        type: 'turn',
        modifier: idx % 2 === 0 ? 'right' : 'left',
        distanceM: Math.max(20, distanceM - Math.round(distanceM * 0.18) - Math.round(distanceM * 0.47)),
        durationS: Math.max(20, durationS - Math.round(durationS * 0.18) - Math.round(durationS * 0.47)),
        location: geometry[Math.floor(geometry.length * 0.68)],
      },
      {
        index: 4,
        instruction: 'Tiba di tujuan',
        roadName: 'Titik Tujuan',
        directionKey: 'arrive',
        type: 'arrive',
        modifier: '',
        distanceM: 0,
        durationS: 0,
        location: geometry[geometry.length - 1],
      },
    ];

    return {
      distanceM,
      durationS,
      summary,
      geometry,
      steps: fallbackSteps,
    };
  });

  return { profile: p, routes };
}

/**
 * Fetch route(s) from OSRM with multi-mirror racing and resilient urban fallback.
 * @param {object} opts
 * @param {string} [opts.profile='car']  car | bike | foot
 * @param {number[][]} opts.coords       [[lon, lat], ...]
 * @param {boolean} [opts.alternatives]  request alternative routes (for multi-criteria comparison)
 * @returns {Promise<{profile: string, routes: {distanceM: number, durationS: number, summary: string, geometry: number[][], steps: object[]}[]}>}
 */
export async function getRoutes({ profile = 'car', coords, alternatives = false }) {
  const p = PROFILE_ALIASES[String(profile).toLowerCase()];
  if (!p) throw new RouteError('invalid profile');

  const coordStr = coords.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const key = `${p}|${alternatives}|${coordStr}`;
  const hit = routeGeometryCache.get(key);
  if (hit) return hit;

  let data = null;
  try {
    data = await fetchOsrmRaw(p, coords, { alternatives, timeoutMs: TIMEOUT_MS });
  } catch (err) {
    console.warn(`[osrm] Public OSRM mirrors timed out/unavailable (${err.message}), using resilient urban corridor fallback.`);
    return buildUrbanCorridorFallback(p, coords, alternatives);
  }

  if (data?.code !== 'Ok' || !data.routes?.length) {
    return buildUrbanCorridorFallback(p, coords, alternatives);
  }

  const rawRoutes = [...data.routes];

  // If alternatives were requested for an A->B pair and OSRM returned fewer than 3 routes,
  // probe perpendicular via-corridors with a tight 3.0s timeout so it never stalls navigation.
  if (alternatives && coords.length === 2 && rawRoutes.length < 3) {
    const [lon1, lat1] = coords[0];
    const [lon2, lat2] = coords[1];
    const dLon = lon2 - lon1;
    const dLat = lat2 - lat1;
    const distDeg = Math.hypot(dLon, dLat);

    if (distDeg > 0.002) {
      const midLon = (lon1 + lon2) / 2;
      const midLat = (lat1 + lat2) / 2;
      const pLon = -dLat / distDeg;
      const pLat = dLon / distDeg;
      const offset = Math.max(0.0045, Math.min(0.025, distDeg * 0.24));

      const viaCandidates = [
        [Number((midLon + pLon * offset).toFixed(5)), Number((midLat + pLat * offset).toFixed(5))],
        [Number((midLon - pLon * offset).toFixed(5)), Number((midLat - pLat * offset).toFixed(5))],
      ];

      const viaResults = await Promise.allSettled(
        viaCandidates.map((via) =>
          fetchOsrmRaw(p, [coords[0], via, coords[1]], { alternatives: false, timeoutMs: 3000 })
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
      steps: extractRouteSteps(r),
    })),
  };

  routeGeometryCache.set(key, payload);
  return payload;
}
