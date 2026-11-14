// Layanan Peringatan Area Rawan Banjir, Genangan, & Hambatan Lalu Lintas Jakarta.
// Menggabungkan:
// 1. Koridor rawan historis DKI Jakarta yang tertambat pada kamera CCTV terverifikasi (cctvCatalog.json)
// 2. Cuaca curah hujan real-time dari Open-Meteo (di-cache 10 menit per sektor wilayah Jakarta)
// 3. Pengamatan langsung AI Vision (Gemini Vision) dari endpoint /api/cctv/analyze/:id dan agent analyze_image

import { getCameraById } from './cctvCatalog.js';
import { getCameraHealth } from './cctvHealthService.js';
import { InMemoryLRUCache } from './cacheService.js';

const OPEN_METEO_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const WEATHER_TIMEOUT_MS = 6000;
const VISION_OBSERVATION_TTL_MS = 30 * 60 * 1000;

export const SEVERITY_ORDER = { siaga: 3, waspada: 2, pantau: 1 };

const REGIONAL_WEATHER_SECTORS = [
  { region: 'Jakarta Pusat', lat: -6.1865, lon: 106.8235 },
  { region: 'Jakarta Selatan', lat: -6.2383, lon: 106.8272 },
  { region: 'Jakarta Barat', lat: -6.1674, lon: 106.7945 },
  { region: 'Jakarta Timur', lat: -6.2450, lon: 106.8830 },
  { region: 'Jakarta Utara', lat: -6.1214, lon: 106.8910 },
];

/**
 * Daftar koridor arteri rawan genangan & bottleneck di DKI Jakarta
 * dengan ID kamera & koordinat terverifikasi dari cctvCatalog.json.
 */
