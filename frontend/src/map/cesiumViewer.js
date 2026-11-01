// Adapted from God's Eye View (MIT) — gods-eye-view/src/mapStartup.js & gods-eye-view/src/mapStackController.js
/*
   Inisialisasi dan pengendali utama peta CesiumJS JakSafe (Fokus Indonesia & Jakarta).

   Mendukung dua mode tampilan utama yang bisa di-switch kapan saja:
   1. Mode 3D ("3d")
      - Menggunakan Google Photorealistic 3D Tiles jika Google Maps API Key tersedia
        dan mengizinkan Map Tiles API, atau fallback 3D Globe + OSM/Google Hybrid dengan
        sudut pandang perspektif 3D (-38 derajat).
   2. Mode 2D Normal Map ("2d-road" & "2d-sat")
      - Mematikan 3D Tileset, menyalakan Globe 2D datar dari atas (top-down -90 derajat),
        dan menampilkan layer peta jalan normal Google Maps 2D (Roadmap) atau Satelit Hibrida.
*/

import * as Cesium from 'cesium';

const STORAGE_KEY_GMAPS = 'jaksafe_google_maps_key';

/** Batas wilayah Indonesia (Sabang sampai Merauke, Miangas sampai Rote). */
export const INDONESIA_BOUNDS = {
  west: 94.0,
  south: -11.5,
  east: 141.5,
  north: 6.5,
};

/** Titik pandang preset di Indonesia & Jakarta. */
export const CAMERA_PRESETS = {
  jakarta: {
    label: 'Jakarta Pusat (Sudirman–Monas)',
    lon: 106.8230,
    lat: -6.1920,
    height3d: 1850,
    height2d: 5500,
    headingDeg: 12,
    pitch3dDeg: -38,
  },
  jabodetabek: {
    label: 'Jabodetabek',
    lon: 106.8272,
    lat: -6.2350,
    height3d: 24000,
    height2d: 35000,
    headingDeg: 0,
    pitch3dDeg: -52,
  },
  indonesia: {
    label: 'Nusantara (Indonesia)',
    lon: 117.5000,
    lat: -2.3000,
    height3d: 3300000,
    height2d: 3600000,
    headingDeg: 0,
    pitch3dDeg: -85,
  },
};

/** @type {Cesium.Viewer|null} */
let viewerInstance = null;
/** @type {Cesium.Cesium3DTileset|null} */
let google3dTileset = null;
/** @type {Cesium.Cesium3DTileset|null} */
let osmBuildingsTileset = null;
/** @type {Cesium.ImageryLayer|null} */
let baseImageryLayer = null;

/** @type {'3d'|'2d-road'|'2d-sat'} */
let currentMode = '3d';
/** @type {'3d-photoreal'|'3d-globe'|'2d-road'|'2d-sat'} */
let activeRenderDetail = '3d-globe';
/** @type {string} */
let statusMessage = 'Memuat peta Indonesia...';

/** @type {Set<(info:{mode:string, detail:string, message:string, hasGoogleKey:boolean})=>void>} */
const modeListeners = new Set();

/** Membaca Google Maps API Key dari localStorage atau environment Vite. */
export function getGoogleMapsApiKey() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_GMAPS);
    if (saved && saved.trim()) return saved.trim();
  } catch { /* ignore */ }
  return String(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    || import.meta.env.GOOGLE_MAPS_API_KEY
    || '',
  ).trim();
}

/** Menyimpan Google Maps API Key baru dan memuat ulang layer peta. */
export async function setGoogleMapsApiKey(newKey) {
  const cleaned = String(newKey || '').trim();
  try {
    if (cleaned) localStorage.setItem(STORAGE_KEY_GMAPS, cleaned);
    else localStorage.removeItem(STORAGE_KEY_GMAPS);
  } catch { /* ignore */ }

  if (google3dTileset && viewerInstance) {
    try {
      viewerInstance.scene.primitives.remove(google3dTileset);
    } catch { /* ignore */ }
    google3dTileset = null;
  }
  await setMapViewMode(currentMode, { fly: false });
}

function notifyModeListeners() {
  const payload = {
    mode: currentMode,
    detail: activeRenderDetail,
    message: statusMessage,
    hasGoogleKey: Boolean(getGoogleMapsApiKey()),
  };
  for (const fn of modeListeners) {
    try { fn(payload); } catch { /* ignore */ }
  }
}

