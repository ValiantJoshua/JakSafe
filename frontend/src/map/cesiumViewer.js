// Adapted from God's Eye View (MIT) — gods-eye-view/src/mapStartup.js & gods-eye-view/src/mapStackController.js
/*
   Inisialisasi dan pengendali utama peta CesiumJS JakSafe (Fokus Indonesia & Jakarta).

   Perbaikan Visual & Tiling:
   1. Permukaan Tanah Rata & Presisi (Anti-Gelombang):
      Data DEM global (SRTM 30m) di area padat gedung seperti Jakarta sering memantul
      di atap gedung sehingga menimbulkan "bukit palsu" yang membuat jalan raya tampak
      melengkung/bergelombang. Untuk mengatasinya, permukaan dasar memakai
      EllipsoidTerrainProvider yang 100% rata dan presisi, dipadukan dengan
      depthTestAgainstTerrain = true.
   2. Gedung 3D Clean (Gaya Google Maps 3D):
      Menggunakan warna solid arsitektural bersih (tanpa transparansi dinding dalam yang
      tumpang-tindih) dengan pencahayaan DirectionalLight lembut dari atas, sehingga
      bentuk setiap gedung di Sudirman–Thamrin–Monas tampak rapi dan tegas.
   3. Fallback Otomatis:
      Jika VITE_CESIUM_ION_TOKEN tersedia -> Memuat gedung 3D Cesium OSM Buildings.
      Jika tidak ada token -> Otomatis fallback ke CesiumJS standar tanpa error.
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
    label: 'Jakarta Pusat',
    lon: 106.8230,
    lat: -6.1920,
    height3d: 1350,
    height2d: 5200,
    headingDeg: 10,
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
    label: 'Indonesia',
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
let osmBuildingsTileset = null;
/** @type {Cesium.TerrainProvider|null} */
let flatTerrainProvider = null;
/** @type {Cesium.ImageryLayer|null} */
let baseImageryLayer = null;

/** @type {'3d'|'2d-road'|'2d-sat'} */
let currentMode = '3d';
/** @type {boolean} */
let buildingsEnabled = true;
/** @type {string} */
let statusMessage = '3D Peta Jakarta';

/** @type {Set<(info:{mode:string, buildingsEnabled:boolean, message:string, hasIonToken:boolean})=>void>} */
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

