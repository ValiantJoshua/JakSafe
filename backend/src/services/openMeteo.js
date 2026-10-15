// Open-Meteo Air Quality service (free for non-commercial use, no API key).
// Docs: https://open-meteo.com/en/docs/air-quality-api
//
// Metrics are DYNAMIC: the caller (endpoint or AI agent) chooses which variables to
// request. We only validate the *format* of each name and let Open-Meteo reject
// unknown ones, so new variables work without any code change here.

const BASE_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const TIMEZONE = 'Asia/Jakarta';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;
const TIMEOUT_MS = 10_000;
const MAX_METRICS = 20;
const MAX_POINTS = 12;

/** Always requested so scoring has its baseline inputs. */
export const DEFAULT_METRICS = ['pm2_5', 'us_aqi'];

/**
 * Reference catalogue (NOT a whitelist) — used to describe options to the AI agent.
 * Any other valid Open-Meteo variable name can still be requested.
 */
export const METRIC_CATALOGUE = {
  pm2_5: 'Fine particulate matter < 2.5 µm (µg/m³)',
  pm10: 'Coarse particulate matter < 10 µm (µg/m³)',
  us_aqi: 'US Air Quality Index, 0-500',
  european_aqi: 'European Air Quality Index',
  uv_index: 'UV index (with cloud cover)',
  uv_index_clear_sky: 'UV index assuming clear sky',
  carbon_monoxide: 'CO, vehicle exhaust (µg/m³)',
  nitrogen_dioxide: 'NO2, traffic pollution (µg/m³)',
  sulphur_dioxide: 'SO2, industrial (µg/m³)',
  ozone: 'Surface ozone O3 (µg/m³)',
  ammonia: 'NH3 (µg/m³) — may be unavailable outside Europe',
  dust: 'Saharan/mineral dust (µg/m³)',
  aerosol_optical_depth: 'Aerosol optical depth at 550 nm',
  methane: 'CH4 (µg/m³)',
  carbon_dioxide: 'CO2 (ppm)',
};

const cache = new Map();

export class AirQualityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Accept array or comma-separated string; return unique, validated names. */
export function normalizeMetrics(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || '').split(',');
  const cleaned = list.map((m) => String(m).trim().toLowerCase()).filter(Boolean);
  for (const m of cleaned) {
    if (!/^[a-z0-9_]{1,40}$/.test(m)) throw new AirQualityError(`invalid metric name: ${m}`);
  }
  const merged = [...new Set([...DEFAULT_METRICS, ...cleaned])];
  if (merged.length > MAX_METRICS) throw new AirQualityError(`too many metrics (max ${MAX_METRICS})`);
  return merged;
}

/** US EPA AQI category (label + color) for easy display/scoring context. */
export function usAqiCategory(aqi) {
  if (!Number.isFinite(aqi)) return null;
  if (aqi <= 50) return { label: 'Good', color: '#00e400' };
  if (aqi <= 100) return { label: 'Moderate', color: '#ffff00' };
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#ff7e00' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#ff0000' };
  if (aqi <= 300) return { label: 'Very Unhealthy', color: '#8f3f97' };
  return { label: 'Hazardous', color: '#7e0023' };
}

/**
 * Fetch current air-quality values for one or more points.
 * @param {object} opts
 * @param {{lat:number, lon:number}[]} opts.points
 * @param {string[]|string} [opts.metrics]  extra metrics on top of DEFAULT_METRICS
 * @returns {Promise<{metrics: string[], results: object[]}>}
 */
export async function getAirQuality({ points, metrics }) {
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_POINTS) {
    throw new AirQualityError(`need 1-${MAX_POINTS} points`);
  }
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)
      || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) {
      throw new AirQualityError('invalid coordinate');
    }
  }
  const metricList = normalizeMetrics(metrics);

  const lats = points.map((p) => p.lat.toFixed(4)).join(',');
  const lons = points.map((p) => p.lon.toFixed(4)).join(',');
  const key = `${lats}|${lons}|${metricList.join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) return hit.payload;

  const url = `${BASE_URL}?latitude=${lats}&longitude=${lons}`
    + `&current=${metricList.join(',')}&timezone=${encodeURIComponent(TIMEZONE)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)' },
    });
    data = await res.json().catch(() => null);
    if (!res.ok) {
      // Open-Meteo returns { error: true, reason: "..." } e.g. for unknown variables.
      const reason = data?.reason || 'air quality service error';
      throw new AirQualityError(reason, res.status === 400 ? 400 : 502);
    }
  } catch (e) {
    if (e instanceof AirQualityError) throw e;
    throw new AirQualityError(e.name === 'AbortError' ? 'air quality timeout' : 'air quality service error', 502);
  } finally {
    clearTimeout(timer);
  }

  // Single point -> object, multiple points -> array.
  const items = Array.isArray(data) ? data : [data];
  const results = items.map((item, i) => {
    const current = item.current || {};
    const units = item.current_units || {};
    const values = {};
    const outUnits = {};
    const unavailable = [];
    for (const m of metricList) {
      if (current[m] === null || current[m] === undefined) {
        unavailable.push(m);
      } else {
        values[m] = current[m];
        outUnits[m] = units[m];
      }
    }
    return {
      lat: points[i].lat,
      lon: points[i].lon,
      time: current.time,
      values,
      units: outUnits,
      unavailable,
      usAqiCategory: usAqiCategory(values.us_aqi),
    };
  });

  const payload = { metrics: metricList, results };
  cache.set(key, { payload, at: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return payload;
}