export function onMapModeChange(fn) {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

export function getViewer() {
  return viewerInstance;
}

export function getMapViewMode() {
  return currentMode;
}

export function getGoogleMapsKeyStatus() {
  return {
    hasKey: Boolean(getGoogleMapsApiKey()),
    detail: activeRenderDetail,
    message: statusMessage,
  };
}

/**
 * Membuat ImageryProvider 2D (Google Maps 2D Roadmap / Satellite Hybrid, dengan fallback OSM).
 * @param {'road'|'sat'|'hybrid'} style
 */
function create2DImageryProvider(style = 'road') {
  const gKey = getGoogleMapsApiKey();
  // Google Maps 2D Tile Server (mendukung bahasa Indonesia hl=id & region gl=ID)
  const lyrs = style === 'sat' ? 's' : style === 'hybrid' ? 'y' : 'm';
  const keyQuery = gKey ? `&key=${encodeURIComponent(gKey)}` : '';
  try {
    return new Cesium.UrlTemplateImageryProvider({
      url: `https://mt1.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}&hl=id&gl=ID${keyQuery}`,
      maximumLevel: 20,
      credit: new Cesium.Credit('Google Maps 2D'),
    });
  } catch {
    return new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
    });
  }
}

/** Mengganti basemap 2D pada globe. */
function applyGlobeImagery(style = 'road') {
  if (!viewerInstance) return;
  const layers = viewerInstance.imageryLayers;
  if (baseImageryLayer) {
    try { layers.remove(baseImageryLayer, true); } catch { /* ignore */ }
    baseImageryLayer = null;
  }
  const provider = create2DImageryProvider(style);
  baseImageryLayer = layers.addImageryProvider(provider, 0);
}

/**
 * Memuat Google Photorealistic 3D Tileset jika API key tersedia.
 * Jika gagal (mis. Map Tiles API belum diaktifkan di Google Cloud Console),
 * otomatis jatuh ke 3D Globe Hybrid + bangunan 3D agar peta tetap tampil mulus.
 */
async function ensureGoogle3DTileset() {
  if (!viewerInstance) return false;
  if (google3dTileset) return true;

  const googleKey = getGoogleMapsApiKey();
  if (!googleKey) return false;

  try {
    Cesium.GoogleMaps.defaultApiKey = googleKey;
    const tileset = await Cesium.createGooglePhotorealistic3DTileset({
      onlyUsingWithGoogleGeocoder: true,
    });
    if (!viewerInstance) return false;
    google3dTileset = viewerInstance.scene.primitives.add(tileset);
    return true;
  } catch (err) {
    console.warn('[JakSafe Map] Google Photorealistic 3D Tiles fallback ke 3D Globe:', err?.message || err);
    google3dTileset = null;
    return false;
  }
}

/**
 * Mengatur kemiringan kamera saat berpindah antara 3D (miring -38 derajat) dan 2D (tegak lurus -90 derajat)
 * sambil menjaga titik tengah layar (target di permukaan tanah) tetap sama.
 */
function adjustCameraForMode(mode) {
  if (!viewerInstance) return;
  const camera = viewerInstance.camera;
  const canvas = viewerInstance.scene.canvas;

  // Cari titik tengah layar di ellipsoid supaya kamera berputar di sekitar lokasi yang sedang dilihat
  const centerPixel = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const pickEllipsoid = camera.pickEllipsoid(centerPixel, viewerInstance.scene.globe.ellipsoid);
  const carto = pickEllipsoid
    ? Cesium.Cartographic.fromCartesian(pickEllipsoid)
    : camera.positionCartographic;

  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const currentHeight = Math.max(400, Math.min(3800000, camera.positionCartographic.height));

  if (mode === '3d') {
    // Jika melihat dari dekat (< 45 km), miringkan kamera ke perspektif 3D
    const pitchDeg = currentHeight < 45000 ? -38 : -65;
    const latOffset = currentHeight < 45000 ? (currentHeight / 111320) * 0.85 : 0;
    camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat - latOffset, currentHeight),
      orientation: {
        heading: camera.heading,
        pitch: Cesium.Math.toRadians(pitchDeg),
        roll: 0,
      },
      duration: 0.9,
    });
  } else {
    // Mode 2D Normal Map: menghadap lurus ke bawah (top-down -89.9 derajat) dan utara di atas
    camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(800, currentHeight)),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-89.9),
        roll: 0,
      },
      duration: 0.8,
    });
  }
}