function notifyModeListeners() {
  const payload = {
    mode: currentMode,
    buildingsEnabled,
    message: statusMessage,
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

export function isBuildingsLayerEnabled() {
  return buildingsEnabled;
}

/**
 * Menyalakan atau mematikan tampilan gedung 3D (ON / OFF).
 * @param {boolean} enabled
 */
export async function setBuildingsLayerEnabled(enabled) {
  buildingsEnabled = Boolean(enabled);
  if (buildingsEnabled && currentMode === '3d' && !osmBuildingsTileset) {
    await ensureCesiumIonBuildings();
  }
  if (osmBuildingsTileset) {
    osmBuildingsTileset.show = buildingsEnabled && currentMode === '3d';
    terapkanNadaBasemap();
  }
  viewerInstance?.scene.requestRender();
  notifyModeListeners();
}

export async function toggleBuildingsLayer() {
  await setBuildingsLayerEnabled(!buildingsEnabled);
  return buildingsEnabled;
}

/**
 * Mengoptimalkan parameter streaming 3D Tileset agar ringan dan tajam.
 * @param {Cesium.Cesium3DTileset} tileset
 */
function optimize3DTileset(tileset) {
  if (!tileset) return;
  tileset.maximumScreenSpaceError = 6;
  tileset.dynamicScreenSpaceError = true;
  tileset.dynamicScreenSpaceErrorDensity = 0.00278;
  tileset.dynamicScreenSpaceErrorFactor = 4.0;
  tileset.dynamicScreenSpaceErrorHeightFalloff = 0.25;
  tileset.cullRequestsWhileMoving = true;
  tileset.cullRequestsWhileMovingMultiplier = 60.0;
  tileset.preloadWhenHidden = false;
}

/**
 * Gaya gedung 3D arsitektural "clean maket" (ala Google Maps 3D), versi 2.
 *
 * Seluruh perhitungan dilakukan di CustomShader UNLIT, sehingga gedung TIDAK pernah
 * menjadi hitam akibat posisi matahari ECEF atau waktu malam. Peningkatan versi 2:
 *
 * 1. Cahaya arah TETAP di koordinat dunia (bukan mengikuti kamera).
 *    Normal permukaan diubah ke ECEF lalu dibandingkan dengan arah cahaya dari
 *    barat laut-atas pada bidang lokal East-North-Up. Hasilnya sisi gedung yang sama
 *    selalu terang/gelap secara konsisten walau peta diputar, sehingga sudut dan
 *    volume bangunan terbaca jelas.
 * 2. Gradasi kaki gedung (ambient occlusion palsu).
 *    Dinding sedikit lebih gelap di dekat tanah dan makin terang ke atas, supaya gedung
 *    terasa berdiri di tanah dan tidak "mengambang". Acuan ketinggian tanah diambil
 *    dari minimumHeight bounding region tile yang sedang tampil (lihat
 *    pasangAcuanTanahGedung), karena Jakarta datar sehingga satu acuan per tampilan cukup.
 * 3. Kabut jarak (distance fade).
 *    Gedung jauh perlahan menyatu ke warna basemap sehingga ada kedalaman perspektif.
 *    Jarak kabut menyesuaikan ketinggian kamera (lihat perbaruiKabutGedung).
 * 4. Tint menurut ketinggian (Cesium3DTileStyle, blend HIGHLIGHT = perkalian).
 *    Pencakar langit diberi rona biru-kaca sesuai palet JakSafe, gedung menengah
 *    netral, rumah rendah putih hangat. Gaya per-fitur ini dikalikan SETELAH custom
 *    shader, jadi pencahayaan tetap utuh.
 */

/** Warna kabut = warna basemap 3D setelah diredupkan (lihat terapkanNadaBasemap). */
const BUILDING_FOG_COLOR = new Cesium.Cartesian3(0.925, 0.94, 0.957);

/** @type {Cesium.CustomShader|null} */
let buildingShader = null;

function buatShaderGedung() {
  return new Cesium.CustomShader({
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms: {
      u_groundHeight: { type: Cesium.UniformType.FLOAT, value: 0.0 },
      u_aoStrength: { type: Cesium.UniformType.FLOAT, value: 0.0 },
      u_fogNear: { type: Cesium.UniformType.FLOAT, value: 2200.0 },
      u_fogFar: { type: Cesium.UniformType.FLOAT, value: 9000.0 },
      u_fogColor: { type: Cesium.UniformType.VEC3, value: BUILDING_FOG_COLOR },
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 posWC = fsInput.attributes.positionWC;

        // --- Bidang lokal East-North-Up di titik fragmen ---
        vec3 up = normalize(posWC);
        vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), up));
        vec3 north = cross(up, east);

        // Normal permukaan dalam koordinat dunia (ECEF)
        vec3 nWC = normalize(czm_inverseViewRotation * normalize(fsInput.attributes.normalEC));

        // --- 1. Cahaya arah tetap dari barat laut-atas ---
        vec3 lightDir = normalize(-0.55 * east + 0.45 * north + 0.70 * up);
        float lambert = clamp(dot(nWC, lightDir), 0.0, 1.0);
        float upness = dot(nWC, up);
        float roofness = smoothstep(0.55, 0.85, upness);

        vec3 roofColor = vec3(0.985, 0.990, 1.000);
        vec3 wallLit   = vec3(0.955, 0.966, 0.984);
        vec3 wallShade = vec3(0.735, 0.785, 0.865);   // bayangan slate kebiruan (palet navy)
        vec3 wall = mix(wallShade, wallLit, lambert);
        vec3 color = mix(wall, roofColor, roofness);

        // --- 2. Gradasi kaki gedung (ambient occlusion palsu) ---
        float a = 6378137.0;
        float b = 6356752.3142;
        float rp = length(posWC);
        float sinLat = posWC.z / rp;
        float cosLat = sqrt(max(0.0, 1.0 - sinLat * sinLat));
        float rEll = (a * b) / sqrt((b * cosLat) * (b * cosLat) + (a * sinLat) * (a * sinLat));
        float heightAboveGround = (rp - rEll) - u_groundHeight;
        float ao = smoothstep(0.0, 24.0, heightAboveGround);
        float aoFactor = mix(0.80, 1.0, ao);
        color *= mix(1.0, aoFactor, u_aoStrength * (1.0 - roofness));

        // --- 3. Kabut jarak: gedung jauh menyatu ke warna basemap ---
        float dist = length(fsInput.attributes.positionEC);
        float fog = smoothstep(u_fogNear, u_fogFar, dist) * 0.62;
        color = mix(color, u_fogColor, fog);

        material.diffuse = color;
        material.alpha = 1.0;
      }
    `,
  });
}

/**
 * Tint per-gedung menurut ketinggian. Nilai warna dikalikan dengan hasil shader
 * (Cesium3DTileColorBlendMode.HIGHLIGHT), jadi semua warna dibuat mendekati putih.
 */
function buatGayaTintKetinggian() {
  const h = 'Number(${feature["cesium#estimatedHeight"]})';
  return new Cesium.Cesium3DTileStyle({
    color: {
      conditions: [
        [`${h} >= 150`, 'color("#BFD3F2", 1.0)'],   // pencakar langit: biru-kaca
        [`${h} >= 80`, 'color("#D2E0F6", 1.0)'],    // tower tinggi
        [`${h} >= 40`, 'color("#E6EDF8", 1.0)'],    // gedung menengah
        [`${h} >= 15`, 'color("#F5F6F8", 1.0)'],    // ruko / gedung rendah: netral
        ['true', 'color("#FFFAF3", 1.0)'],          // rumah tapak: putih hangat
      ],
    },
  });
}

function applyCleanArchitecturalLook(tileset) {
  try {
    buildingShader = buatShaderGedung();
    tileset.customShader = buildingShader;
    tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.HIGHLIGHT;
    tileset.style = buatGayaTintKetinggian();
    pasangAcuanTanahGedung(tileset);
  } catch (err) {
    console.warn('[JakSafe Map] CustomShader fallback ke Cesium3DTileStyle:', err);
    buildingShader = null;
    tileset.customShader = undefined;
    tileset.style = new Cesium.Cesium3DTileStyle({
      color: {
        conditions: [
          ['Number(${feature["cesium#estimatedHeight"]}) >= 100', 'color("#DCE8FA", 1.0)'],
          ['Number(${feature["cesium#estimatedHeight"]}) >= 45', 'color("#E8EFFA", 1.0)'],
          ['true', 'color("#F4F7FB", 1.0)'],
        ],
      },
    });
  }

  // Set ambient / diffuse factor aman (maksimal 1.0 di CesiumJS)
  if (tileset.imageBasedLighting) {
    tileset.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(1.0, 1.0);
  }
}

/**
 * Menentukan acuan ketinggian tanah untuk gradasi kaki gedung.
 *
 * Gedung OSM ditempatkan pada ketinggian medan aslinya, sedangkan globe JakSafe
 * memakai ellipsoid rata. Karena itu acuan tanah diambil dari median minimumHeight
 * bounding region milik tile yang sedang tampil, lalu dihaluskan antar-frame supaya
 * tidak berkedip. Bila belum ada sampel, gradasi dimatikan (u_aoStrength = 0).
 */
function pasangAcuanTanahGedung(tileset) {
  if (!viewerInstance || !buildingShader) return;
  const scene = viewerInstance.scene;
  let sampel = [];
  let frame = 0;
  let acuan = null;

  tileset.tileVisible.addEventListener((tile) => {
    const minH = tile?.boundingVolume?.minimumHeight;
    if (Number.isFinite(minH) && sampel.length < 600) sampel.push(minH);
  });

  scene.preRender.addEventListener(() => {
    sampel = [];
  });

  scene.postRender.addEventListener(() => {
    frame += 1;
    if (frame % 12 !== 0 || sampel.length === 0 || !buildingShader) return;
    const urut = sampel.slice().sort((x, y) => x - y);
    const median = urut[Math.floor(urut.length / 2)];
    const baru = acuan === null ? median : acuan + (median - acuan) * 0.25;
    if (acuan === null || Math.abs(baru - acuan) > 0.05) {
      acuan = baru;
      buildingShader.setUniform('u_groundHeight', acuan);
      buildingShader.setUniform('u_aoStrength', 1.0);
    }
  });
}

/** Menyesuaikan jarak kabut gedung dengan ketinggian kamera (dipanggil tiap preRender). */
function perbaruiKabutGedung() {
  if (!viewerInstance || !buildingShader) return;
  const h = viewerInstance.camera.positionCartographic?.height;
  if (!Number.isFinite(h)) return;
  const near = Math.max(1200, Math.min(30000, h * 1.6));
  buildingShader.setUniform('u_fogNear', near);
  buildingShader.setUniform('u_fogFar', near * 3.6);
}

/**
 * Nada basemap. Di mode 3D dengan gedung aktif, basemap sedikit diredupkan dan
 * dikurangi saturasinya supaya gedung putih, garis rute, dan layer lalu lintas
 * lebih menonjol, dan label jalan yang tercetak di citra tidak terlalu ramai.
 * Di mode 2D basemap kembali ke warna aslinya.
 */
function terapkanNadaBasemap() {
  if (!baseImageryLayer) return;
  const redup = currentMode === '3d' && buildingsEnabled && Boolean(osmBuildingsTileset);
  baseImageryLayer.brightness = redup ? 0.96 : 1.0;
  baseImageryLayer.contrast = redup ? 0.94 : 1.02;
  baseImageryLayer.saturation = redup ? 0.55 : 1.0;
  baseImageryLayer.gamma = redup ? 1.04 : 1.0;
  viewerInstance?.scene.requestRender();
}

/**
 * Membuat ImageryProvider 2D High-DPI (Retina 512x512).
 * - 'road': Peta jalan bersih Google Maps (tanpa foto satelit yang terdistorsi)
 * - 'sat' : Citra satelit murni
 * - 'hybrid': Citra satelit dengan nama jalan untuk mode 2D Satelit
 * @param {'road'|'sat'|'hybrid'} style
 */
function create2DImageryProvider(style = 'road') {
  const gKey = getGoogleMapsApiKey();
  const lyrs = style === 'sat' ? 's' : style === 'hybrid' ? 'y' : 'm';
  const keyQuery = gKey ? `&key=${encodeURIComponent(gKey)}` : '';
  try {
    return new Cesium.UrlTemplateImageryProvider({
      url: `https://mt1.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}&scale=2&hl=id&gl=ID${keyQuery}`,
      maximumLevel: 20,
      tileWidth: 256,
      tileHeight: 256,
      credit: new Cesium.Credit('Google Maps'),
    });
  } catch {
    return new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
    });
  }
}

