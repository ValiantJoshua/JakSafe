// Adapted from God's Eye View (MIT) — gods-eye-view/src/data/traffic.js & gods-eye-view/src/data/flowTiles.js
/*
   Lapisan Lalu Lintas (Traffic Flow) di atas peta CesiumJS JakSafe.

   Fitur:
   - Mendukung sakelar ON / OFF layer lalu lintas (setTrafficLayerEnabled).
   - Mode Live TomTom Vector Tiles:
     Mengunduh tile vektor biner (/api/tomtom/flow/{z}/{x}/{y}.pbf) untuk area
     pandang Jakarta saat ini, menguraikan protobuf MVT memakai `pbf` dan
     `@mapbox/vector-tile`, lalu menggambar garis koridor jalan berwarna
     (Hijau = Lancar, Kuning/Oranye = Padat, Merah = Macet) beserta partikel
     arus kendaraan yang bergerak secara real-time mengikuti kecepatan jalan.
   - Mode Koridor Arteri Jakarta (Fallback / Pendamping):
     Menampilkan koridor utama Jakarta (Sudirman-Thamrin, Gatot Subroto,
     Rasuna Said, MT Haryono, S. Parman, TB Simatupang, dll.) sehingga
     layer Traffic tetap hidup dan responsif meskipun kuota TomTom habis
     atau kamera sedang melihat dari ketinggian menengah.
*/

import * as Cesium from 'cesium';
import { PbfReader as Pbf } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { cekStatusLaluLintas } from '../api/trafficApi.js';
import { urlSumberDaya } from '../api/httpClient.js';
import { getViewer } from './cesiumViewer.js';

/** Koridor arteri utama Jakarta sebagai baseline / fallback visual lalu lintas. */
const KORIDOR_ARTERI_JAKARTA = [
  {
    id: 'koridor-sudirman-thamrin',
    name: 'Jl. Jend. Sudirman – MH Thamrin',
    highway: 'trunk',
    trafficLevel: 0.42, // Padat merayap
    coords: [
      [106.7996, -6.2248], [106.8065, -6.2185], [106.8146, -6.2116],
      [106.8205, -6.2028], [106.8230, -6.1950], [106.8229, -6.1865],
      [106.8228, -6.1754],
    ],
  },
  {
    id: 'koridor-gatot-subroto',
    name: 'Jl. Jend. Gatot Subroto (Slipi – Semanggi – Kuningan)',
    highway: 'motorway',
    trafficLevel: 0.28, // Macet
    coords: [
      [106.7975, -6.2010], [106.8058, -6.2082], [106.8132, -6.2155],
      [106.8228, -6.2282], [106.8325, -6.2368], [106.8425, -6.2425],
    ],
  },
  {
    id: 'koridor-rasuna-said',
    name: 'Jl. HR Rasuna Said (Kuningan – Menteng)',
    highway: 'primary',
    trafficLevel: 0.48, // Padat
    coords: [
      [106.8302, -6.2400], [106.8312, -6.2275], [106.8322, -6.2160],
      [106.8318, -6.2040], [106.8310, -6.1972],
    ],
  },
  {
    id: 'koridor-mt-haryono-cawang',
    name: 'Jl. MT Haryono (Pancoran – Cawang)',
    highway: 'trunk',
    trafficLevel: 0.31, // Macet
    coords: [
      [106.8425, -6.2425], [106.8520, -6.2432], [106.8628, -6.2442],
      [106.8712, -6.2452], [106.8775, -6.2465],
    ],
  },
  {
    id: 'koridor-s-parman-tomang',
    name: 'Jl. Letjen S. Parman (Grogol – Tomang – Slipi)',
    highway: 'motorway',
    trafficLevel: 0.34, // Macet
    coords: [
      [106.7888, -6.1670], [106.7920, -6.1782], [106.7955, -6.1895],
      [106.7975, -6.2010],
    ],
  },
  {
    id: 'koridor-tb-simatupang',
    name: 'Jl. TB Simatupang (Pondok Indah – Cilandak – Pasar Minggu)',
    highway: 'motorway',
    trafficLevel: 0.38, // Padat
    coords: [
      [106.7830, -6.2885], [106.7980, -6.2902], [106.8125, -6.2920],
      [106.8280, -6.2940], [106.8430, -6.2975], [106.8560, -6.3010],
    ],
  },
  {
    id: 'koridor-antasari-kemang',
    name: 'Jl. Pangeran Antasari – Blok M',
    highway: 'primary',
    trafficLevel: 0.56, // Sedang
    coords: [
      [106.7980, -6.2442], [106.8035, -6.2565], [106.8085, -6.2710],
      [106.8115, -6.2860],
    ],
  },
  {
    id: 'koridor-hayam-wuruk-kota',
    name: 'Jl. Majapahit – Gajah Mada – Kota Tua',
    highway: 'primary',
    trafficLevel: 0.62, // Lancar-sedang
    coords: [
      [106.8228, -6.1705], [106.8202, -6.1610], [106.8178, -6.1502],
      [106.8142, -6.1376],
    ],
  },
  {
    id: 'koridor-ahmad-yani-bypass',
    name: 'Jl. Jend. Ahmad Yani (Cempaka Putih – Rawamangun – Cawang)',
    highway: 'trunk',
    trafficLevel: 0.74, // Lancar
    coords: [
      [106.8768, -6.1540], [106.8765, -6.1765], [106.8762, -6.1985],
      [106.8770, -6.2220], [106.8775, -6.2465],
    ],
  },
  {
    id: 'koridor-tol-dalam-kota-utara',
    name: 'Tol Pelabuhan – Ancol – Kemayoran',
    highway: 'motorway',
    trafficLevel: 0.80, // Lancar
    coords: [
      [106.7900, -6.1350], [106.8180, -6.1320], [106.8450, -6.1380],
      [106.8768, -6.1540],
    ],
  },
];

