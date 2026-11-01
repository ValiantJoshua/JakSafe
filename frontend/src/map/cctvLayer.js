// Adapted from God's Eye View (MIT) — gods-eye-view/src/data/cctv.js
/*
   Lapisan kamera CCTV interaktif di atas peta CesiumJS JakSafe.

   Fitur:
   - Mengambil seluruh titik kamera Jakarta dari GET /api/cctv/sources.
   - Menampilkan penanda (billboard) kamera beserta kerucut arah pandang
     (viewshed frustum cone) berdasarkan headingDeg, fovDeg, dan rangeM.
   - Mendukung sakelar ON / OFF layer secara langsung (setCctvLayerEnabled).
   - Klik pada ikon kamera di peta membuka HUD pratinjau langsung
     (snapshot /api/cctv/frame/:id, tombol terbang ke sudut pandang kamera,
     dan tombol Analisis AI Vision Gemini /api/cctv/analyze/:id).
*/

import * as Cesium from 'cesium';
import { ambilSemuaKamera, urlBingkaiKamera, analisisKamera } from '../api/cctvApi.js';
import { getViewer, flyToCoordinates } from './cesiumViewer.js';
import { labelKondisiJalan, labelGenangan } from '../utils/format.js';

/** @type {Cesium.CustomDataSource|null} */
let cctvDataSource = null;
/** @type {Cesium.ScreenSpaceEventHandler|null} */
let clickHandler = null;
/** @type {import('../api/cctvApi.js').Kamera[]} */
let daftarKamera = [];
/** @type {boolean} */
let layerEnabled = true;
/** @type {string|null} */
let highlightedCameraId = null;
/** @type {string|null} */
let selectedCameraId = null;

/** @type {Set<(state:{enabled:boolean, count:number, selected:object|null})=>void>} */
const listeners = new Set();

const iconCache = new Map();

function notifyListeners() {
  const selected = daftarKamera.find((c) => c.id === selectedCameraId) || null;
  const state = {
    enabled: layerEnabled,
    count: daftarKamera.length,
    selected,
  };
  for (const fn of listeners) {
    try { fn(state); } catch { /* ignore */ }
  }
}

export function onCctvLayerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isCctvLayerEnabled() {
  return layerEnabled;
}

export function getCctvCount() {
  return daftarKamera.length;
}

export function getAllLoadedCameras() {
  return daftarKamera;
}

/**
 * Menggambar ikon penanda kamera di atas kanvas untuk dijadikan billboard Cesium.
 * @param {'normal'|'route'|'selected'} variant
 * @returns {string} data URL PNG
 */
function buatIkonBillboardKamera(variant = 'normal') {
  if (iconCache.has(variant)) return iconCache.get(variant);

  const size = 44;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  const bg = variant === 'selected'
    ? '#D9ED66'
    : variant === 'route'
      ? '#22C55E'
      : '#1E3A8A';
  const ring = variant === 'selected'
    ? '#16224A'
    : variant === 'route'
      ? '#DCFCE7'
      : '#38BDF8';
  const fg = variant === 'selected' ? '#16224A' : '#FFFFFF';

  // Lingkaran pendar luar
  ctx.beginPath();
  ctx.arc(cx, cy, 19, 0, Math.PI * 2);
  ctx.fillStyle = variant === 'selected'
    ? 'rgba(217, 237, 102, 0.35)'
    : variant === 'route'
      ? 'rgba(34, 197, 94, 0.32)'
      : 'rgba(56, 189, 248, 0.28)';
  ctx.fill();

  // Lingkaran inti
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = ring;
  ctx.stroke();

  // Siluet kamera di tengah
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(cx - 7, cy - 4.5, 10, 9, 2);
  ctx.fill();

  // Lensa corong kanan
  ctx.beginPath();
  ctx.moveTo(cx + 3, cy - 2.5);
  ctx.lineTo(cx + 7.5, cy - 4.5);
  ctx.lineTo(cx + 7.5, cy + 4.5);
  ctx.lineTo(cx + 3, cy + 2.5);
  ctx.closePath();
  ctx.fill();

  const url = canvas.toDataURL('image/png');
  iconCache.set(variant, url);
  return url;
}

