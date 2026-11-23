// Hybrid Weather Service: BMKG Public API (primary for Jabodetabek) + Open-Meteo Forecast (automatic fallback).
// BMKG attribution is always returned in payload when source === 'bmkg'.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADM4_PATH = path.resolve(__dirname, '../data/bmkgAdm4Jabodetabek.json');

const BMKG_BASE = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const TIMEZONE = 'Asia/Jakarta';
const BMKG_TTL_MS = 30 * 60 * 1000;       // 30 menit (BMKG update per 3 jam, hemat rate limit 60 req/min)
const OPEN_METEO_TTL_MS = 15 * 60 * 1000; // 15 menit
const CACHE_MAX = 200;
const BMKG_MAX_RADIUS_M = 14_000;         // 14 km radius kecocokan stasiun ADM4 Jabodetabek
const TIMEOUT_MS = 6_500;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class WeatherError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'WeatherError';
    this.status = status;
  }
}

let adm4Stations = null;
function loadAdm4Stations() {
  if (adm4Stations) return adm4Stations;
  try {
    const raw = JSON.parse(fs.readFileSync(ADM4_PATH, 'utf8'));
    adm4Stations = Array.isArray(raw) ? raw : [];
  } catch {
    adm4Stations = [];
  }
  return adm4Stations;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearestAdm4(lat, lon) {
  const list = loadAdm4Stations();
  let best = null;
  let bestDist = Infinity;
  for (const s of list) {
    const d = haversineM(lat, lon, s.lat, s.lon);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (!best || bestDist > BMKG_MAX_RADIUS_M) return null;
  return { station: best, distanceM: Math.round(bestDist) };
}

/** Estimasi Heat Index (Feels Like) sederhana untuk iklim tropis lembap bila tidak tersedia. */
function estimateFeelsLikeC(tempC, humidityPct) {
  if (!Number.isFinite(tempC)) return null;
  if (!Number.isFinite(humidityPct) || tempC < 24) return Math.round(tempC);
  const hi = tempC + 0.33 * ((humidityPct / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC))) - 4.0;
  return Math.round(Math.max(tempC, hi));
}

function classifyBmkgCondition(desc = '', descEn = '') {
  const s = `${desc} ${descEn}`.toLowerCase();
  if (/petir|thunder|badai/.test(s)) return { iconType: 'storm', isRain: true };
  if (/hujan lebat|hujan sedang|heavy rain|moderate rain/.test(s)) return { iconType: 'heavy-rain', isRain: true };
  if (/hujan|rain|gerimis|drizzle|shower/.test(s)) return { iconType: 'rain', isRain: true };
  if (/kabut|asap|udara kabur|fog|mist|haze/.test(s)) return { iconType: 'fog', isRain: false };
  if (/cerah berawan|partly|berawan sebagian/.test(s)) return { iconType: 'partly-cloudy', isRain: false };
  if (/berawan|cloudy|overcast|mendung/.test(s)) return { iconType: 'cloudy', isRain: false };
  return { iconType: 'clear', isRain: false };
}

function describeWmoCode(code) {
  const c = Number(code);
  if (c === 0) return { condition: 'Cerah', conditionEn: 'Clear Sky', iconType: 'clear', isRain: false };
  if (c === 1 || c === 2) return { condition: 'Cerah Berawan', conditionEn: 'Partly Cloudy', iconType: 'partly-cloudy', isRain: false };
  if (c === 3) return { condition: 'Berawan', conditionEn: 'Overcast', iconType: 'cloudy', isRain: false };
  if (c === 45 || c === 48) return { condition: 'Berkabut', conditionEn: 'Foggy', iconType: 'fog', isRain: false };
  if (c >= 51 && c <= 57) return { condition: 'Gerimis', conditionEn: 'Drizzle', iconType: 'rain', isRain: true };
  if (c === 61 || c === 80) return { condition: 'Hujan Ringan', conditionEn: 'Light Rain', iconType: 'rain', isRain: true };
  if (c === 63 || c === 81) return { condition: 'Hujan Sedang', conditionEn: 'Moderate Rain', iconType: 'heavy-rain', isRain: true };
  if (c === 65 || c === 82) return { condition: 'Hujan Lebat', conditionEn: 'Heavy Rain', iconType: 'heavy-rain', isRain: true };
  if (c >= 95) return { condition: 'Hujan Petir', conditionEn: 'Thunderstorm', iconType: 'storm', isRain: true };
  return { condition: 'Berawan', conditionEn: 'Cloudy', iconType: 'cloudy', isRain: false };
}

const cache = new Map();
function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key, payload) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), payload });
}