export const MONITORED_CORRIDORS = [
  {
    id: 'grogol-nurdin',
    corridor: 'Simpang Grogol — Jl. Nurdin Raya',
    region: 'Jakarta Barat',
    cameraId: 'jakcctv-501968-simpang-jl-nurdin-raya-c01-cctv-01',
    lat: -6.1604,
    lon: 106.7937,
    highFloodRisk: true,
    baselineSeverity: 'waspada',
    riskNote: 'Titik cekungan drainase kawasan Grogol–Latumeten, rentan genangan saat hujan deras.',
    mitigation: 'Gunakan lajur tengah/kanan atau pertimbangkan putar balik melalui Jl. S. Parman sisi elevated.',
  },
  {
    id: 'kampung-melayu-panjaitan',
    corridor: 'Koridor Cawang — Kampung Melayu',
    region: 'Jakarta Timur',
    cameraId: 'nusantara-binamarga-tol-bekasi-cawang-kampung-melayu-1',
    lat: -6.2473,
    lon: 106.8795,
    highFloodRisk: true,
    baselineSeverity: 'waspada',
    riskNote: 'Koridor DAS Ciliwung dan simpang DI Panjaitan, rawan luapan kiriman air serta penyempitan lajur.',
    mitigation: 'Pantau CCTV koridor terlebih dahulu dan siapkan rute alternatif via Jl. MT Haryono sisi utara.',
  },
  {
    id: 'mampang-kuningan',
    corridor: 'Simpang Kuningan — Mampang Prapatan',
    region: 'Jakarta Selatan',
    cameraId: 'jakcctv-502507-jkp-satpol-pp-jl-jend-gatot-subroto-c11-cctv-01',
    lat: -6.2365,
    lon: 106.832,
    highFloodRisk: true,
    baselineSeverity: 'waspada',
    riskNote: 'Pertemuan saluran Kali Mampang dengan underpass Kuningan, rawan genangan & antrean panjang.',
    mitigation: 'Motor disarankan tetap di jalur atas dan waspada genangan di bibir saluran kiri.',
  },
  {
    id: 'semanggi-gatot-subroto',
    corridor: 'Simpang Semanggi — Jl. Gatot Subroto',
    region: 'Jakarta Selatan',
    cameraId: 'jakcctv-502045-jkp-polda-jpo-jl-gatot-subroto-7-cctv-01',
    lat: -6.2238,
    lon: 106.8142,
    highFloodRisk: false,
    baselineSeverity: 'pantau',
    riskNote: 'Simpang susun padat dengan pertemuan arus Sudirman dan Gatot Subroto saat jam sibuk/hujan.',
    mitigation: 'Jaga jarak aman dan perhatikan perlambatan di akses naik lingkar Semanggi.',
  },
  {
    id: 'pancoran-gatot',
    corridor: 'Bundaran Pancoran — Gatot Subroto Timur',
    region: 'Jakarta Selatan',
    cameraId: 'jakcctv-503300-jkp-polda-jl-jend-gatot-subroto-c13-cctv-01',
    lat: -6.2415,
    lon: 106.8395,
    highFloodRisk: false,
    baselineSeverity: 'waspada',
    riskNote: 'Titik pertemuan arus Pasar Minggu dan Cawang, rentan hambatan kecepatan & percikan genangan.',
    mitigation: 'Pertimbangkan keberangkatan lebih awal di luar puncak komuter sore.',
  },
  {
    id: 'tanah-abang-parman',
    corridor: 'Slipi — Jl. Letjen S. Parman',
    region: 'Jakarta Barat',
    cameraId: 'jakcctv-502540-jkb-satpol-pp-simpang-jl-letjen-s-parman-c02-cctv-01',
    lat: -6.1848,
    lon: 106.8139,
    highFloodRisk: false,
    baselineSeverity: 'waspada',
    riskNote: 'Koridor akses Tanah Abang & Slipi dengan intensitas kendaraan tinggi serta bahu jalan sempit.',
    mitigation: 'Hindari lajur paling kiri dekat persimpangan saat turun hujan.',
  },
  {
    id: 'thamrin-bundaran',
    corridor: 'Simpang Jl. M.H. Thamrin',
    region: 'Jakarta Pusat',
    cameraId: 'jakcctv-502491-jkp-satpol-pp-simpang-jl-mh-thamrin-c07-cctv-01',
    lat: -6.1885,
    lon: 106.8235,
    highFloodRisk: false,
    baselineSeverity: 'pantau',
    riskNote: 'Koridor pusat bisnis Thamrin–Bundaran HI; drainase relatif baik namun rentan genangan permukaan singkat saat hujan lebat.',
    mitigation: 'Pantau kualitas udara dan kepadatan lampu lalu lintas sepanjang Jl. M.H. Thamrin.',
  },
  {
    id: 'tanjung-priok-atp',
    corridor: 'Koridor Akses Tanjung Priok — Yos Sudarso',
    region: 'Jakarta Utara',
    cameraId: 'nusantara-binamarga-tol-akses-tanjung-priok-2',
    lat: -6.1195,
    lon: 106.8941,
    highFloodRisk: true,
    baselineSeverity: 'waspada',
    riskNote: 'Kawasan pesisir utara rawan kombinasi rob pasang dan genangan air hujan di lajur arteri kendaraan berat.',
    mitigation: 'Waspadai air payau/genangan untuk pengendara motor dan jaga jarak dari truk logistik.',
  },
];

const weatherCache = new InMemoryLRUCache({
  name: 'hazardWeather',
  ttlMs: 10 * 60 * 1000,
  maxEntries: 8,
});

// Pengamatan visual terbaru dari AI Vision per cameraId (TTL 30 menit)
const visionObservations = new Map();

function pruneExpiredVisionObservations(now = Date.now()) {
  for (const [camId, obs] of visionObservations.entries()) {
    if (!obs || now - obs.observedAtMs > VISION_OBSERVATION_TTL_MS) {
      visionObservations.delete(camId);
    }
  }
}

/**
 * Catat hasil analisis Gemini Vision agar peringatan area rawan langsung
 * mencerminkan genangan banjir atau kemacetan yang teramati di kamera CCTV.
 */