const TILE_CACHE_TTL_MS = 90_000;
const MAX_TILES_PER_VIEW = 6;
const tileCache = new Map();

/** @type {Cesium.PolylineCollection|null} */
let roadLineCollection = null;
/** @type {Cesium.PointPrimitiveCollection|null} */
let particleCollection = null;
/** @type {Array<object>} */
let activeParticles = [];
/** @type {number|null} */
let animFrameId = null;
/** @type {number|null} */
let cameraDebounceTimer = null;

/** @type {boolean} */
let layerEnabled = true;
/** @type {'live'|'arteri'|'off'} */
let currentSourceMode = 'arteri';
/** @type {number} */
let activeRoadCount = 0;
/** @type {boolean} Apakah sedang dalam Mode Fokus Rute (rute aktif digambar di peta) */
let routeFocusActive = false;
/** @type {Array<{id:string, highway?:string, trafficLevel:number, coords:number[][]}>} */
let lastRenderedRoads = KORIDOR_ARTERI_JAKARTA;

/** @type {Set<(info:{enabled:boolean, mode:string, roadCount:number})=>void>} */
const listeners = new Set();

function notifyListeners() {
  const payload = {
    enabled: layerEnabled,
    mode: layerEnabled ? currentSourceMode : 'off',
    roadCount: activeRoadCount,
  };
  for (const fn of listeners) {
    try { fn(payload); } catch { /* ignore */ }
  }
}

export function onTrafficLayerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isTrafficLayerEnabled() {
  return layerEnabled;
}

export function getTrafficLayerStatus() {
  return {
    enabled: layerEnabled,
    mode: layerEnabled ? currentSourceMode : 'off',
    roadCount: activeRoadCount,
  };
}

/**
 * Menentukan warna garis jalan dan partikel berdasarkan tingkat kelancaran (0.0 macet .. 1.0 lancar).
 * @param {number} level
 */
function warnaLaluLintas(level, dimmed = false) {
  const l = Number.isFinite(level) ? level : 0.65;
  if (l < 0.36) {
    // Macet berat -> Merah lembut transparan
    return {
      line: Cesium.Color.fromCssColorString('#EF4444').withAlpha(dimmed ? 0.28 : 0.55),
      dot: Cesium.Color.fromCssColorString('#FCA5A5').withAlpha(dimmed ? 0.45 : 0.70),
    };
  }
  if (l < 0.68) {
    // Padat merayap -> Kuning / Oranye lembut transparan
    return {
      line: Cesium.Color.fromCssColorString('#F59E0B').withAlpha(dimmed ? 0.22 : 0.50),
      dot: Cesium.Color.fromCssColorString('#FDE68A').withAlpha(dimmed ? 0.40 : 0.68),
    };
  }
  // Lancar -> Hijau zamrud lembut transparan
  return {
    line: Cesium.Color.fromCssColorString('#22C55E').withAlpha(dimmed ? 0.16 : 0.46),
    dot: Cesium.Color.fromCssColorString('#86EFAC').withAlpha(dimmed ? 0.35 : 0.62),
  };
}