function pickNearestBmkgSlot(slots, nowMs = Date.now()) {
  if (!Array.isArray(slots) || slots.length === 0) return null;
  let best = slots[0];
  let bestDiff = Infinity;
  for (const slot of slots) {
    const rawTime = slot.utc_datetime || slot.datetime;
    if (!rawTime) continue;
    const iso = String(rawTime).includes('T') ? rawTime : `${String(rawTime).replace(' ', 'T')}Z`;
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) continue;
    const diff = Math.abs(ts - nowMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = slot;
    }
  }
  return best;
}

async function fetchFromBmkg(station, { fetchImpl = fetch } = {}) {
  const key = `bmkg:${station.adm4}`;
  const cached = cacheGet(key, BMKG_TTL_MS);
  if (cached) return { ...cached, cached: true };

  const url = `${BMKG_BASE}?adm4=${encodeURIComponent(station.adm4)}`;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`BMKG HTTP ${res.status}`);
  const data = await res.json();
  const entry = data?.data?.[0];
  const slots = Array.isArray(entry?.cuaca) ? entry.cuaca.flat() : [];
  const slot = pickNearestBmkgSlot(slots);
  if (!slot) throw new Error('BMKG empty forecast slots');

  const lok = entry?.lokasi || data?.lokasi || {};
  const tempC = Number(slot.t);
  const humidityPct = Number(slot.hu);
  const windSpeedKmh = Number(slot.ws);
  const cloudCoverPct = Number(slot.tcc);
  const condition = String(slot.weather_desc || 'Berawan').trim();
  const conditionEn = String(slot.weather_desc_en || condition).trim();
  const cls = classifyBmkgCondition(condition, conditionEn);

  const cityClean = String(lok.kotkab || station.kotkab || 'Jakarta')
    .replace(/^Kota Adm\.\s*/i, '')
    .replace(/^Kota\s+/i, 'Kota ')
    .trim();

  const payload = {
    source: 'bmkg',
    sourceLabel: 'BMKG',
    attribution: 'Source: BMKG (Indonesia Meteorological Agency)',
    temperatureC: Number.isFinite(tempC) ? Math.round(tempC) : null,
    apparentTemperatureC: estimateFeelsLikeC(tempC, humidityPct),
    humidityPct: Number.isFinite(humidityPct) ? Math.round(humidityPct) : null,
    windSpeedKmh: Number.isFinite(windSpeedKmh) ? Math.round(windSpeedKmh * 10) / 10 : null,
    windDirection: slot.wd || null,
    cloudCoverPct: Number.isFinite(cloudCoverPct) ? Math.round(cloudCoverPct) : null,
    visibilityText: slot.vs_text || null,
    precipitationMm: null,
    condition,
    conditionEn,
    iconType: cls.iconType,
    isRain: cls.isRain,
    location: {
      city: cityClean,
      district: String(lok.kecamatan || station.kecamatan || cityClean).trim(),
      subdistrict: String(lok.desa || station.desa || '').trim(),
      adm4: station.adm4,
      lat: station.lat,
      lon: station.lon,
    },
    observedAt: slot.local_datetime || slot.utc_datetime || new Date().toISOString(),
    cached: false,
  };

  cacheSet(key, payload);
  return payload;
}