/**
 * Menghitung titik-titik kerucut pandang (frustum viewshed) kamera di permukaan tanah.
 * Adapted from God's Eye View (MIT) — gods-eye-view/src/data/cctv.js
 */
function hitungKerucutPandang(lat, lon, headingDeg = 0, fovDeg = 55, rangeM = 135) {
  const halfFov = Math.max(15, Math.min(120, fovDeg)) / 2;
  const radiusM = Math.max(60, Math.min(350, rangeM));
  const steps = 10;
  const coords = [[lon, lat]];

  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLon = Math.max(1, 111320 * Math.cos(latRad));

  for (let i = 0; i <= steps; i += 1) {
    const angleDeg = (headingDeg - halfFov) + ((halfFov * 2) * (i / steps));
    const rad = (angleDeg * Math.PI) / 180;
    const dNorthM = Math.cos(rad) * radiusM;
    const dEastM = Math.sin(rad) * radiusM;
    const pLat = lat + (dNorthM / mPerDegLat);
    const pLon = lon + (dEastM / mPerDegLon);
    coords.push([pLon, pLat]);
  }
  coords.push([lon, lat]);
  return coords;
}

/**
 * Membangun ulang entitas Cesium untuk semua kamera di daftarKamera.
 */
function renderEntitasKamera() {
  if (!cctvDataSource) return;
  cctvDataSource.entities.removeAll();

  for (const cam of daftarKamera) {
    if (!Number.isFinite(cam.lat) || !Number.isFinite(cam.lon)) continue;

    const isSelected = cam.id === selectedCameraId;
    const isRouteCam = cam.id === highlightedCameraId;
    const variant = isSelected ? 'selected' : isRouteCam ? 'route' : 'normal';

    const heading = Number.isFinite(cam.headingDeg) ? cam.headingDeg : 0;
    const fov = Number.isFinite(cam.fovDeg) ? cam.fovDeg : 55;
    const rangeM = Number.isFinite(cam.rangeM) ? cam.rangeM : 140;

    // 1. Kerucut pandang (Viewshed Cone) di permukaan tanah
    const coneCoords = hitungKerucutPandang(cam.lat, cam.lon, heading, fov, rangeM);
    const flatDegrees = coneCoords.flatMap(([lon, lat]) => [lon, lat]);
    const coneColor = isSelected
      ? Cesium.Color.fromCssColorString('#D9ED66').withAlpha(0.32)
      : isRouteCam
        ? Cesium.Color.fromCssColorString('#22C55E').withAlpha(0.28)
        : Cesium.Color.fromCssColorString('#38BDF8').withAlpha(0.18);
    const coneOutline = isSelected
      ? Cesium.Color.fromCssColorString('#D9ED66').withAlpha(0.85)
      : isRouteCam
        ? Cesium.Color.fromCssColorString('#22C55E').withAlpha(0.8)
        : Cesium.Color.fromCssColorString('#38BDF8').withAlpha(0.55);

    cctvDataSource.entities.add({
      id: `cctv-cone-${cam.id}`,
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(flatDegrees),
        material: coneColor,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flatDegrees),
        width: isSelected || isRouteCam ? 2.4 : 1.5,
        material: coneOutline,
        clampToGround: true,
      },
    });

    // 2. Penanda Billboard & Label Kamera
    cctvDataSource.entities.add({
      id: `cctv-node-${cam.id}`,
      position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 18),
       properties: {
        isCctvMarker: true,
        cameraId: cam.id,
      },
      billboard: {
        image: buatIkonBillboardKamera(variant),
        width: isSelected ? 40 : isRouteCam ? 36 : 30,
        height: isSelected ? 40 : isRouteCam ? 36 : 30,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(800, 1.15, 35000, 0.55),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected || isRouteCam ? 65000 : 45000),
      },
      label: {
        text: cam.nama,
        font: '700 12px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0E1430'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected || isRouteCam ? 25000 : 1200),
      },
    });
  }

  const viewer = getViewer();
  viewer?.scene.requestRender();
}