/** Mengganti basemap pada globe. */
async function applyGlobeImagery(style = 'road') {
  if (!viewerInstance) return;
  const layers = viewerInstance.imageryLayers;
  const provider = create2DImageryProvider(style);

  if (baseImageryLayer) {
    try { layers.remove(baseImageryLayer, true); } catch { /* ignore */ }
    baseImageryLayer = null;
  }

  baseImageryLayer = layers.addImageryProvider(provider, 0);
  baseImageryLayer.brightness = 1.0;
  baseImageryLayer.contrast = 1.02;
  baseImageryLayer.saturation = 1.0;
  terapkanNadaBasemap();
}

/**
 * Memuat Cesium OSM 3D Buildings bila VITE_CESIUM_ION_TOKEN tersedia.
 * Permukaan tanah tetap memakai EllipsoidTerrainProvider (rata 100%) supaya
 * jalan raya di Jakarta tidak bergelombang atau melengkung akibat noise radar SRTM.
 */
async function ensureCesiumIonBuildings() {
  if (!viewerInstance) return false;
  const ionToken = getCesiumIonToken();
  if (!ionToken) return false;

  Cesium.Ion.defaultAccessToken = ionToken;

  if (!osmBuildingsTileset) {
    try {
      const buildings = await Cesium.createOsmBuildingsAsync();
      if (!viewerInstance) return false;
      optimize3DTileset(buildings);
      applyCleanArchitecturalLook(buildings);
      osmBuildingsTileset = viewerInstance.scene.primitives.add(buildings);
    } catch (err) {
      console.warn('[JakSafe Map] Cesium OSM 3D Buildings fallback ke globe standar:', err?.message || err);
      osmBuildingsTileset = null;
    }
  }

  return Boolean(osmBuildingsTileset);
}