/** Konversi lon/lat ke koordinat slippy tile {x, y} pada zoom z. */
function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
  const latRad = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  const y = Math.max(
    0,
    Math.min(n - 1, Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)),
  );
  return { x, y };
}

/** Konversi titik di dalam MVT tile (0..extent) menjadi [lon, lat]. */
function tilePixelToLonLat(z, x, y, px, py, extent = 4096) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n)));
  const lat = (latRad * 180) / Math.PI;
  return [lon, lat];
}

/**
 * Mengurai satu tile biner TomTom Flow (.pbf) menjadi daftar segmen jalan.
 * Adapted from God's Eye View (MIT) — gods-eye-view/src/data/flowTiles.js
 */
function decodeTomTomFlowPbf(buffer, z, x, y) {
  if (!buffer || buffer.byteLength === 0) return [];
  let tile;
  try {
    tile = new VectorTile(new Pbf(new Uint8Array(buffer)));
  } catch {
    return [];
  }

  const layer = tile.layers['Traffic flow']
    || tile.layers.traffic_flow
    || tile.layers[Object.keys(tile.layers)[0]];
  if (!layer) return [];

  const extent = layer.extent || 4096;
  const roads = [];

  for (let i = 0; i < layer.length; i += 1) {
    const feat = layer.feature(i);
    if (feat.type !== 2) continue; // 2 = LineString

    const props = feat.properties || {};
    const rawLevel = Number(props.traffic_level ?? props.relative_speed);
    const closed = Boolean(props.road_closure || props.closed);
    const trafficLevel = closed
      ? 0.05
      : Number.isFinite(rawLevel)
        ? Math.max(0, Math.min(1, rawLevel > 1 ? rawLevel / 100 : rawLevel))
        : 0.65;

    const roadType = String(props.road_type || props.road_category || 'primary').toLowerCase();
    const geom = feat.loadGeometry();

    for (let g = 0; g < geom.length; g += 1) {
      const ring = geom[g];
      if (!ring || ring.length < 2) continue;
      const coords = ring.map((pt) => tilePixelToLonLat(z, x, y, pt.x, pt.y, extent));
      roads.push({
        id: `tt-${z}-${x}-${y}-${i}-${g}`,
        highway: roadType.includes('motorway') || roadType.includes('0') ? 'motorway' : 'primary',
        trafficLevel,
        coords,
      });
    }
  }
  return roads;
}

/** Mengambil satu tile .pbf dari backend dengan cache memori. */
async function fetchTomTomTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached && Date.now() - cached.at < TILE_CACHE_TTL_MS) {
    return cached.roads;
  }

  const url = urlSumberDaya(`/tomtom/flow/${z}/${x}/${y}.pbf`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const roads = decodeTomTomFlowPbf(buf, z, x, y);
  tileCache.set(key, { at: Date.now(), roads });
  return roads;
}

/** Menghitung panjang kumulatif tiap titik pada satu ruas jalan (dalam meter kasar). */
function computeCumulativeLengths(coords) {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dx = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
    const dy = (lat2 - lat1) * 110540;
    total += Math.hypot(dx, dy);
    lengths.push(total);
  }
  return { lengths, total };
}

/** Interpolasi posisi Cartesian3 di sepanjang koordinat jalan pada jarak distM. */
function interpolateAlongRoad(coords, lengths, total, distM) {
  const d = ((distM % total) + total) % total;
  for (let i = 1; i < lengths.length; i += 1) {
    if (d <= lengths[i]) {
      const segStart = lengths[i - 1];
      const segLen = Math.max(0.001, lengths[i] - segStart);
      const t = (d - segStart) / segLen;
      const lon = coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t;
      const lat = coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t;
      return Cesium.Cartesian3.fromDegrees(lon, lat, 12);
    }
  }
  const last = coords[coords.length - 1];
  return Cesium.Cartesian3.fromDegrees(last[0], last[1], 12);
}

