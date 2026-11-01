// Adapted from God's Eye View (MIT) — gods-eye-view/src/mapStartup.js & gods-eye-view/src/mapStackController.js
/*
   Inisialisasi dan pengendali utama peta CesiumJS JakSafe (Fokus Indonesia & Jakarta).

   Arsitektur Tiling Berjenjang (3-Tier Tiling Optimization & Fallback):
   1. Tier 1 — Cesium Ion 3D / Photorealistic 3D (Aktif bila VITE_CESIUM_ION_TOKEN tersedia):
      - Memuat Cesium World Terrain (kontur 3D Indonesia + normal permukaan & masker air)
        serta Cesium OSM 3D Buildings (seluruh gedung 3D Jakarta/Indonesia dengan
        pewarnaan ketinggian arsitektural modern dan optimasi LOD dynamicScreenSpaceError).
      - Mencoba Google Photorealistic 3D Tiles jika diizinkan oleh kunci Google/Ion.
      - Mengoptimalkan ketajaman tile globe (maximumScreenSpaceError = 1.35,
        tileCacheSize = 1000, preloadAncestors = true) agar peta tajam dan cepat.
   2. Tier 2 — Fallback Standar CesiumJS (Jika TIDAK ada VITE_CESIUM_ION_TOKEN):
      - Otomatis kembali ke CesiumJS standar menggunakan EllipsoidTerrainProvider
        dan basemap hibrida/jalan tanpa memerlukan token Cesium Ion.
   3. Mode 2D Normal Map ("2d-road" & "2d-sat"):
      - Mematikan 3D Buildings & 3D Tileset, meratakan terrain ke 2D top-down (-90 derajat),
        dan menampilkan layer peta jalan normal Google Maps 2D (Roadmap) atau Satelit Hibrida.
*/

import * as Cesium from 'cesium';

const STORAGE_KEY_GMAPS = 'jaksafe_google_maps_key';
const STORAGE_KEY_ION = 'jaksafe_cesium_ion_token';

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
    height3d: 1450,
    height2d: 5500,
    headingDeg: 12,
    pitch3dDeg: -36,
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
/** @type {Cesium.TerrainProvider|null} */
let worldTerrainProvider = null;
/** @type {Cesium.TerrainProvider|null} */
let flatTerrainProvider = null;
/** @type {Cesium.ImageryLayer|null} */
let baseImageryLayer = null;

/** @type {'3d'|'2d-road'|'2d-sat'} */
let currentMode = '3d';
/** @type {'3d-ion-buildings'|'3d-photoreal'|'3d-globe'|'2d-road'|'2d-sat'} */
let activeRenderDetail = '3d-globe';
/** @type {string} */
let statusMessage = 'Memuat peta Indonesia...';

/** @type {Set<(info:{mode:string, detail:string, message:string, hasGoogleKey:boolean, hasIonToken:boolean})=>void>} */
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

/** Membaca Cesium Ion Token dari localStorage atau environment Vite (.env). */
export function getCesiumIonToken() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ION);
    if (saved && saved.trim()) return saved.trim();
  } catch { /* ignore */ }
  return String(
    import.meta.env.VITE_CESIUM_ION_TOKEN
    || import.meta.env.CESIUM_ION_TOKEN
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
    hasIonToken: Boolean(getCesiumIonToken()),
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
    hasIonToken: Boolean(getCesiumIonToken()),
    detail: activeRenderDetail,
    message: statusMessage,
  };
}

/**
 * Mengoptimalkan parameter streaming 3D Tileset (baik Cesium OSM Buildings maupun Photorealistic Tiles)
 * agar tidak membebani GPU/jaringan saat kamera digerakkan cepat.
 * @param {Cesium.Cesium3DTileset} tileset
 * @param {{maxError?:number}} [opts]
 */
function optimize3DTileset(tileset, { maxError = 8 } = {}) {
  if (!tileset) return;
  tileset.maximumScreenSpaceError = maxError;
  tileset.dynamicScreenSpaceError = true;
  tileset.dynamicScreenSpaceErrorDensity = 0.00278;
  tileset.dynamicScreenSpaceErrorFactor = 4.0;
  tileset.dynamicScreenSpaceErrorHeightFalloff = 0.25;
  tileset.cullRequestsWhileMoving = true;
  tileset.cullRequestsWhileMovingMultiplier = 60.0;
  tileset.preloadWhenHidden = false;
  tileset.preferLeaves = true;
}