/**
 * Menampilkan modal / kartu mengambang CCTV di atas panggung peta saat kamera diklik.
 * @param {import('../api/cctvApi.js').Kamera|null} cam
 */
export function bukaPopupKameraPeta(cam) {
  const popup = document.getElementById('mapCctvPopup');
  if (!popup) return;

  if (!cam) {
    selectedCameraId = null;
    popup.hidden = true;
    renderEntitasKamera();
    notifyListeners();
    return;
  }

  selectedCameraId = cam.id;
  renderEntitasKamera();
  notifyListeners();

  const imgEl = document.getElementById('mapCctvImg');
  const titleEl = document.getElementById('mapCctvTitle');
  const metaEl = document.getElementById('mapCctvMeta');
  const aiBoxEl = document.getElementById('mapCctvAiResult');
  const btnAnalyze = document.getElementById('btnMapCctvAnalyze');

  if (titleEl) titleEl.textContent = cam.nama;
  if (metaEl) {
    const arah = Number.isFinite(cam.headingDeg) ? `Arah ${cam.headingDeg}°` : 'Arah 360°';
    metaEl.textContent = `${cam.provider || 'CCTV Jakarta'} · ${arah} · ${cam.lat.toFixed(4)}, ${cam.lon.toFixed(4)}`;
  }
  if (imgEl) {
    imgEl.closest('.mapcctv__frame')?.removeAttribute('data-gagal');
    imgEl.src = urlBingkaiKamera(cam.id, Date.now());
  }
  if (aiBoxEl) {
    aiBoxEl.hidden = true;
    aiBoxEl.innerHTML = '';
  }
  if (btnAnalyze) {
    btnAnalyze.disabled = false;
    btnAnalyze.textContent = 'Analisis AI Vision (Gemini)';
  }

  popup.hidden = false;
}

/**
 * Memasang event klik pada kanvas Cesium untuk memilih kamera CCTV.
 */