/**
 * Menggambar kumpulan ruas jalan (polylines) dan partikel arus kendaraan di Cesium.
 * @param {Array<{id:string, highway?:string, trafficLevel:number, coords:number[][]}>} roads
 */
function renderRoadsAndParticles(roads) {
  const viewer = getViewer();
  if (!viewer || !roadLineCollection || !particleCollection) return;

  lastRenderedRoads = roads;
  roadLineCollection.removeAll();
  particleCollection.removeAll();
  activeParticles = [];

  const cappedRoads = roads.slice(0, 260);
  activeRoadCount = cappedRoads.length;

  // Partikel titik hanya muncul saat zoom dekat (< 3.000m) agar tidak menimbulkan
  // efek "manik-manik" saat kamera melihat keseluruhan rute dari jauh.
  const maxParticleDistance = routeFocusActive ? 2200 : 3000;

  for (const road of cappedRoads) {
    if (!Array.isArray(road.coords) || road.coords.length < 2) continue;

    const { lengths, total } = computeCumulativeLengths(road.coords);
    if (total < 45) continue;

    const style = warnaLaluLintas(road.trafficLevel, routeFocusActive);
    const baseWidth = road.highway === 'motorway' ? 4.2 : road.highway === 'trunk' ? 3.5 : 2.6;
    const width = routeFocusActive ? baseWidth * 0.8 : baseWidth;

    const positions = road.coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 10));

    roadLineCollection.add({
      positions,
      width,
      material: Cesium.Material.fromType('Color', { color: style.line }),
    });

    // Buat partikel kendaraan bergerak di sepanjang jalan (tampil hanya pada zoom dekat)
    const particleCount = Math.max(1, Math.min(8, Math.floor(total / 380)));
    // Kecepatan gerak partikel proporsional terhadap kelancaran lalu lintas (m/s)
    const speedMps = 18 + Math.max(0.12, road.trafficLevel ?? 0.6) * 55;

    for (let p = 0; p < particleCount; p += 1) {
      const startOffset = (total / particleCount) * p;
      const initialPos = interpolateAlongRoad(road.coords, lengths, total, startOffset);
      const pointPrimitive = particleCollection.add({
        position: initialPos,
        pixelSize: road.highway === 'motorway' ? 4.8 : 3.8,
        color: style.dot,
        outlineColor: Cesium.Color.fromCssColorString('#0E1430').withAlpha(routeFocusActive ? 0.25 : 0.40),
        outlineWidth: 1.0,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxParticleDistance),
        scaleByDistance: new Cesium.NearFarScalar(400, 1.0, maxParticleDistance, 0.45),
      });

      activeParticles.push({
        primitive: pointPrimitive,
        coords: road.coords,
        lengths,
        total,
        offsetM: startOffset,
        speedMps,
      });
    }
  }

  viewer.scene.requestRender();
}

/** Loop animasi partikel kendaraan di jalan raya. */
let lastTickMs = 0;
function tickTrafficParticles(nowMs) {
  if (!layerEnabled) {
    animFrameId = null;
    return;
  }
  const dt = lastTickMs ? Math.min(0.1, (nowMs - lastTickMs) / 1000) : 0.016;
  lastTickMs = nowMs;

  if (activeParticles.length > 0) {
    for (const item of activeParticles) {
      item.offsetM = (item.offsetM + item.speedMps * dt) % item.total;
      item.primitive.position = interpolateAlongRoad(
        item.coords,
        item.lengths,
        item.total,
        item.offsetM,
      );
    }
    getViewer()?.scene.requestRender();
  }

  animFrameId = requestAnimationFrame(tickTrafficParticles);
}

function startParticleLoop() {
  if (animFrameId !== null) return;
  lastTickMs = performance.now();
  animFrameId = requestAnimationFrame(tickTrafficParticles);
}