/**
 * Membuat gaya warna arsitektural untuk gedung 3D Cesium OSM Buildings di Jakarta.
 * Gedung tinggi (pencakar langit Sudirman-Thamrin-Kuningan) diberi nuansa biru kaca kristal,
 * gedung menengah abu-perak terang, dan bangunan rendah putih gading hangat.
 */
function createJakartaBuildingsStyle() {
  return new Cesium.Cesium3DTileStyle({
    color: {
      conditions: [
        ['Number(${feature["cesium#estimatedHeight"]}) >= 120', 'color("#93C5FD", 0.92)'],
        ['Number(${feature["cesium#estimatedHeight"]}) >= 55', 'color("#BFDBFE", 0.90)'],
        ['Number(${feature["cesium#estimatedHeight"]}) >= 22', 'color("#E2E8F0", 0.88)'],
        ['true', 'color("#F1F5F9", 0.85)'],
      ],
    },
  });
}

/**
 * Membuat ImageryProvider 2D dengan ketajaman tinggi (Retina/High-DPI Google Maps 2D
 * atau Bing Aerial / OpenStreetMap fallback).
 * @param {'road'|'sat'|'hybrid'} style
 */
function create2DImageryProvider(style = 'road') {
  const gKey = getGoogleMapsApiKey();
  // scale=2 meminta tile resolusi tinggi (512x512 retina) agar teks jalan & satelit jauh lebih tajam
  const lyrs = style === 'sat' ? 's' : style === 'hybrid' ? 'y' : 'm';
  const keyQuery = gKey ? `&key=${encodeURIComponent(gKey)}` : '';
  try {
    return new Cesium.UrlTemplateImageryProvider({
      url: `https://mt1.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}&scale=2&hl=id&gl=ID${keyQuery}`,
      maximumLevel: 20,
      tileWidth: 512,
      tileHeight: 512,
      credit: new Cesium.Credit('Google Maps'),
    });
  } catch {
    return new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
    });
  }
}

/**
 * Mengganti basemap pada globe dan mengatur ketajaman kontras/saturasi.
 * Jika Cesium Ion tersedia dan mode 'ion-aerial' diminta, memakai Cesium World Imagery (Bing Aerial),
 * jika tidak memakai Google High-DPI Hybrid/Roadmap.
 * @param {'road'|'sat'|'hybrid'|'ion-aerial'} style
 */
async function applyGlobeImagery(style = 'road') {
  if (!viewerInstance) return;
  const layers = viewerInstance.imageryLayers;

  let provider = null;
  if (style === 'ion-aerial' && getCesiumIonToken()) {
    try {
      provider = await Cesium.createWorldImageryAsync({
        style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
      });
    } catch {
      provider = null;
    }
  }
  if (!provider) {
    provider = create2DImageryProvider(style === 'ion-aerial' ? 'hybrid' : style);
  }

  if (baseImageryLayer) {
    try { layers.remove(baseImageryLayer, true); } catch { /* ignore */ }
    baseImageryLayer = null;
  }

  baseImageryLayer = layers.addImageryProvider(provider, 0);
  // Optimasi kejernihan visual basemap
  baseImageryLayer.brightness = style === 'road' ? 1.0 : 1.04;
  baseImageryLayer.contrast = style === 'road' ? 1.02 : 1.08;
  baseImageryLayer.saturation = style === 'road' ? 1.0 : 1.12;
  baseImageryLayer.gamma = 0.98;
}

/**
 * Memastikan Cesium World Terrain & Cesium OSM 3D Buildings dimuat ketika
 * VITE_CESIUM_ION_TOKEN tersedia. Jika tidak ada token atau gagal, mengembalikan false
 * sehingga otomatis fallback ke mode CesiumJS standar.
 */