async function fetchFromOpenMeteo(lat, lon, fallbackStation = null, { fetchImpl = fetch } = {}) {
  // Grid rounding ~4.4 km (0.04 deg) untuk memaksimalkan cache hit
  const rLat = Math.round(lat * 25) / 25;
  const rLon = Math.round(lon * 25) / 25;
  const key = `om:${rLat.toFixed(2)},${rLon.toFixed(2)}`;
  const cached = cacheGet(key, OPEN_METEO_TTL_MS);
  if (cached) return { ...cached, cached: true };

  const currentFields = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'precipitation',
    'weather_code',
    'cloud_cover',
    'wind_speed_10m',
  ].join(',');

  const url = `${OPEN_METEO_BASE}?latitude=${rLat.toFixed(4)}&longitude=${rLon.toFixed(4)}`
    + `&current=${currentFields}&timezone=${encodeURIComponent(TIMEZONE)}`;

  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'jaksafe-backend/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new WeatherError(`Open-Meteo HTTP ${res.status}`, 502);
  const data = await res.json();
  const cur = data?.current;
  if (!cur) throw new WeatherError('Open-Meteo empty current weather', 502);

  const wmo = describeWmoCode(cur.weather_code);
  const precip = Number(cur.precipitation);
  const isRain = wmo.isRain || (Number.isFinite(precip) && precip >= 0.2);

  const payload = {
    source: 'open-meteo',
    sourceLabel: 'Open-Meteo',
    attribution: 'Source: Open-Meteo (Automatic fallback)',
    temperatureC: Number.isFinite(Number(cur.temperature_2m)) ? Math.round(Number(cur.temperature_2m)) : null,
    apparentTemperatureC: Number.isFinite(Number(cur.apparent_temperature)) ? Math.round(Number(cur.apparent_temperature)) : null,
    humidityPct: Number.isFinite(Number(cur.relative_humidity_2m)) ? Math.round(Number(cur.relative_humidity_2m)) : null,
    windSpeedKmh: Number.isFinite(Number(cur.wind_speed_10m)) ? Math.round(Number(cur.wind_speed_10m) * 10) / 10 : null,
    windDirection: null,
    cloudCoverPct: Number.isFinite(Number(cur.cloud_cover)) ? Math.round(Number(cur.cloud_cover)) : null,
    visibilityText: null,
    precipitationMm: Number.isFinite(precip) ? Math.round(precip * 10) / 10 : 0,
    condition: wmo.condition,
    conditionEn: wmo.conditionEn,
    iconType: isRain && !wmo.isRain ? 'rain' : wmo.iconType,
    isRain,
    location: {
      city: fallbackStation?.kotkab || 'Indonesia',
      district: fallbackStation?.kecamatan || fallbackStation?.kotkab || 'Area Peta',
      subdistrict: fallbackStation?.desa || '',
      adm4: fallbackStation?.adm4 || null,
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
    },
    observedAt: cur.time || new Date().toISOString(),
    cached: false,
  };

  cacheSet(key, payload);
  return payload;
}

/**
 * Mengambil cuaca terkini secara hybrid:
 * 1) Jika koordinat berada di cakupan Jabodetabek (<= 14 km dari stasiun ADM4), coba BMKG dulu.
 * 2) Jika di luar Jabodetabek atau BMKG error/timeout, otomatis fallback ke Open-Meteo.
 */
export async function getHybridWeather({ lat, lon, preferFallback = false } = {}, deps = {}) {
  const numLat = Number(lat);
  const numLon = Number(lon);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLon) || Math.abs(numLat) > 90 || Math.abs(numLon) > 180) {
    throw new WeatherError('invalid coordinate', 400);
  }

  const nearest = findNearestAdm4(numLat, numLon);
  if (nearest && !preferFallback) {
    try {
      return await fetchFromBmkg(nearest.station, deps);
    } catch (err) {
      // Fall through cleanly to Open-Meteo
      console.warn(`[weather] BMKG fallback ke Open-Meteo (${nearest.station.adm4}): ${err?.message || err}`);
    }
  }

  return fetchFromOpenMeteo(numLat, numLon, nearest?.station || null, deps);
}

export function clearWeatherCache() {
  cache.clear();
}
