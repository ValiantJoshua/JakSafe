/*
   Lapisan Lalu Lintas (Traffic Flow) di atas peta CesiumJS JakSafe.

   Fitur:
   - Mendukung sakelar ON / OFF layer lalu lintas (setTrafficLayerEnabled).
   - Mode Live TomTom Raster Flow Overlay (`UrlTemplateImageryProvider`):
     Menampilkan layer PNG transparan TomTom (`/api/tomtom/flow/{z}/{x}/{y}.png?style=relative0&tileSize=512`)
     di atas globe Cesium sehingga detail jalan beradaptasi otomatis terhadap level zoom
     seperti Google Maps (tol & arteri utama saat zoom out; jalan kolektor & lokal
     muncul bertahap saat zoom in) di seluruh area pandang.
   - Mode Koridor Arteri Jakarta (Fallback):
     Aktif otomatis bila kuota / kunci API TomTom tidak tersedia sehingga layer Traffic
     tetap tampil sebagai garis koridor utama Jakarta.
*/

import * as Cesium from 'cesium';
import { cekStatusLaluLintas } from '../api/trafficApi.js';
import { urlSumberDaya } from '../api/httpClient.js';
import { getViewer, INDONESIA_BOUNDS } from './cesiumViewer.js';

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

const LIVE_CAMERA_MAX_HEIGHT_M = 450_000;
const STATUS_CHECK_MIN_INTERVAL_MS = 30_000;
const ALPHA_LIVE_NORMAL = 0.65;
const ALPHA_LIVE_FOCUS = 0.22;

/** @type {Cesium.ImageryLayer|null} */
let trafficImageryLayer = null;
/** @type {Cesium.PolylineCollection|null} */
let roadLineCollection = null;
/** @type {Cesium.Event.RemoveCallback|null} */
let moveEndUnsub = null;

/** @type {boolean} */
let layerEnabled = true;
/** @type {'live'|'arteri'|'off'} */
let currentSourceMode = 'arteri';
/** @type {number} */
let activeRoadCount = 0;
/** @type {boolean} Apakah sedang dalam Mode Fokus Rute (rute aktif digambar di peta) */
let routeFocusActive = false;
/** @type {number} */
let lastStatusCheckMs = 0;
/** @type {boolean} */
let errorFallbackPending = false;
/** @type {Promise<void>|null} */
let refreshInflight = null;

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
 * Menentukan warna garis jalan fallback berdasarkan tingkat kelancaran (0.0 macet .. 1.0 lancar).
 * @param {number} level
 */
function warnaLaluLintas(level, dimmed = false) {
  const l = Number.isFinite(level) ? level : 0.65;
  if (l < 0.36) {
    return Cesium.Color.fromCssColorString('#DC2626').withAlpha(dimmed ? 0.28 : 0.78);
  }
  if (l < 0.68) {
    return Cesium.Color.fromCssColorString('#F59E0B').withAlpha(dimmed ? 0.24 : 0.75);
  }
  return Cesium.Color.fromCssColorString('#16A34A').withAlpha(dimmed ? 0.20 : 0.70);
}

/** Menggambar koridor arteri statis ke `roadLineCollection` untuk mode fallback offline/non-API. */
function renderFallbackCorridors() {
  const viewer = getViewer();
  if (!viewer || !roadLineCollection) return;

  roadLineCollection.removeAll();
  activeRoadCount = KORIDOR_ARTERI_JAKARTA.length;

  for (const road of KORIDOR_ARTERI_JAKARTA) {
    if (!Array.isArray(road.coords) || road.coords.length < 2) continue;
    const color = warnaLaluLintas(road.trafficLevel, routeFocusActive);
    const baseWidth = road.highway === 'motorway' ? 4.4 : road.highway === 'trunk' ? 3.6 : 2.8;
    const width = routeFocusActive ? baseWidth * 0.8 : baseWidth;

    roadLineCollection.add({
      positions: road.coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 10)),
      width,
      material: Cesium.Material.fromType('Color', { color }),
    });
  }
}

/** Menyelaraskan tampilan overlay raster live dan polyline fallback dengan status & ketinggian kamera. */
function sinkronkanVisibilitasLayer() {
  const viewer = getViewer();
  if (!viewer) return;

  const height = viewer.camera?.positionCartographic?.height ?? 5000;
  const dalamRentangLive = height <= LIVE_CAMERA_MAX_HEIGHT_M;

  if (trafficImageryLayer && !trafficImageryLayer.isDestroyed?.()) {
    trafficImageryLayer.show = layerEnabled && currentSourceMode === 'live' && dalamRentangLive;
    trafficImageryLayer.alpha = routeFocusActive ? ALPHA_LIVE_FOCUS : ALPHA_LIVE_NORMAL;
  }

  if (roadLineCollection) {
    roadLineCollection.show = layerEnabled && currentSourceMode === 'arteri';
  }

  viewer.scene.requestRender();
}

/** Beralih ke koridor arteri fallback jika tile TomTom gagal atau kuota tidak tersedia. */
function aktifkanModeFallbackArteri() {
  const sebelumnya = currentSourceMode;
  currentSourceMode = 'arteri';
  renderFallbackCorridors();
  sinkronkanVisibilitasLayer();
  if (sebelumnya !== 'arteri') {
    notifyListeners();
  }
}