/**
 * Mengatur kemiringan kamera saat berpindah antara 3D (-38 derajat) dan 2D (-90 derajat).
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
    const pitchDeg = currentHeight < 45000 ? -38 : -65;
    const latOffset = currentHeight < 45000 ? (currentHeight / 111320) * 0.80 : 0;
    camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat - latOffset, currentHeight),
      orientation: {
        heading: camera.heading,
        pitch: Cesium.Math.toRadians(pitchDeg),
        roll: 0,
      },
      duration: 0.85,
    });
  } else {
    camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(800, currentHeight)),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-89.9),
        roll: 0,
      },
      duration: 0.75,
    });
  }
}

/**
 * Mengganti mode tampilan peta:
 * - `'3d'`      : Peta Jalan Bersih + Gedung 3D Arsitektural (dengan fallback bila tanpa token Ion)
 * - `'2d-road'` : Peta 2D Normal (Google Maps Roadmap)
 * - `'2d-sat'`  : Peta 2D Satelit Hibrida (Google Maps Hybrid)
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
  // Selalu gunakan permukaan tanah rata (Ellipsoid) agar tekstur jalan tidak melengkung/bergelombang
  viewerInstance.terrainProvider = flatTerrainProvider;

  if (mode === '3d') {
    controller.enableTilt = true;
    controller.enableLook = true;

    // Gunakan basemap jalan bersih ('road') di bawah gedung 3D ala Google Maps 3D
    await applyGlobeImagery('road');
    viewerInstance.scene.globe.show = true;

    const hasBuildings = await ensureCesiumIonBuildings();
    if (hasBuildings && osmBuildingsTileset) {
      osmBuildingsTileset.show = buildingsEnabled;
      statusMessage = '3D Peta Jakarta';
    } else {
      statusMessage = '3D Globe Standar';
    }
  } else if (mode === '2d-sat') {
    // Mode 2D Satelit: Kunci kemiringan kamera (kamera murni tegak lurus dari atas / top-down)
    controller.enableTilt = false;
    controller.enableLook = false;

    if (osmBuildingsTileset) osmBuildingsTileset.show = false;
    viewerInstance.scene.globe.show = true;
    await applyGlobeImagery('hybrid');
    statusMessage = '2D Satelit';
  } else {
    // Mode 2D Peta Normal: Kunci kemiringan kamera (kamera murni tegak lurus dari atas / top-down)
    controller.enableTilt = false;
    controller.enableLook = false;

    if (osmBuildingsTileset) osmBuildingsTileset.show = false;
    viewerInstance.scene.globe.show = true;
    await applyGlobeImagery('road');
    statusMessage = '2D Peta Normal';
  }

  // Nada basemap diterapkan setelah status gedung 3D pasti (redup hanya di 3D + gedung aktif)
  terapkanNadaBasemap();
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
export function flyToPreset(presetKey = 'jakarta', { duration = 1.3 } = {}) {
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
 */