/**
 * Mengganti mode tampilan peta antara:
 * - `'3d'`      : Peta 3D Cesium (Google Photorealistic 3D Tiles / 3D Globe)
 * - `'2d-road'` : Peta 2D Normal (Google Maps 2D Jalan Raya)
 * - `'2d-sat'`  : Peta 2D Satelit Hibrida (Google Maps 2D Hybrid)
 *
 * @param {'3d'|'2d-road'|'2d-sat'} mode
 * @param {{fly?:boolean}} [opts]
 */
export async function setMapViewMode(mode, { fly = true } = {}) {
  if (!viewerInstance) return;
  currentMode = mode;
  const controller = viewerInstance.scene.screenSpaceCameraController;

  if (mode === '3d') {
    controller.enableTilt = true;
    controller.enableLook = true;

    const has3DTiles = await ensureGoogle3DTileset();
    if (has3DTiles && google3dTileset) {
      google3dTileset.show = true;
      // Tetap nyalakan globe dengan basemap hybrid sebagai cadangan bila 3D tile sedang streaming
      applyGlobeImagery('hybrid');
      viewerInstance.scene.globe.show = true;
      activeRenderDetail = '3d-photoreal';
      statusMessage = '3D Photorealistic (Google Maps 3D)';
    } else {
      if (google3dTileset) google3dTileset.show = false;
      applyGlobeImagery('hybrid');
      viewerInstance.scene.globe.show = true;
      activeRenderDetail = '3d-globe';
      statusMessage = getGoogleMapsApiKey()
        ? '3D Globe Hybrid (Google Maps)'
        : '3D Globe Indonesia';
    }
  } else if (mode === '2d-sat') {
    if (google3dTileset) google3dTileset.show = false;
    if (osmBuildingsTileset) osmBuildingsTileset.show = false;
    viewerInstance.scene.globe.show = true;
    applyGlobeImagery('hybrid');
    activeRenderDetail = '2d-sat';
    statusMessage = '2D Satelit Hibrida (Google Maps)';
  } else {
    // '2d-road' — Normal 2D Map Layer
    if (google3dTileset) google3dTileset.show = false;
    if (osmBuildingsTileset) osmBuildingsTileset.show = false;
    viewerInstance.scene.globe.show = true;
    applyGlobeImagery('road');
    activeRenderDetail = '2d-road';
    statusMessage = '2D Peta Normal (Google Maps)';
  }

  if (fly) {
    adjustCameraForMode(mode);
  }
  viewerInstance.scene.requestRender();
  notifyModeListeners();
}

/** Toggle cepat antara 3D dan 2D Normal Map. */
export async function toggleMapViewMode() {
  const next = currentMode === '3d' ? '2d-road' : '3d';
  await setMapViewMode(next, { fly: true });
  return next;
}

/**
 * Mengarahkan kamera ke salah satu preset wilayah Indonesia / Jakarta.
 * @param {'jakarta'|'jabodetabek'|'indonesia'} presetKey
 * @param {{duration?:number}} [opts]
 */
export function flyToPreset(presetKey = 'jakarta', { duration = 1.4 } = {}) {
  if (!viewerInstance) return;
  const p = CAMERA_PRESETS[presetKey] || CAMERA_PRESETS.jakarta;
  const is3D = currentMode === '3d';
  const height = is3D ? p.height3d : p.height2d;
  const pitchDeg = is3D ? p.pitch3dDeg : -89.9;
  const headingDeg = is3D ? p.headingDeg : 0;

  // Offset lintang sedikit ke selatan saat miring 3D supaya titik sasaran tepat di tengah layar
  const latOffset = is3D && height < 50000 ? (height / 111320) * 0.72 : 0;

  viewerInstance.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat - latOffset, height),
    orientation: {
      heading: Cesium.Math.toRadians(headingDeg),
      pitch: Cesium.Math.toRadians(pitchDeg),
      roll: 0,
    },
    duration,
  });
}

/**
 * Mengarahkan kamera ke koordinat tertentu di Jakarta/Indonesia.
 * @param {{lon:number, lat:number, height?:number, headingDeg?:number, pitchDeg?:number, duration?:number}} opts
 */
