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
const STORAGE_KEY_CARTO = 'jaksafe_carto_api_key';

/** Batas wilayah Indonesia (Sabang sampai Merauke, Miangas sampai Rote). */
export const INDONESIA_BOUNDS = {
  west: 94.0,
  south: -11.5,
  east: 141.5,
  north: 6.5,
};

/** Sudut pandang 3D isometrik terkunci ala trafik.live (Utara di atas, tilt stabil -46°). */
const LOCKED_3D_PITCH_DEG = -46;
const LOCKED_3D_HEADING_DEG = 0;

/** Titik pandang preset di Indonesia & Jakarta. */
export const CAMERA_PRESETS = {
  jakarta: {
    label: 'Jakarta Pusat',
    lon: 106.8230,
    lat: -6.1920,
    height3d: 1350,
    height2d: 5200,
    headingDeg: LOCKED_3D_HEADING_DEG,
    pitch3dDeg: LOCKED_3D_PITCH_DEG,
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
/** @type {Cesium.TerrainProvider|null} Hanya dipakai untuk sampling elevasi gedung (globe tetap datar) */
let worldTerrainSampler = null;
/** @type {Promise<Cesium.TerrainProvider|null>|null} */
let worldTerrainPromise = null;
/** @type {{lon:number, lat:number}|null} */
let lastSampledCenter = null;
/** @type {number|null} */
let groundSampleTimer = null;
/** @type {Cesium.ImageryLayer|null} */
let baseImageryLayer = null;
/** @type {Cesium.ImageryLayer|null} Layer teks jalan & daerah terpisah (khusus mode 3D) */
let labelOverlayLayer = null;
/** @type {boolean} Guard agar listener layerAdded tidak rekursif saat menaikkan label */
let raisingLabelLayer = false;
/** @type {number} Offset vertikal (meter) untuk menempelkan gedung OSM ke ellipsoid datar */
let appliedGroundOffset = 0;

/** @type {'3d'|'2d-road'|'2d-sat'} */
let currentMode = '2d-road';
/** @type {'clean-3d'|'road'|'sat'|'hybrid'|null} */
let currentImageryStyle = null;
/** @type {boolean} */
let buildingsEnabled = false;
/** @type {string} */
let statusMessage = '2D Standard Map';
/** @type {number} */
let lastFogHeight = -1;

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

/** Membaca CARTO Basemaps API Key dari localStorage atau environment Vite (.env). */
export function getCartoApiKey() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_CARTO);
    if (saved && saved.trim()) return saved.trim();
  } catch { /* ignore */ }
  return String(
    import.meta.env.VITE_CARTO_API_KEY
    || import.meta.env.CARTO_API_KEY
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
    lastFogHeight = -1;
    osmBuildingsTileset.show = buildingsEnabled && currentMode === '3d';
    if (osmBuildingsTileset.show) {
      perbaruiKabutGedung();
      void selaraskanElevasiGedungKeTanah({ force: true });
    }
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
  // SSE 6.5 + dynamicFactor 2.2: leaf tile rumah kecil tetap termuat hingga ~1500 m
  // (memberi ruang bagi animasi u_smallScale turun halus ke 0 m di 550..1300 m),
  // lalu otomatis di-cull oleh Cesium saat zoom out lebih jauh agar performa tetap ringan.
  tileset.maximumScreenSpaceError = 6.5;
  tileset.dynamicScreenSpaceError = true;
  tileset.dynamicScreenSpaceErrorDensity = 0.00278;
  tileset.dynamicScreenSpaceErrorFactor = 2.2;
  tileset.dynamicScreenSpaceErrorHeightFalloff = 0.25;
  tileset.cullRequestsWhileMoving = true;
  tileset.cullRequestsWhileMovingMultiplier = 60.0;
  tileset.skipLevelOfDetail = true;
  tileset.baseScreenSpaceError = 1024;
  tileset.skipScreenSpaceErrorFactor = 16;
  tileset.skipLevels = 1;
  tileset.immediatelyLoadDesiredLevelOfDetail = false;
  tileset.loadSiblings = false;
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

/** Warna kabut = warna abu-putih basemap Positron 3D (gaya maket netral ala trafik.live). */
const BUILDING_FOG_COLOR = new Cesium.Cartesian3(0.922, 0.929, 0.937);

/** Rentang ketinggian kamera untuk animasi naik-turun tinggi gedung 3D ala trafik.live. */
const BUILDING_ZOOM_FULL_M = 650;      // <= 650 m: gedung menengah/tinggi 100% normal
const BUILDING_ZOOM_FLAT_M = 3800;     // >= 3800 m: semua gedung turun rata & fade-out ke basemap
const SMALL_BLDG_ZOOM_FULL_M = 550;    // <= 550 m: perumahan/bangunan kecil (< 14 m) 100% normal
const SMALL_BLDG_ZOOM_FLAT_M = 1300;   // >= 1300 m: perumahan kecil sudah rata sebelum leaf tile di-cull

/** @type {Cesium.CustomShader|null} */
let buildingShader = null;

function hitungSkalaTinggiGedung(cameraHeightM) {
  if (!Number.isFinite(cameraHeightM)) return 1.0;
  const t = Math.max(
    0,
    Math.min(1, (BUILDING_ZOOM_FLAT_M - cameraHeightM) / (BUILDING_ZOOM_FLAT_M - BUILDING_ZOOM_FULL_M)),
  );
  // Kurva halus: di default 3D (~1350 m) sekitar 70%, membesar ke 100% saat zoom-in, turun halus saat zoom-out
  return Math.pow(t, 1.4);
}

function hitungSkalaBangunanKecil(cameraHeightM) {
  if (!Number.isFinite(cameraHeightM)) return 1.0;
  const t = Math.max(
    0,
    Math.min(1, (SMALL_BLDG_ZOOM_FLAT_M - cameraHeightM) / (SMALL_BLDG_ZOOM_FLAT_M - SMALL_BLDG_ZOOM_FULL_M)),
  );
  // Hermite smoothstep agar rumah kecil naik/turun mulus tanpa pop mendadak
  return t * t * (3 - 2 * t);
}

function buatShaderGedung() {
  return new Cesium.CustomShader({
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms: {
      u_groundHeight: { type: Cesium.UniformType.FLOAT, value: 0.0 },
      u_aoStrength: { type: Cesium.UniformType.FLOAT, value: 0.0 },
      u_heightScale: { type: Cesium.UniformType.FLOAT, value: 0.72 },
      u_smallScale: { type: Cesium.UniformType.FLOAT, value: 0.0 },
      u_fogNear: { type: Cesium.UniformType.FLOAT, value: 2400.0 },
      u_fogFar: { type: Cesium.UniformType.FLOAT, value: 9500.0 },
      u_fogColor: { type: Cesium.UniformType.VEC3, value: BUILDING_FOG_COLOR },
    },
    vertexShaderText: `
      void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
        if (u_heightScale >= 0.999 && u_smallScale >= 0.999) {
          return;
        }
        vec3 posWC = (czm_model * vec4(vsInput.attributes.positionMC, 1.0)).xyz;
        vec3 upWC = normalize(posWC);
        float a = 6378137.0;
        float b = 6356752.3142;
        float rp = length(posWC);
        float sinLat = posWC.z / rp;
        float cosLat = sqrt(max(0.0, 1.0 - sinLat * sinLat));
        float rEll = (a * b) / sqrt((b * cosLat) * (b * cosLat) + (a * sinLat) * (a * sinLat));
        float hAbove = rp - rEll;
        if (hAbove > 0.0) {
          // Bangunan kecil (< ~14 m) memakai u_smallScale agar turun halus sebelum tile-nya di-cull
          float smallWeight = 1.0 - smoothstep(9.0, 20.0, hAbove);
          float effectiveScale = mix(u_heightScale, min(u_heightScale, u_smallScale), smallWeight);
          float sinkTuck = 0.65 * (1.0 - smoothstep(0.0, 0.08, effectiveScale));
          float deltaH = hAbove * (effectiveScale - 1.0) - sinkTuck;
          vec3 upMC = normalize((czm_inverseModel * vec4(upWC, 0.0)).xyz);
          vsOutput.positionMC = vsInput.attributes.positionMC + upMC * deltaH;
        }
      }
    `,
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 posWC = fsInput.attributes.positionWC;

        // --- Bidang lokal East-North-Up di titik fragmen ---
        vec3 up = normalize(posWC);
        vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), up));
        vec3 north = cross(up, east);

        // Normal permukaan dalam koordinat dunia (ECEF)
        vec3 nWC = normalize(czm_inverseViewRotation * normalize(fsInput.attributes.normalEC));

        // --- 1. Pencahayaan arsitektural matte lembut (gaya maket trafik.live) ---
        vec3 lightDir = normalize(-0.52 * east + 0.48 * north + 0.71 * up);
        float lambert = clamp(dot(nWC, lightDir), 0.0, 1.0);
        float upness = dot(nWC, up);
        float roofness = smoothstep(0.55, 0.85, upness);

        vec3 roofColor = vec3(0.955, 0.960, 0.968);   // atap putih-abu lembut
        vec3 wallLit   = vec3(0.892, 0.902, 0.915);   // sisi terang abu bersih
        vec3 wallShade = vec3(0.752, 0.768, 0.790);   // sisi teduh abu netral lembut
        vec3 wall = mix(wallShade, wallLit, lambert);
        vec3 color = mix(wall, roofColor, roofness);

        // --- 2. Gradasi kaki gedung halus (ambient occlusion lembut di permukaan tanah) ---
        float a = 6378137.0;
        float b = 6356752.3142;
        float rp = length(posWC);
        float sinLat = posWC.z / rp;
        float cosLat = sqrt(max(0.0, 1.0 - sinLat * sinLat));
        float rEll = (a * b) / sqrt((b * cosLat) * (b * cosLat) + (a * sinLat) * (a * sinLat));
        float heightAboveGround = max(0.0, (rp - rEll) - u_groundHeight);
        float ao = smoothstep(0.0, 18.0, heightAboveGround);
        float aoFactor = mix(0.86, 1.0, ao);
        color *= mix(1.0, aoFactor, u_aoStrength * (1.0 - roofness));

        // --- 3. Kabut jarak + fade menyatu ke abu basemap saat zoom-out ---
        float dist = length(fsInput.attributes.positionEC);
        float fog = smoothstep(u_fogNear, u_fogFar, dist) * 0.58;
        float smallWeightFrag = 1.0 - smoothstep(9.0, 20.0, heightAboveGround);
        float effectiveScaleFrag = mix(u_heightScale, min(u_heightScale, u_smallScale), smallWeightFrag);
        float zoomFade = 1.0 - smoothstep(0.02, 0.35, effectiveScaleFrag);
        color = mix(color, u_fogColor, max(fog, zoomFade * 0.88));

        material.diffuse = color;
        material.alpha = 1.0;
      }
    `,
  });
}

/**
 * Tint per-gedung menurut ketinggian dengan palet abu-putih monokrom lembut
 * ala trafik.live supaya jalan, rute, dan ikon CCTV tetap menjadi fokus utama.
 */
function buatGayaTintKetinggian() {
  const h = 'Number(${feature["cesium#estimatedHeight"]})';
  return new Cesium.Cesium3DTileStyle({
    color: {
      conditions: [
        [`${h} >= 150`, 'color("#E4E8EE", 1.0)'],   // pencakar langit: abu-batu lembut
        [`${h} >= 80`, 'color("#ECEFF3", 1.0)'],    // tower tinggi
        [`${h} >= 40`, 'color("#F3F5F8", 1.0)'],    // gedung menengah
        [`${h} >= 15`, 'color("#F8F9FB", 1.0)'],    // ruko / gedung rendah
        ['true', 'color("#FCFDFF", 1.0)'],          // rumah tapak: putih bersih
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
 * Menurunkan tileset gedung OSM sepanjang normal permukaan lokal agar kaki gedung
 * menempel rapat di permukaan EllipsoidTerrainProvider (0 m) dan tidak "floating".
 * @param {Cesium.Cesium3DTileset} tileset
 * @param {number} lon
 * @param {number} lat
 * @param {number} heightOffsetM
 */
function terapkanOffsetTanahGedung(tileset, lon, lat, heightOffsetM) {
  if (!tileset || !Number.isFinite(heightOffsetM)) return;
  const surface = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  const elevated = Cesium.Cartesian3.fromDegrees(lon, lat, heightOffsetM);
  const translation = Cesium.Cartesian3.subtract(surface, elevated, new Cesium.Cartesian3());
  tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
  appliedGroundOffset = heightOffsetM;
}

/**
 * Memuat Cesium World Terrain hanya sebagai sampler elevasi (tidak dipasang ke globe
 * sehingga permukaan jalan tetap 100% datar, namun kita tahu elevasi asli gedung OSM).
 */
async function ensureWorldTerrainSampler() {
  if (worldTerrainSampler) return worldTerrainSampler;
  if (worldTerrainPromise) return worldTerrainPromise;
  const ionToken = getCesiumIonToken();
  if (!ionToken) return null;
  Cesium.Ion.defaultAccessToken = ionToken;
  worldTerrainPromise = Cesium.createWorldTerrainAsync()
    .then((tp) => {
      worldTerrainSampler = tp;
      return tp;
    })
    .catch((err) => {
      console.warn('[JakSafe Map] World Terrain sampler tidak tersedia, memakai offset default Jakarta:', err?.message || err);
      return null;
    });
  return worldTerrainPromise;
}

/** Mengambil koordinat pusat layar pada permukaan ellipsoid. */
function getViewportGroundCenter() {
  if (!viewerInstance) return { lon: CAMERA_PRESETS.jakarta.lon, lat: CAMERA_PRESETS.jakarta.lat };
  const canvas = viewerInstance.scene.canvas;
  const centerPixel = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const picked = viewerInstance.camera.pickEllipsoid(centerPixel, viewerInstance.scene.globe.ellipsoid);
  const carto = picked
    ? Cesium.Cartographic.fromCartesian(picked)
    : viewerInstance.camera.positionCartographic;
  if (!carto) return { lon: CAMERA_PRESETS.jakarta.lon, lat: CAMERA_PRESETS.jakarta.lat };
  return {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
  };
}

/**
 * Mengukur elevasi medan asli (World Terrain + geoid) di sekitar pusat layar
 * menggunakan median 5 titik agar tidak terpengaruh puncak SRTM gedung, lalu
 * menurunkan `osmBuildingsTileset` tepat ke permukaan ellipsoid (0 m).
 */
async function selaraskanElevasiGedungKeTanah({ force = false } = {}) {
  if (!viewerInstance || !osmBuildingsTileset || !osmBuildingsTileset.show || currentMode !== '3d') return;
  const center = getViewportGroundCenter();

  // Lewati sampling ulang bila kamera belum berpindah > ~350 m dari titik terakhir
  if (!force && lastSampledCenter) {
    const dLat = (center.lat - lastSampledCenter.lat) * 111320;
    const dLon = (center.lon - lastSampledCenter.lon) * 111320 * Math.cos((center.lat * Math.PI) / 180);
    if (Math.hypot(dLat, dLon) < 350) return;
  }

  const terrain = await ensureWorldTerrainSampler();
  if (!terrain || !viewerInstance || !osmBuildingsTileset) return;

  // 5 titik (pusat + 220m U/S/T/B) untuk mendapatkan median bidang tanah yang stabil
  const stepDeg = 0.002;
  const positions = [
    Cesium.Cartographic.fromDegrees(center.lon, center.lat),
    Cesium.Cartographic.fromDegrees(center.lon + stepDeg, center.lat),
    Cesium.Cartographic.fromDegrees(center.lon - stepDeg, center.lat),
    Cesium.Cartographic.fromDegrees(center.lon, center.lat + stepDeg),
    Cesium.Cartographic.fromDegrees(center.lon, center.lat - stepDeg),
  ];

  try {
    const sampled = await Cesium.sampleTerrainMostDetailed(terrain, positions);
    const heights = sampled
      .map((p) => p?.height)
      .filter((h) => Number.isFinite(h))
      .sort((a, b) => a - b);

    if (heights.length === 0) return;
    // Ambil persentil ke-40 (sedikit di bawah median agar terhindar dari bias SRTM atap gedung)
    const idx = Math.max(0, Math.floor(heights.length * 0.4));
    const groundHeight = heights[idx];
    const targetOffset = groundHeight + 1.5;

    lastSampledCenter = center;
    if (Math.abs(targetOffset - appliedGroundOffset) > 0.4) {
      terapkanOffsetTanahGedung(osmBuildingsTileset, center.lon, center.lat, targetOffset);
      if (buildingShader) {
        buildingShader.setUniform('u_groundHeight', 0.0);
        buildingShader.setUniform('u_aoStrength', 1.0);
      }
      viewerInstance.scene.requestRender();
    }
  } catch (err) {
    console.warn('[JakSafe Map] Gagal sampling elevasi gedung:', err?.message || err);
  }
}

/**
 * Menyelaraskan ketinggian dasar gedung OSM dengan permukaan ellipsoid datar.
 *
 * Cesium OSM Buildings menempatkan gedung pada elevasi Cesium World Terrain
 * (elevasi tanah + undulasi geoid WGS84, sekitar +35 s/d +48 m di Jakarta Pusat/Selatan),
 * sedangkan globe JakSafe memakai ellipsoid datar (0 m) agar jalan tidak bergelombang.
 * Fungsi ini menerapkan offset awal langsung lalu menyinkronkan secara presisi lewat
 * `sampleTerrainMostDetailed` setiap kali area pandang bergeser.
 */
function pasangAcuanTanahGedung(tileset) {
  if (!viewerInstance || !buildingShader) return;

  // Offset awal langsung untuk area pusat Jakarta (~39 m) agar mendekati footprint sejak frame 1
  const center = getViewportGroundCenter();
  terapkanOffsetTanahGedung(tileset, center.lon, center.lat, 39.0);
  buildingShader.setUniform('u_groundHeight', 0.0);
  buildingShader.setUniform('u_aoStrength', 1.0);

  // Segera kalibrasi presisi dengan World Terrain sampler
  void selaraskanElevasiGedungKeTanah({ force: true });

  // Kalibrasi ulang otomatis setiap kamera selesai bergeser ke wilayah baru
  viewerInstance.camera.moveEnd.addEventListener(() => {
    if (currentMode !== '3d' || !osmBuildingsTileset?.show) return;
    if (groundSampleTimer) clearTimeout(groundSampleTimer);
    groundSampleTimer = setTimeout(() => {
      groundSampleTimer = null;
      void selaraskanElevasiGedungKeTanah();
    }, 180);
  });
}

/**
 * Menyesuaikan jarak kabut dan skala ketinggian gedung 3D secara real-time mengikuti zoom kamera:
 * - Zoom out (>= 3800 m): tinggi gedung turun halus ke 0 dan menyatu/hilang ke basemap Positron.
 * - Zoom in  (<= 650 m) : tinggi gedung meninggi penuh hingga 100% ukuran aslinya.
 */
function perbaruiKabutGedung() {
  if (!viewerInstance || !buildingShader) return;
  const h = viewerInstance.camera.positionCartographic?.height;
  if (!Number.isFinite(h)) return;
  if (lastFogHeight >= 0 && Math.abs(h - lastFogHeight) < 2) return;
  lastFogHeight = h;

  const near = Math.max(1200, Math.min(30000, h * 1.6));
  buildingShader.setUniform('u_fogNear', near);
  buildingShader.setUniform('u_fogFar', near * 3.6);

  const heightScale = hitungSkalaTinggiGedung(h);
  const smallScale = hitungSkalaBangunanKecil(h);
  buildingShader.setUniform('u_heightScale', heightScale);
  buildingShader.setUniform('u_smallScale', smallScale);

  if (osmBuildingsTileset) {
    const shouldShow = buildingsEnabled && currentMode === '3d' && heightScale > 0.015;
    if (osmBuildingsTileset.show !== shouldShow) {
      osmBuildingsTileset.show = shouldShow;
    }
  }
}

/**
 * Nada basemap.
 * - Di mode 3D (`clean-3d`): CARTO Positron sudah berpalet abu-putih arsitektural yang
 *   serasi dengan gedung 3D Cesium sehingga warna footprint dan gedung menyatu mulus.
 * - Di mode 2D: basemap Google Maps tampil pada warna aslinya.
 */
function terapkanNadaBasemap() {
  if (!baseImageryLayer) return;
  const gayaMaket3D = currentMode === '3d';
  baseImageryLayer.brightness = gayaMaket3D ? 1.0 : 1.0;
  baseImageryLayer.contrast = gayaMaket3D ? 1.02 : 1.02;
  baseImageryLayer.saturation = gayaMaket3D ? 0.95 : 1.0;
  baseImageryLayer.gamma = gayaMaket3D ? 1.0 : 1.0;
  if (labelOverlayLayer && !labelOverlayLayer.isDestroyed?.()) {
    labelOverlayLayer.alpha = gayaMaket3D ? 0.92 : 0.0;
    labelOverlayLayer.contrast = 1.06;
  }
  viewerInstance?.scene.requestRender();
}

/**
 * Membuat ImageryProvider basemap:
 * - 'clean-3d': CARTO Positron No-Labels (@2x Retina) — footprint gedung abu-abu netral
 *               yang serasi dengan 3D buildings Cesium, jalan putih bersih, tanpa POI ramai.
 * - 'road'    : Peta jalan Google Maps (mode 2D Standard Map)
 * - 'sat'     : Citra satelit murni
 * - 'hybrid'  : Citra satelit + nama jalan Google Maps (mode 2D Satellite)
 * @param {'clean-3d'|'road'|'sat'|'hybrid'} style
 */
function create2DImageryProvider(style = 'road') {
  if (style === 'clean-3d') {
    const cartoKey = getCartoApiKey();
    if (cartoKey) {
      return new Cesium.UrlTemplateImageryProvider({
        url: `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png?key=${encodeURIComponent(cartoKey)}`,
        subdomains: ['a', 'b', 'c', 'd'],
        maximumLevel: 19,
        tileWidth: 256,
        tileHeight: 256,
        credit: new Cesium.Credit('© OpenStreetMap contributors © CARTO'),
      });
    }
  }

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

/**
 * Layer label terpisah (hanya nama jalan & daerah, tanpa POI ramai) dari CARTO Positron.
 * Diletakkan di atas layer Traffic agar nama jalan tetap tajam terbaca.
 */
function createClean3DLabelsProvider() {
  const cartoKey = getCartoApiKey();
  if (!cartoKey) return null;
  return new Cesium.UrlTemplateImageryProvider({
    url: `https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png?key=${encodeURIComponent(cartoKey)}`,
    subdomains: ['a', 'b', 'c', 'd'],
    maximumLevel: 19,
    tileWidth: 256,
    tileHeight: 256,
    hasAlphaChannel: true,
    enablePickFeatures: false,
    credit: new Cesium.Credit('© CARTO'),
  });
}

/** Mengganti basemap pada globe (melewati reload jika style aktif masih sama). */
async function applyGlobeImagery(style = 'road') {
  if (!viewerInstance) return;
  if (currentImageryStyle === style && baseImageryLayer) {
    terapkanNadaBasemap();
    return;
  }

  const layers = viewerInstance.imageryLayers;
  const provider = create2DImageryProvider(style);

  if (baseImageryLayer) {
    try { layers.remove(baseImageryLayer, true); } catch { /* ignore */ }
    baseImageryLayer = null;
  }

  if (labelOverlayLayer) {
    try { layers.remove(labelOverlayLayer, true); } catch { /* ignore */ }
    labelOverlayLayer = null;
  }

  baseImageryLayer = layers.addImageryProvider(provider, 0);
  currentImageryStyle = style;
  baseImageryLayer.brightness = 1.0;
  baseImageryLayer.contrast = 1.02;
  baseImageryLayer.saturation = 1.0;

  if (style === 'clean-3d') {
    const labelsProvider = createClean3DLabelsProvider();
    if (labelsProvider) {
      labelOverlayLayer = layers.addImageryProvider(labelsProvider);
      labelOverlayLayer.alpha = 0.9;
      labelOverlayLayer.contrast = 1.05;
    }
  }

  terapkanNadaBasemap();
}

/**
 * Memuat Cesium OSM 3D Buildings bila VITE_CESIUM_ION_TOKEN tersedia.
 * Permukaan tanah tetap memakai EllipsoidTerrainProvider (rata 100%) supaya
 * jalan raya di Jakarta tidak bergelombang, dan gedung diturunkan via modelMatrix
 * agar menempel rapat di permukaan basemap (tanpa outline hitam kasar).
 */
async function ensureCesiumIonBuildings() {
  if (!viewerInstance) return false;
  const ionToken = getCesiumIonToken();
  if (!ionToken) return false;

  Cesium.Ion.defaultAccessToken = ionToken;

  if (!osmBuildingsTileset) {
    try {
      const buildings = await Cesium.createOsmBuildingsAsync({
        enableShowOutline: false,
        showOutline: false,
      });
      if (!viewerInstance) return false;
      buildings.showOutline = false;
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
    const pitchDeg = currentHeight < 45000 ? LOCKED_3D_PITCH_DEG : -65;
    const latOffset = currentHeight < 45000 ? (currentHeight / 111320) * 0.65 : 0;
    camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat - latOffset, currentHeight),
      orientation: {
        heading: Cesium.Math.toRadians(LOCKED_3D_HEADING_DEG),
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
    // Kunci tilt & arah pandang (Utara selalu di atas, sudut isometrik -46° ala trafik.live)
    controller.enableTilt = false;
    controller.enableLook = false;

    // Saat user berpindah manual ke 3D, aktifkan gedung 3D secara otomatis
    if (fly && !buildingsEnabled) {
      buildingsEnabled = true;
    }

    // Gunakan basemap minimalis CARTO Voyager (tanpa POI ramai) + layer label terpisah
    await applyGlobeImagery('clean-3d');
    viewerInstance.scene.globe.show = true;

    const hasBuildings = await ensureCesiumIonBuildings();
    if (hasBuildings && osmBuildingsTileset) {
      lastFogHeight = -1;
      osmBuildingsTileset.show = buildingsEnabled;
      if (buildingsEnabled) {
        perbaruiKabutGedung();
        void selaraskanElevasiGedungKeTanah({ force: true });
      }
      statusMessage = '3D Jakarta Map';
    } else {
      statusMessage = 'Standard 3D Globe';
    }
  } else if (mode === '2d-sat') {
    // Mode 2D Satelit: Kunci kemiringan kamera (kamera murni tegak lurus dari atas / top-down)
    controller.enableTilt = false;
    controller.enableLook = false;

    if (osmBuildingsTileset) osmBuildingsTileset.show = false;
    viewerInstance.scene.globe.show = true;
    await applyGlobeImagery('hybrid');
    statusMessage = '2D Satellite';
  } else {
    // Mode 2D Peta Normal: Kunci kemiringan kamera (kamera murni tegak lurus dari atas / top-down)
    controller.enableTilt = false;
    controller.enableLook = false;

    if (osmBuildingsTileset) osmBuildingsTileset.show = false;
    viewerInstance.scene.globe.show = true;
    await applyGlobeImagery('road');
    statusMessage = '2D Standard Map';
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
  const finalPitch = is3D ? LOCKED_3D_PITCH_DEG : -89.9;
  const finalHeading = is3D ? LOCKED_3D_HEADING_DEG : 0;
  const latOffset = is3D && finalPitch > -75 ? (height / 111320) * 0.65 : 0;

  viewerInstance.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat - latOffset, height),
    orientation: {
      heading: Cesium.Math.toRadians(finalHeading),
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
  const lockedPitch = is3D
    ? Cesium.Math.toRadians(targetHeight < 45000 ? LOCKED_3D_PITCH_DEG : -65)
    : Cesium.Math.toRadians(-89.9);
  camera.flyTo({
    destination: targetDestination,
    orientation: {
      heading: Cesium.Math.toRadians(LOCKED_3D_HEADING_DEG),
      pitch: lockedPitch,
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
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    msaaSamples: 4,
    baseLayer: new Cesium.ImageryLayer(create2DImageryProvider('road')),
  });

  viewerInstance = viewer;
  baseImageryLayer = viewer.imageryLayers.get(0);
  currentImageryStyle = 'road';

  // Pastikan layer label jalan 3D (CARTO only_labels) selalu berada di atas layer Traffic
  viewer.imageryLayers.layerAdded.addEventListener((addedLayer) => {
    if (
      raisingLabelLayer
      || !labelOverlayLayer
      || labelOverlayLayer.isDestroyed?.()
      || addedLayer === labelOverlayLayer
    ) {
      return;
    }
    if (viewer.imageryLayers.contains(labelOverlayLayer)) {
      raisingLabelLayer = true;
      try {
        viewer.imageryLayers.raiseToTop(labelOverlayLayer);
      } finally {
        raisingLabelLayer = false;
      }
    }
  });

  // Optimasi Resolusi Layar (HiDPI / Retina) & Anti-Aliasing
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5);
  if (viewer.scene.postProcessStages?.fxaa) {
    viewer.scene.postProcessStages.fxaa.enabled = false;
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
  globe.maximumScreenSpaceError = 1.85;
  globe.tileCacheSize = 1000;
  globe.preloadAncestors = true;
  globe.preloadSiblings = false;
  globe.baseColor = Cesium.Color.fromCssColorString('#E8EEF5');

  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.00014;
  viewer.scene.highDynamicRange = false;

  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = 45;
  ctrl.maximumZoomDistance = 4500000;
  ctrl.inertiaSpin = 0.90;
  ctrl.inertiaTranslate = 0.92;
  ctrl.inertiaZoom = 0.85;

  // Hapus aksi LEFT_DOUBLE_CLICK bawaan Cesium yang menyebabkan kamera tilting ke cakrawala.
  // Gantikan dengan zoomMap(1) yang aman dan menjaga orientasi kamera 2D tetap tegak lurus.
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  viewer.screenSpaceEventHandler.setInputAction(() => {
    zoomMap(1);
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  // Penjaga konsistensi sudut kamera (2D tegak lurus -89.9°, 3D isometrik terkunci -46° Utara di atas).
  viewer.camera.moveEnd.addEventListener(() => {
    const pitchDeg = Cesium.Math.toDegrees(viewer.camera.pitch);
    const headingDeg = Cesium.Math.toDegrees(viewer.camera.heading);
    const normHeading = ((headingDeg + 180) % 360 + 360) % 360 - 180;

    if (currentMode !== '3d') {
      if (pitchDeg > -85 || Math.abs(normHeading) > 2) {
        viewer.camera.setView({
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-89.9),
            roll: 0,
          },
        });
      }
      return;
    }

    const h = viewer.camera.positionCartographic?.height || 1350;
    const targetPitch = h < 45000 ? LOCKED_3D_PITCH_DEG : -65;
    if (Math.abs(pitchDeg - targetPitch) > 4 || Math.abs(normHeading - LOCKED_3D_HEADING_DEG) > 2) {
      viewer.camera.setView({
        orientation: {
          heading: Cesium.Math.toRadians(LOCKED_3D_HEADING_DEG),
          pitch: Cesium.Math.toRadians(targetPitch),
          roll: 0,
        },
      });
    }
  });

  enforceIndonesiaBounds(viewer);

  const jkt = CAMERA_PRESETS.jakarta;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(jkt.lon, jkt.lat, jkt.height2d),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-89.9),
      roll: 0,
    },
  });

  await setMapViewMode('2d-road', { fly: false });

  return viewer;
}