export function flyToCoordinates({
  lon,
  lat,
  height = 1000,
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

/**
 * Perbesar atau perkecil tampilan kamera dengan animasi transisi halus (smooth animated zoom).
 * @param {number} direction 1 untuk zoom in (perbesar), -1 untuk zoom out (perkecil)
 */
export function zoomMap(direction = 1) {
  if (!viewerInstance) return;
  const camera = viewerInstance.camera;
  const currentHeight = camera.positionCartographic?.height || 2000;

  // Faktor perbesaran: maju ~40% untuk zoom in, mundur ~55% untuk zoom out
  const factor = direction > 0 ? 0.60 : 1.55;
  const targetHeight = Math.max(70, Math.min(3800000, currentHeight * factor));
  const diff = currentHeight - targetHeight;

  // Gerakkan kamera sepanjang arah pandang garis mata saat ini
  const moveVector = Cesium.Cartesian3.multiplyByScalar(
    camera.direction,
    diff,
    new Cesium.Cartesian3(),
  );
  const targetDestination = Cesium.Cartesian3.add(
    camera.position,
    moveVector,
    new Cesium.Cartesian3(),
  );

  // Transisi animasi mulus & responsif dengan orientasi terkunci per mode
  const is3D = currentMode === '3d';
  camera.flyTo({
    destination: targetDestination,
    orientation: {
      heading: is3D ? camera.heading : 0,
      pitch: is3D ? camera.pitch : Cesium.Math.toRadians(-89.9),
      roll: 0,
    },
    duration: 0.35,
    easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
  });
}

/** Menjaga agar kamera tetap berada di dalam cakupan wilayah Indonesia. */
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

  flatTerrainProvider = new Cesium.EllipsoidTerrainProvider();

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
    terrainProvider: flatTerrainProvider,
    shouldAnimate: true,
    requestRenderMode: false,
    msaaSamples: 4,
    baseLayer: new Cesium.ImageryLayer(create2DImageryProvider('road')),
  });

  viewerInstance = viewer;
  baseImageryLayer = viewer.imageryLayers.get(0);

  // Optimasi Resolusi Layar (HiDPI / Retina) & Anti-Aliasing
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2.0);
  if (viewer.scene.postProcessStages?.fxaa) {
    viewer.scene.postProcessStages.fxaa.enabled = true;
  }

  // Pencahayaan arah mengikuti arah pandang kamera (Headlight + Sun dari atas)
  // Di Cesium, koordinat tetap (ECEF) pada bujur Jakarta (106.8 BT) sebelumnya mengarah
  // dari bawah bumi sehingga gedung terkena bayangan gelap/hitam. Dengan mengikuti
  // arah kamera pada setiap preRender, gedung 3D selalu tersinari terang & bersih.
  const cameraLight = new Cesium.DirectionalLight({
    direction: Cesium.Cartesian3.clone(viewer.camera.directionWC),
    color: Cesium.Color.WHITE,
    intensity: 2.4,
  });
  viewer.scene.light = cameraLight;
  viewer.scene.preRender.addEventListener(() => {
    Cesium.Cartesian3.clone(viewer.camera.directionWC, cameraLight.direction);
    // Jarak kabut gedung 3D menyesuaikan ketinggian kamera
    perbaruiKabutGedung();
  });

  // Optimasi Globe: permukaan rata bebas gelombang
  const globe = viewer.scene.globe;
  globe.enableLighting = false;
  globe.depthTestAgainstTerrain = false;
  globe.maximumScreenSpaceError = 1.35;
  globe.tileCacheSize = 1000;
  globe.preloadAncestors = true;
  globe.preloadSiblings = true;
  globe.baseColor = Cesium.Color.fromCssColorString('#E8EEF5');

  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.00014;
  viewer.scene.highDynamicRange = false;

  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = 45;
  ctrl.maximumZoomDistance = 4500000;

  // Hapus aksi LEFT_DOUBLE_CLICK bawaan Cesium yang menyebabkan kamera tilting ke cakrawala.
  // Gantikan dengan zoomMap(1) yang aman dan menjaga orientasi kamera 2D tetap tegak lurus.
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  viewer.screenSpaceEventHandler.setInputAction(() => {
    zoomMap(1);
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  // Penjaga konsistensi mode 2D: jika ada pergerakan kamera di mode 2D yang mengubah pitch,
  // kembalikan segera ke posisi tegak lurus top-down (-89.9 derajat).
  viewer.camera.moveEnd.addEventListener(() => {
    if (currentMode !== '3d') {
      const pitchDeg = Cesium.Math.toDegrees(viewer.camera.pitch);
      if (pitchDeg > -85) {
        viewer.camera.setView({
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-89.9),
            roll: 0,
          },
        });
      }
    }
  });

  enforceIndonesiaBounds(viewer);

  const jkt = CAMERA_PRESETS.jakarta;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(jkt.lon, jkt.lat - 0.010, jkt.height3d),
    orientation: {
      heading: Cesium.Math.toRadians(jkt.headingDeg),
      pitch: Cesium.Math.toRadians(jkt.pitch3dDeg),
      roll: 0,
    },
  });

  await setMapViewMode('3d', { fly: false });

  return viewer;
}