export function flyToCoordinates({
  lon,
  lat,
  height = 1100,
  headingDeg = 0,
  pitchDeg,
  duration = 1.2,
}) {
  if (!viewerInstance || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const is3D = currentMode === '3d';
  const finalPitch = Number.isFinite(pitchDeg) ? pitchDeg : (is3D ? -35 : -89.9);
  const latOffset = is3D && finalPitch > -75 ? (height / 111320) * 0.75 : 0;

  viewerInstance.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat - latOffset, height),
    orientation: {
      heading: Cesium.Math.toRadians(headingDeg),
      pitch: Cesium.Math.toRadians(finalPitch),
      roll: 0,
    },
    duration,
  });
}

/** Perbesar atau perkecil tampilan kamera. */
export function zoomMap(direction = 1) {
  if (!viewerInstance) return;
  const height = viewerInstance.camera.positionCartographic?.height || 2000;
  const step = Math.max(120, height * 0.35);
  if (direction > 0) {
    viewerInstance.camera.zoomIn(step);
  } else {
    viewerInstance.camera.zoomOut(step);
  }
  viewerInstance.scene.requestRender();
}

/**
 * Menjaga agar kamera tetap berada di dalam cakupan wilayah Indonesia
 * (khusus Indonesia dahulu sesuai permintaan).
 */
function enforceIndonesiaBounds(viewer) {
  viewer.camera.changed.addEventListener(() => {
    const carto = viewer.camera.positionCartographic;
    if (!carto) return;
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const height = carto.height;

    const clampedLon = Math.max(INDONESIA_BOUNDS.west, Math.min(INDONESIA_BOUNDS.east, lon));
    const clampedLat = Math.max(INDONESIA_BOUNDS.south, Math.min(INDONESIA_BOUNDS.north, lat));
    const clampedHeight = Math.max(60, Math.min(4500000, height));

    if (Math.abs(clampedLon - lon) > 0.5 || Math.abs(clampedLat - lat) > 0.5) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(clampedLon, clampedLat, clampedHeight),
        orientation: {
          heading: viewer.camera.heading,
          pitch: viewer.camera.pitch,
          roll: viewer.camera.roll,
        },
      });
    }
  });
}

/**
 * Menginisialisasi Cesium.Viewer pada elemen wadah #mapCanvas.
 * @param {string|HTMLElement} containerOrId
 * @returns {Promise<Cesium.Viewer|null>}
 */
export async function initCesiumViewer(containerOrId = 'mapCanvas') {
  if (viewerInstance) return viewerInstance;

  const container = typeof containerOrId === 'string'
    ? document.getElementById(containerOrId)
    : containerOrId;
  if (!container) {
    console.error('[JakSafe Map] Wadah #mapCanvas tidak ditemukan.');
    return null;
  }

  const ionToken = String(
    import.meta.env.VITE_CESIUM_ION_TOKEN
    || import.meta.env.CESIUM_ION_TOKEN
    || '',
  ).trim();
  if (ionToken) {
    Cesium.Ion.defaultAccessToken = ionToken;
  }

  const viewer = new Cesium.Viewer(container, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    vrButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
     navigationInstructionsInitiallyVisible: false,
    skyAtmosphere: new Cesium.SkyAtmosphere(),
    shouldAnimate: true,
    requestRenderMode: false,
    baseLayer: new Cesium.ImageryLayer(create2DImageryProvider('hybrid')),
  });

  viewerInstance = viewer;
  baseImageryLayer = viewer.imageryLayers.get(0);

  // Pengaturan visual Globe & pencahayaan
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0d1630');
  viewer.scene.highDynamicRange = false;
  if (viewer.scene.postProcessStages?.fxaa) {
    viewer.scene.postProcessStages.fxaa.enabled = true;
  }

  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = 45;
  ctrl.maximumZoomDistance = 4500000;

  // Batasi navigasi di kawasan Indonesia
  enforceIndonesiaBounds(viewer);

  // Set posisi awal ke Jakarta Pusat (Sudirman - Bundaran HI - Monas)
  const jkt = CAMERA_PRESETS.jakarta;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(jkt.lon, jkt.lat - 0.012, jkt.height3d),
    orientation: {
      heading: Cesium.Math.toRadians(jkt.headingDeg),
      pitch: Cesium.Math.toRadians(jkt.pitch3dDeg),
      roll: 0,
    },
  });

  // Aktifkan mode 3D (akan memuat Google Photorealistic 3D Tiles jika API key tersedia)
  await setMapViewMode('3d', { fly: false });

  return viewer;
}