async function ensureCesiumIon3DAssets() {
  if (!viewerInstance) return false;
  const ionToken = getCesiumIonToken();
  if (!ionToken) return false;

  Cesium.Ion.defaultAccessToken = ionToken;

  // 1. Muat Cesium World Terrain (kontur 3D Indonesia)
  if (!worldTerrainProvider) {
    try {
      worldTerrainProvider = await Cesium.createWorldTerrainAsync({
        requestVertexNormals: true,
        requestWaterMask: true,
      });
    } catch (err) {
      console.warn('[JakSafe Map] Cesium World Terrain gagal dimuat, menggunakan ellipsoid standar:', err?.message || err);
      worldTerrainProvider = null;
    }
  }

  // 2. Muat Cesium OSM 3D Buildings (Gedung 3D seluruh Jakarta & Indonesia)
  if (!osmBuildingsTileset) {
    try {
      const buildings = await Cesium.createOsmBuildingsAsync();
      if (!viewerInstance) return false;
      optimize3DTileset(buildings, { maxError: 6 });
      buildings.style = createJakartaBuildingsStyle();
      osmBuildingsTileset = viewerInstance.scene.primitives.add(buildings);
    } catch (err) {
      console.warn('[JakSafe Map] Cesium OSM 3D Buildings gagal dimuat:', err?.message || err);
      osmBuildingsTileset = null;
    }
  }

  return Boolean(osmBuildingsTileset || worldTerrainProvider);
}

/**
 * Mencoba memuat Google Photorealistic 3D Tileset hanya bila kunci Google Maps
 * memiliki akses ke Map Tiles API.
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
    optimize3DTileset(tileset, { maxError: 8 });
    google3dTileset = viewerInstance.scene.primitives.add(tileset);
    return true;
  } catch {
    google3dTileset = null;
    return false;
  }
}

/**
 * Mengatur kemiringan kamera saat berpindah antara 3D (miring -36 derajat) dan 2D (tegak lurus -90 derajat)
 * sambil menjaga titik tengah layar tetap sama.
 */
function adjustCameraForMode(mode) {
  if (!viewerInstance) return;
  const camera = viewerInstance.camera;
  const canvas = viewerInstance.scene.canvas;

  const centerPixel = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const pickEllipsoid = camera.pickEllipsoid(centerPixel, viewerInstance.scene.globe.ellipsoid);
  const carto = pickEllipsoid
    ? Cesium.Cartographic.fromCartesian(pickEllipsoid)
    : camera.positionCartographic;

  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const currentHeight = Math.max(350, Math.min(3800000, camera.positionCartographic.height));

  if (mode === '3d') {
    const pitchDeg = currentHeight < 45000 ? -36 : -65;
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
 * Mengganti mode tampilan peta dengan dukungan penuh Cesium Ion + Fallback Standar:
 * - `'3d'`      :
 *     1) Jika `VITE_CESIUM_ION_TOKEN` ada -> Mengaktifkan Cesium World Terrain + 3D OSM Buildings Jakarta
 *        di atas basemap High-DPI Hybrid/Aerial.
 *     2) Jika Google 3D Photorealistic juga aktif -> Menampilkan Photorealistic 3D Tiles.
 *     3) Fallback (Tanpa Token Ion) -> Menggunakan 3D Globe Standar CesiumJS saat ini.
 * - `'2d-road'` : Peta 2D Normal (Google Maps 2D Jalan Raya High-DPI)
 * - `'2d-sat'`  : Peta 2D Satelit Hibrida (Google Maps 2D Hybrid High-DPI)
 *
 * @param {'3d'|'2d-road'|'2d-sat'} mode
 * @param {{fly?:boolean}} [opts]
 */