function stopParticleLoop() {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

/**
 * Memuat data lalu lintas untuk area pandang saat ini.
 * Menggabungkan koridor utama Jakarta dengan live tile TomTom (bila tersedia dan dekat).
 */
export async function refreshTrafficViewport() {
  const viewer = getViewer();
  if (!viewer || !layerEnabled) return;

  const carto = viewer.camera.positionCartographic;
  const height = carto?.height || 5000;
  const lon = carto ? Cesium.Math.toDegrees(carto.longitude) : 106.8230;
  const lat = carto ? Cesium.Math.toDegrees(carto.latitude) : -6.1950;

  // Cek apakah berada di sekitar Jabodetabek dan cukup dekat untuk meminta tile vektor TomTom
  const diJabodetabek = lon >= 106.55 && lon <= 107.15 && lat >= -6.55 && lat <= -6.02;

  if (diJabodetabek && height <= 38000) {
    const status = await cekStatusLaluLintas();
    if (status.tersedia) {
      try {
        const z = height < 6000 ? 14 : 13;
        const centerTile = lonLatToTile(lon, lat, z);
        const coordsToFetch = [
          { z, x: centerTile.x, y: centerTile.y },
          { z, x: centerTile.x + 1, y: centerTile.y },
          { z, x: centerTile.x - 1, y: centerTile.y },
          { z, x: centerTile.x, y: centerTile.y + 1 },
        ].slice(0, MAX_TILES_PER_VIEW);

        const tileRoadArrays = await Promise.all(
          coordsToFetch.map((t) => fetchTomTomTile(t.z, t.x, t.y).catch(() => [])),
        );
        const liveRoads = tileRoadArrays.flat();
        if (liveRoads.length > 0) {
          currentSourceMode = 'live';
          renderRoadsAndParticles([...KORIDOR_ARTERI_JAKARTA, ...liveRoads]);
          notifyListeners();
          return;
        }
      } catch {
        // Fallback ke koridor arteri Jakarta
      }
    }
  }

  currentSourceMode = 'arteri';
  renderRoadsAndParticles(KORIDOR_ARTERI_JAKARTA);
  notifyListeners();
}

/**
 * Menyalakan atau mematikan layer Traffic di peta (ON / OFF).
 * @param {boolean} enabled
 */
export function setTrafficLayerEnabled(enabled) {
  layerEnabled = Boolean(enabled);
  if (roadLineCollection) roadLineCollection.show = layerEnabled;
  if (particleCollection) particleCollection.show = layerEnabled;

  if (layerEnabled) {
    refreshTrafficViewport();
    startParticleLoop();
  } else {
    stopParticleLoop();
  }

  getViewer()?.scene.requestRender();
  notifyListeners();
}

export function toggleTrafficLayer() {
  setTrafficLayerEnabled(!layerEnabled);
  return layerEnabled;
}

/**
 * Mengatur Mode Fokus Rute pada layer Traffic.
 * Saat rute aktif digambar di peta, garis traffic latar belakang diredupkan agar
 * garis rute utama tetap dominan dan mudah dibaca.
 * @param {boolean} active
 */
export function setTrafficRouteFocusMode(active) {
  const next = Boolean(active);
  if (routeFocusActive === next) return;
  routeFocusActive = next;
  if (layerEnabled && lastRenderedRoads.length > 0) {
    renderRoadsAndParticles(lastRenderedRoads);
  }
}

/**
 * Menginisialisasi layer Traffic di atas viewer Cesium.
 */
export async function initTrafficLayer() {
  const viewer = getViewer();
  if (!viewer) return;

  if (!roadLineCollection) {
    roadLineCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
    particleCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  }

  roadLineCollection.show = layerEnabled;
  particleCollection.show = layerEnabled;

  // Muat pertama kali (koridor arteri langsung tampil seketika, lalu diperkaya TomTom Live)
  renderRoadsAndParticles(KORIDOR_ARTERI_JAKARTA);
  if (layerEnabled) {
    startParticleLoop();
    refreshTrafficViewport();
  }

  // Muat ulang tile TomTom saat kamera selesai berpindah
  viewer.camera.moveEnd.addEventListener(() => {
    if (!layerEnabled) return;
    if (cameraDebounceTimer) clearTimeout(cameraDebounceTimer);
    cameraDebounceTimer = setTimeout(() => {
      refreshTrafficViewport();
    }, 650);
  });
}