/** Membuat atau mengembalikan ImageryLayer TomTom Raster Flow PNG di atas basemap. */
function ensureTrafficImageryLayer(viewer) {
  if (
    trafficImageryLayer
    && !trafficImageryLayer.isDestroyed?.()
    && viewer.imageryLayers.contains(trafficImageryLayer)
  ) {
    return trafficImageryLayer;
  }

  const baseFlowUrl = urlSumberDaya('/tomtom/flow');
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: `${baseFlowUrl}/{z}/{x}/{y}.png?style=relative0&tileSize=512`,
    minimumLevel: 0,
    maximumLevel: 17,
    rectangle: Cesium.Rectangle.fromDegrees(
      INDONESIA_BOUNDS.west,
      INDONESIA_BOUNDS.south,
      INDONESIA_BOUNDS.east,
      INDONESIA_BOUNDS.north,
    ),
    tileWidth: 256,
    tileHeight: 256,
    hasAlphaChannel: true,
    enablePickFeatures: false,
    credit: new Cesium.Credit('TomTom Traffic'),
  });

  provider.errorEvent.addEventListener(() => {
    if (errorFallbackPending || !layerEnabled || currentSourceMode !== 'live') return;
    errorFallbackPending = true;
    setTimeout(async () => {
      try {
        const status = await cekStatusLaluLintas();
        lastStatusCheckMs = Date.now();
        if (!status.tersedia && layerEnabled) {
          aktifkanModeFallbackArteri();
        }
      } finally {
        errorFallbackPending = false;
      }
    }, 450);
  });

  trafficImageryLayer = viewer.imageryLayers.addImageryProvider(provider);
  trafficImageryLayer.alpha = routeFocusActive ? ALPHA_LIVE_FOCUS : ALPHA_LIVE_NORMAL;
  trafficImageryLayer.saturation = 1.15;
  trafficImageryLayer.show = false;
  return trafficImageryLayer;
}

/**
 * Memeriksa kesiapan TomTom Live Raster dan mengaktifkan overlay PNG atau fallback arteri.
 * @param {{ forceStatusCheck?: boolean }} [opts]
 */
export async function refreshTrafficViewport({ forceStatusCheck = false } = {}) {
  const viewer = getViewer();
  if (!viewer) return;
  if (!layerEnabled) {
    sinkronkanVisibilitasLayer();
    return;
  }

  const now = Date.now();
  if (
    !forceStatusCheck
    && currentSourceMode === 'live'
    && now - lastStatusCheckMs < STATUS_CHECK_MIN_INTERVAL_MS
  ) {
    sinkronkanVisibilitasLayer();
    return;
  }

  if (refreshInflight) return refreshInflight;

  refreshInflight = (async () => {
    const status = await cekStatusLaluLintas();
    lastStatusCheckMs = Date.now();

    if (!layerEnabled) {
      sinkronkanVisibilitasLayer();
      return;
    }

    if (status.tersedia) {
      ensureTrafficImageryLayer(viewer);
      currentSourceMode = 'live';
      activeRoadCount = 0;
      sinkronkanVisibilitasLayer();
      notifyListeners();
      return;
    }

    aktifkanModeFallbackArteri();
  })();

  try {
    await refreshInflight;
  } finally {
    refreshInflight = null;
  }
}

/**
 * Menyalakan atau mematikan layer Traffic di peta (ON / OFF).
 * @param {boolean} enabled
 */
export function setTrafficLayerEnabled(enabled) {
  layerEnabled = Boolean(enabled);
  sinkronkanVisibilitasLayer();

  if (layerEnabled) {
    refreshTrafficViewport({ forceStatusCheck: currentSourceMode !== 'live' });
  }

  notifyListeners();
}

export function toggleTrafficLayer() {
  setTrafficLayerEnabled(!layerEnabled);
  return layerEnabled;
}

/**
 * Mengatur Mode Fokus Rute pada layer Traffic.
 * Saat rute aktif digambar di peta, opasitas layer traffic diredupkan agar
 * garis rute utama tetap dominan dan mudah dibaca.
 * @param {boolean} active
 */
export function setTrafficRouteFocusMode(active) {
  const next = Boolean(active);
  if (routeFocusActive === next) return;
  routeFocusActive = next;

  if (currentSourceMode === 'arteri' && roadLineCollection) {
    renderFallbackCorridors();
  }
  sinkronkanVisibilitasLayer();
}

/**
 * Menginisialisasi layer Traffic di atas viewer Cesium.
 */
export async function initTrafficLayer() {
  const viewer = getViewer();
  if (!viewer) return;

  if (!roadLineCollection) {
    roadLineCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  }

  // Gambar fallback arteri sekali sebagai cadangan instan bila status TomTom offline
  renderFallbackCorridors();
  sinkronkanVisibilitasLayer();

  if (layerEnabled) {
    await refreshTrafficViewport({ forceStatusCheck: true });
  }

  if (!moveEndUnsub) {
    moveEndUnsub = viewer.camera.moveEnd.addEventListener(() => {
      if (!layerEnabled) return;
      sinkronkanVisibilitasLayer();
      if (Date.now() - lastStatusCheckMs >= STATUS_CHECK_MIN_INTERVAL_MS) {
        void refreshTrafficViewport();
      }
    });
  }
}