export function recordVisionHazardObservation({
  cameraId,
  cameraName = '',
  lat = null,
  lon = null,
  analysis = null,
  observedAt = new Date().toISOString(),
} = {}) {
  if (!analysis || typeof analysis !== 'object') return null;

  pruneExpiredVisionObservations();
  const observedAtMs = Date.now();
  const payload = {
    cameraId: cameraId || null,
    cameraName: String(cameraName || '').trim(),
    lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
    lon: Number.isFinite(Number(lon)) ? Number(lon) : null,
    genanganAir: Boolean(analysis.genangan_air),
    tingkatGenangan: String(analysis.tingkat_genangan || 'tidak_ada').toLowerCase(),
    kondisiJalan: String(analysis.kondisi_jalan || 'lancar').toLowerCase(),
    catatan: String(analysis.catatan_singkat || analysis.reason || '').trim(),
    confidence: Number.isFinite(Number(analysis.confidence)) ? Number(analysis.confidence) : null,
    observedAt,
    observedAtMs,
  };

  if (!payload.genanganAir && payload.kondisiJalan !== 'macet') {
    if (cameraId) visionObservations.delete(cameraId);
    return null;
  }

  const key = cameraId || `coord:${payload.lat?.toFixed(4)},${payload.lon?.toFixed(4)}`;
  visionObservations.set(key, payload);
  return payload;
}

/** Reset pengamatan visual (untuk pengujian unit terisolasi). */
export function clearVisionHazardObservations() {
  visionObservations.clear();
  weatherCache.clear();
}