export async function setMapViewMode(mode, { fly = true } = {}) {
  if (!viewerInstance) return;
  currentMode = mode;
  const controller = viewerInstance.scene.screenSpaceCameraController;

  if (!flatTerrainProvider) {
    flatTerrainProvider = new Cesium.EllipsoidTerrainProvider();
  }

  if (mode === '3d') {
    controller.enableTilt = true;
    controller.enableLook = true;

    // Prioritas 1: Gunakan Cesium Ion (World Terrain + 3D OSM Buildings) bila token tersedia
    const hasIon3D = await ensureCesiumIon3DAssets();
    if (hasIon3D) {
      if (google3dTileset) google3dTileset.show = false;
      if (osmBuildingsTileset) osmBuildingsTileset.show = true;
      if (worldTerrainProvider) {
        viewerInstance.terrainProvider = worldTerrainProvider;
      }
      await applyGlobeImagery('hybrid');
      viewerInstance.scene.globe.show = true;
      activeRenderDetail = '3d-ion-buildings';
      statusMessage = '3D Cesium Ion (Gedung 3D & Terrain Indonesia)';
    } else {
      // Prioritas 2: Coba Google Photorealistic 3D Tileset bila ada kunci Google
      const hasGoogle3D = await ensureGoogle3DTileset();
      if (hasGoogle3D && google3dTileset) {
        google3dTileset.show = true;
        if (osmBuildingsTileset) osmBuildingsTileset.show = false;
        await applyGlobeImagery('hybrid');
        viewerInstance.scene.globe.show = true;
        activeRenderDetail = '3d-photoreal';
        statusMessage = '3D Photorealistic (Google Maps 3D)';
      } else {
        // Prioritas 3 (Fallback Standar): Tanpa token Cesium Ion, kembali ke CesiumJS standar
        if (google3dTileset) google3dTileset.show = false;
        if (osmBuildingsTileset) osmBuildingsTileset.show = false;
        viewerInstance.terrainProvider = flatTerrainProvider;
        await applyGlobeImagery('hybrid');
        viewerInstance.scene.globe.show = true;
        activeRenderDetail = '3d-globe';
        statusMessage = '3D Globe Standar (Fallback Tanpa Token Ion)';
      }
    }
  } else if (mode === '2d-sat') {
    if (google3dTileset) google3dTileset.show = false;
    if (osmBuildingsTileset) osmBuildingsTileset.show = false;
    viewerInstance.terrainProvider = flatTerrainProvider;
    viewerInstance.scene.globe.show = true;
    await applyGlobeImagery('hybrid');
    activeRenderDetail = '2d-sat';
    statusMessage = '2D Satelit Hibrida (High-DPI)';
  } else {
    // '2d-road' — Normal 2D Map Layer
    if (google3dTileset) google3dTileset.show = false;
    if (osmBuildingsTileset) osmBuildingsTileset.show = false;
    viewerInstance.terrainProvider = flatTerrainProvider;
    viewerInstance.scene.globe.show = true;
    await applyGlobeImagery('road');
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
 * Menginisialisasi Cesium.Viewer pada elemen wadah #mapCanvas dengan optimasi tiling.
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

  const ionToken = getCesiumIonToken();
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
    msaaSamples: 4,
    baseLayer: new Cesium.ImageryLayer(create2DImageryProvider('hybrid')),
  });

  viewerInstance = viewer;
  baseImageryLayer = viewer.imageryLayers.get(0);

  // Optimasi Resolusi Layar (HiDPI / Retina) & Anti-Aliasing
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2.0);
  if (viewer.scene.postProcessStages?.fxaa) {
    viewer.scene.postProcessStages.fxaa.enabled = true;
  }

  // Optimasi Tiling & Cache Globe agar pemuatan tile jauh lebih cepat dan tajam
  const globe = viewer.scene.globe;
  globe.enableLighting = false;
  globe.depthTestAgainstTerrain = false;
  globe.maximumScreenSpaceError = 1.35; // Lebih rendah dari default (2.0) = tile level lebih tajam
  globe.tileCacheSize = 1000;           // Memperbesar cache dari 100 -> 1000 tile agar pan/zoom instan
  globe.preloadAncestors = true;
  globe.preloadSiblings = true;
  globe.baseColor = Cesium.Color.fromCssColorString('#0d1630');

  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.00018;
  viewer.scene.fog.screenSpaceErrorFactor = 2.0;
  viewer.scene.highDynamicRange = false;

  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = 45;
  ctrl.maximumZoomDistance = 4500000;

  // Batasi navigasi di kawasan Indonesia
  enforceIndonesiaBounds(viewer);

  // Set posisi awal ke Jakarta Pusat (Sudirman - Bundaran HI - Monas)
  const jkt = CAMERA_PRESETS.jakarta;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(jkt.lon, jkt.lat - 0.011, jkt.height3d),
    orientation: {
      heading: Cesium.Math.toRadians(jkt.headingDeg),
      pitch: Cesium.Math.toRadians(jkt.pitch3dDeg),
      roll: 0,
    },
  });

  // Aktifkan mode 3D (otomatis memakai Cesium Ion 3D Buildings + Terrain jika token ada,
  // atau fallback ke CesiumJS standar jika token tidak ada)
  await setMapViewMode('3d', { fly: false });

  return viewer;
}