function pasangEventKlikKamera(viewer) {
  if (clickHandler) {
    clickHandler.destroy();
    clickHandler = null;
  }

  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((movement) => {
    if (!layerEnabled) return;
    const picked = viewer.scene.pick(movement.position);
    if (!Cesium.defined(picked) || !picked.id) return;

    const entity = picked.id;
    const camId = entity?.properties?.cameraId?.getValue?.();
    if (!camId) return;

    const cam = daftarKamera.find((c) => c.id === camId);
    if (cam) {
      bukaPopupKameraPeta(cam);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/**
 * Memasang aksi tombol pada kartu mengambang CCTV (#mapCctvPopup).
 */
function pasangTombolPopupKamera() {
  document.getElementById('btnMapCctvClose')?.addEventListener('click', () => {
    bukaPopupKameraPeta(null);
  });

  document.getElementById('btnMapCctvRefresh')?.addEventListener('click', () => {
    if (!selectedCameraId) return;
    const imgEl = document.getElementById('mapCctvImg');
    if (imgEl) {
      imgEl.closest('.mapcctv__frame')?.removeAttribute('data-gagal');
      imgEl.src = urlBingkaiKamera(selectedCameraId, Date.now());
    }
  });

  document.getElementById('btnMapCctvFly')?.addEventListener('click', () => {
    const cam = daftarKamera.find((c) => c.id === selectedCameraId);
    if (!cam) return;
    flyToCoordinates({
      lon: cam.lon,
      lat: cam.lat,
      height: 320,
      headingDeg: Number.isFinite(cam.headingDeg) ? cam.headingDeg : 0,
      pitchDeg: Number.isFinite(cam.pitchDeg) ? cam.pitchDeg : -24,
      duration: 1.3,
    });
  });

  document.getElementById('btnMapCctvAnalyze')?.addEventListener('click', async () => {
    const cam = daftarKamera.find((c) => c.id === selectedCameraId);
    if (!cam) return;
    const btn = document.getElementById('btnMapCctvAnalyze');
    const aiBox = document.getElementById('mapCctvAiResult');
    if (!aiBox) return;

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menganalisis citra dengan Gemini...';
    }
    aiBox.hidden = false;
    aiBox.innerHTML = '<p class="mapcctv__loading">Mengunduh bingkai CCTV & menjalankan Gemini Vision...</p>';

    try {
      const res = await analisisKamera(cam.id);
      const a = res.analysis;
      if (!a) {
        aiBox.innerHTML = '<p class="mapcctv__err">Hasil analisis kosong.</p>';
      } else {
        const genanganTeks = a.genangan_air
          ? `⚠️ ${labelGenangan(a.tingkat_genangan)}`
          : '✅ Tidak tampak banjir/genangan';
        const jalanTeks = labelKondisiJalan(a.kondisi_jalan);
        const conf = Number.isFinite(a.confidence) ? `${Math.round(a.confidence * 100)}%` : '-';
        aiBox.innerHTML = `
          <div class="mapcctv__ai">
            <div class="mapcctv__airow"><span>Genangan:</span><strong>${genanganTeks}</strong></div>
            <div class="mapcctv__airow"><span>Arus Jalan:</span><strong>${jalanTeks}</strong></div>
            <div class="mapcctv__airow"><span>Keyakinan AI:</span><strong>${conf}</strong></div>
            ${a.alasan ? `<p class="mapcctv__aireason">"${a.alasan}"</p>` : ''}
          </div>
        `;
      }
    } catch (err) {
      aiBox.innerHTML = `<p class="mapcctv__err">Gagal menganalisis kamera: ${err?.message || 'Terjadi kesalahan'}</p>`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Analisis Ulang AI Vision';
      }
    }
  });
}

/**
 * Menyalakan atau mematikan layer CCTV di peta (ON / OFF).
 * @param {boolean} enabled
 */
export function setCctvLayerEnabled(enabled) {
  layerEnabled = Boolean(enabled);
  if (cctvDataSource) {
    cctvDataSource.show = layerEnabled;
  }
  if (!layerEnabled) {
    bukaPopupKameraPeta(null);
  }
  const viewer = getViewer();
  viewer?.scene.requestRender();
  notifyListeners();
}

export function toggleCctvLayer() {
  setCctvLayerEnabled(!layerEnabled);
  return layerEnabled;
}

/**
 * Menyorot kamera tertentu yang dipakai pada rute hasil navigasi.
 * @param {string|null} cameraId
 */
export function highlightRouteCamera(cameraId) {
  highlightedCameraId = cameraId || null;
  renderEntitasKamera();
}

/**
 * Menginisialisasi layer CCTV dan memuat katalog kamera dari backend.
 */
export async function initCctvLayer() {
  const viewer = getViewer();
  if (!viewer) return;

  if (!cctvDataSource) {
    cctvDataSource = new Cesium.CustomDataSource('jaksafe-cctv');
    cctvDataSource.show = layerEnabled;
    await viewer.dataSources.add(cctvDataSource);
    pasangEventKlikKamera(viewer);
    pasangTombolPopupKamera();
  }

  try {
    daftarKamera = await ambilSemuaKamera();
    renderEntitasKamera();
    notifyListeners();
  } catch (err) {
    console.warn('[JakSafe CCTV Layer] Gagal memuat daftar kamera:', err?.message || err);
  }
}