/** Hitung jarak Haversine dalam meter antara dua titik (lat, lon). */
export function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegmentDistanceM(latP, lonP, [lonA, latA], [lonB, latB]) {
  const cosLat = Math.cos(((latA + latB) / 2) * (Math.PI / 180));
  const kx = 111320 * Math.max(0.2, cosLat);
  const ky = 110540;
  const px = (lonP - lonA) * kx;
  const py = (latP - latA) * ky;
  const bx = (lonB - lonA) * kx;
  const by = (latB - latA) * ky;
  const lenSq = bx * bx + by * by;
  if (lenSq <= 0.001) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Jarak minimum (meter) antara sebuah titik koridor dengan polyline rute [[lon, lat], ...]. */
export function minDistanceToPolylineM(lat, lon, geometry = []) {
  if (!Array.isArray(geometry) || geometry.length === 0) return Infinity;
  if (geometry.length === 1) {
    const [gLon, gLat] = geometry[0];
    return haversineDistanceM(lat, lon, gLat, gLon);
  }
  let best = Infinity;
  for (let i = 0; i < geometry.length - 1; i++) {
    const d = pointToSegmentDistanceM(lat, lon, geometry[i], geometry[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Terjemahkan kode cuaca WMO & curah hujan aktual ke deskripsi ringkas Bahasa Indonesia. */
function weatherCodeToLabel(code, precipitationMm = 0) {
  const c = Number(code);
  const p = Number(precipitationMm) || 0;
  if (c >= 95) return 'Hujan petir';
  if ([65, 67, 82].includes(c) || p >= 7.5) return 'Hujan lebat';
  if (p >= 1.0 || [63, 81].includes(c)) return 'Hujan ringan–sedang';
  if ([51, 53, 55, 61, 80].includes(c) || p >= 0.2) return 'Gerimis / hujan tipis';
  if ([45, 48].includes(c)) return 'Berkabut';
  if ([1, 2, 3].includes(c)) return 'Berawan';
  return 'Cerah / kondusif';
}

/** Ambil ringkasan curah hujan terkini untuk 5 sektor DKI Jakarta via Open-Meteo (cache 10 menit). */
export async function fetchJakartaSectorWeather({ fetchFn = fetch } = {}) {
  const cached = weatherCache.get('jakarta-sectors');
  if (cached) return cached;

  const lats = REGIONAL_WEATHER_SECTORS.map((s) => s.lat).join(',');
  const lons = REGIONAL_WEATHER_SECTORS.map((s) => s.lon).join(',');
  const url = `${OPEN_METEO_WEATHER_URL}?latitude=${lats}&longitude=${lons}&current=precipitation,rain,weather_code&timezone=Asia%2FBangkok`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);

  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : [raw];
    const byRegion = {};

    REGIONAL_WEATHER_SECTORS.forEach((sec, idx) => {
      const cur = list[idx]?.current || {};
      const precipitationMm = Number(cur.precipitation ?? cur.rain ?? 0) || 0;
      const weatherCode = Number(cur.weather_code ?? 0) || 0;
      byRegion[sec.region] = {
        region: sec.region,
        precipitationMm: Number(precipitationMm.toFixed(1)),
        weatherCode,
        weatherLabel: weatherCodeToLabel(weatherCode, precipitationMm),
        fetchedAt: cur.time || new Date().toISOString(),
      };
    });

    weatherCache.set('jakarta-sectors', byRegion);
    return byRegion;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function findMatchingVisionObservation(corridor) {
  pruneExpiredVisionObservations();
  if (corridor.cameraId && visionObservations.has(corridor.cameraId)) {
    return visionObservations.get(corridor.cameraId);
  }
  for (const obs of visionObservations.values()) {
    if (obs.lat !== null && obs.lon !== null) {
      if (haversineDistanceM(corridor.lat, corridor.lon, obs.lat, obs.lon) <= 1200) {
        return obs;
      }
    }
  }
  return null;
}

/**
 * Klasifikasikan tingkat peringatan dan sumber sinyal untuk satu koridor rawan.
 */
export function classifyCorridorAlert(corridor, { weather = null, visionObs = null } = {}) {
  let severity = corridor.baselineSeverity || 'pantau';
  const signals = ['Riwayat Koridor Rawan'];
  const reasons = [corridor.riskNote];

  const precip = Number(weather?.precipitationMm || 0);
  const wCode = Number(weather?.weatherCode || 0);
  const isStorm = wCode >= 95 || precip >= 7.5;
  const isModerateRain = [63, 65, 81, 82].includes(wCode) || precip >= 1.0;

  if (isStorm) {
    severity = 'siaga';
    signals.push('Hujan Lebat Real-Time');
    reasons.unshift(`Cuaca terpantau ${weather.weatherLabel.toLowerCase()} (${precip} mm/jam) di ${corridor.region}.`);
  } else if (isModerateRain) {
    severity = corridor.highFloodRisk ? 'siaga' : 'waspada';
    signals.push('Curah Hujan Aktif');
    reasons.unshift(`Terdeteksi ${weather.weatherLabel.toLowerCase()} (${precip} mm/jam) yang meningkatkan risiko genangan.`);
  } else if (weather?.weatherLabel) {
    signals.push(`Cuaca: ${weather.weatherLabel}`);
  }

  if (visionObs?.genanganAir) {
    const level = visionObs.tingkatGenangan;
    severity = level === 'ringan' && SEVERITY_ORDER[severity] < SEVERITY_ORDER.waspada ? 'waspada' : 'siaga';
    signals.push('AI Vision CCTV (Genangan)');
    reasons.unshift(`Analisis CCTV terbaru mendeteksi genangan tingkat ${level}${visionObs.catatan ? `: ${visionObs.catatan}` : '.'}`);
  } else if (visionObs?.kondisiJalan === 'macet') {
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER.waspada) severity = 'waspada';
    signals.push('AI Vision CCTV (Padat)');
    reasons.unshift(`Pantauan CCTV menunjukkan antrean padat${visionObs.catatan ? `: ${visionObs.catatan}` : '.'}`);
  }

  const cam = getCameraById(corridor.cameraId);
  const camHealth = corridor.cameraId ? getCameraHealth(corridor.cameraId) : { status: 'unknown' };

  return {
    id: corridor.id,
    corridor: corridor.corridor,
    region: corridor.region,
    lat: cam?.lat ?? corridor.lat,
    lon: cam?.lon ?? corridor.lon,
    severity,
    severityLabel: severity === 'siaga' ? 'Siaga' : severity === 'waspada' ? 'Waspada' : 'Pantau',
    cameraId: cam?.id || corridor.cameraId || null,
    cameraName: cam?.name || corridor.corridor,
    cameraStatus: camHealth?.status || 'unknown',
    precipitationMm: weather?.precipitationMm ?? null,
    weatherLabel: weather?.weatherLabel || null,
    signals,
    summary: reasons[0],
    riskNote: corridor.riskNote,
    mitigation: corridor.mitigation,
    updatedAt: visionObs?.observedAt || weather?.fetchedAt || new Date().toISOString(),
  };
}

/**
 * Ambil seluruh peringatan area rawan Jakarta beserta opsi filter wilayah & tingkat minimum.
 */
export async function getActiveHazardAlerts({
  region = '',
  minSeverity = 'pantau',
  weatherByRegion = null,
} = {}) {
  const weatherData = weatherByRegion || (await fetchJakartaSectorWeather());
  const minRank = SEVERITY_ORDER[minSeverity] || 1;
  const normRegion = String(region || '').trim().toLowerCase();

  const items = MONITORED_CORRIDORS.map((corridor) => {
    const weather = weatherData?.[corridor.region] || null;
    const visionObs = findMatchingVisionObservation(corridor);
    return classifyCorridorAlert(corridor, { weather, visionObs });
  })
    .filter((item) => {
      if (SEVERITY_ORDER[item.severity] < minRank) return false;
      if (normRegion && normRegion !== 'semua' && item.region.toLowerCase() !== normRegion) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]) || a.corridor.localeCompare(b.corridor));

  // Gabungkan juga pengamatan AI Vision di luar 8 koridor utama bila mendeteksi genangan
  pruneExpiredVisionObservations();
  for (const obs of visionObservations.values()) {
    if (!obs.genanganAir || obs.lat === null || obs.lon === null) continue;
    const covered = items.some((it) => it.cameraId === obs.cameraId || haversineDistanceM(it.lat, it.lon, obs.lat, obs.lon) <= 1200);
    if (!covered && SEVERITY_ORDER.siaga >= minRank) {
      items.unshift({
        id: `vision-${obs.cameraId || `${obs.lat}-${obs.lon}`}`,
        corridor: obs.cameraName || 'Titik CCTV Terdeteksi Genangan',
        region: 'DKI Jakarta',
        lat: obs.lat,
        lon: obs.lon,
        severity: obs.tingkatGenangan === 'ringan' ? 'waspada' : 'siaga',
        severityLabel: obs.tingkatGenangan === 'ringan' ? 'Waspada' : 'Siaga',
        cameraId: obs.cameraId,
        cameraName: obs.cameraName,
        cameraStatus: 'online',
        precipitationMm: null,
        weatherLabel: null,
        signals: ['AI Vision CCTV (Genangan)'],
        summary: `AI Vision mendeteksi genangan ${obs.tingkatGenangan}${obs.catatan ? `: ${obs.catatan}` : '.'}`,
        riskNote: obs.catatan || 'Terdeteksi genangan air dari kamera CCTV rute.',
        mitigation: 'Kurangi kecepatan dan hindari jalur paling tepi bila genangan terlihat dalam.',
        updatedAt: obs.observedAt,
      });
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    weatherAvailable: Boolean(weatherData),
    count: items.length,
    alerts: items,
  };
}

/**
 * Periksa area rawan yang beririsan langsung di sekitar geometri rute [[lon, lat], ...].
 */
export async function findAlertsAlongRoute(
  geometry = [],
  { radiusM = 900, minSeverity = 'pantau', alerts = null } = {}
) {
  if (!Array.isArray(geometry) || geometry.length === 0) return [];
  const activeList = Array.isArray(alerts)
    ? alerts
    : (await getActiveHazardAlerts({ minSeverity })).alerts;
  const maxDist = Math.max(150, Math.min(Number(radiusM) || 900, 3000));

  const matched = [];
  for (const alert of activeList) {
    const dist = Math.round(minDistanceToPolylineM(alert.lat, alert.lon, geometry));
    if (dist <= maxDist) {
      matched.push({
        ...alert,
        distanceToRouteM: dist,
      });
    }
  }

  return matched.sort(
    (a, b) =>
      (SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]) ||
      (a.distanceToRouteM - b.distanceToRouteM)
  );
}

