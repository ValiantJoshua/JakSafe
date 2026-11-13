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
import Hls from 'hls.js';
import { ambilSemuaKamera, urlBingkaiKamera, urlStreamKamera, analisisKamera } from '../api/cctvApi.js';
import { getViewer, flyToCoordinates } from './cesiumViewer.js';
import { labelKondisiJalan, labelGenangan } from '../utils/format.js';
import { ikon } from '../ui/icons.js';

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
/** @type {number[][]|null} Geometri rute aktif [[lon, lat], ...] untuk filter koridor */
let activeRouteGeometry = null;
/** @type {string|null} */
let selectedCameraId = null;

/** @type {Hls|null} */
let activeHls = null;
/** @type {number|null} */
let activeSnapTimer = null;
/** @type {boolean} */
let autoRefreshEnabled = true;
/** @type {'video'|'snapshot'} */
let currentViewMode = 'video';

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

  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  const bg = variant === 'selected'
    ? '#A3E635'
    : variant === 'route'
      ? '#0284FF'
      : '#0A2E6B';
  const ring = variant === 'selected'
    ? '#0A2E6B'
    : '#FFFFFF';
  const fg = variant === 'selected' ? '#0A2E6B' : '#FFFFFF';

  // Lingkaran inti solid dengan bayangan netral halus (tanpa outer neon glow)
  ctx.beginPath();
  ctx.arc(cx, cy, 13.5, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.shadowColor = 'rgba(10, 46, 107, 0.24)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.lineWidth = 2.2;
  ctx.strokeStyle = ring;
  ctx.stroke();

  // Siluet kamera di tengah
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(cx - 6.5, cy - 4, 9, 8, 1.8);
  ctx.fill();

  // Lensa corong kanan
  ctx.beginPath();
  ctx.moveTo(cx + 2.5, cy - 2.2);
  ctx.lineTo(cx + 6.8, cy - 4);
  ctx.lineTo(cx + 6.8, cy + 4);
  ctx.lineTo(cx + 2.5, cy + 2.2);
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
 * Menghitung jarak terdekat (dalam meter) dari titik (lon, lat) ke garis rute [[lon, lat], ...].
 * @param {number} lon
 * @param {number} lat
 * @param {number[][]} routeGeom
 * @returns {number}
 */
function jarakKameraKeRuteM(lon, lat, routeGeom) {
  if (!Array.isArray(routeGeom) || routeGeom.length < 2) return Infinity;
  const mPerDegLat = 110540;
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);

  let minDistSq = Infinity;

  for (let i = 0; i < routeGeom.length - 1; i += 1) {
    const [lon1, lat1] = routeGeom[i];
    const [lon2, lat2] = routeGeom[i + 1];

    const px = (lon - lon1) * mPerDegLon;
    const py = (lat - lat1) * mPerDegLat;
    const vx = (lon2 - lon1) * mPerDegLon;
    const vy = (lat2 - lat1) * mPerDegLat;

    const segLenSq = vx * vx + vy * vy;
    let t = 0;
    if (segLenSq > 0.0001) {
      t = Math.max(0, Math.min(1, (px * vx + py * vy) / segLenSq));
    }

    const dx = px - t * vx;
    const dy = py - t * vy;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
    }
  }
  return Math.sqrt(minDistSq);
}

/**
 * Membangun ulang entitas Cesium untuk semua kamera di daftarKamera.
 * Mendukung Smart Corridor Focus: saat rute aktif digambar, kamera di sepanjang koridor rute
 * tampil penuh (100% + kerucut pandang), sedangkan kamera yang jauh di luar rute
 * diredupkan drastis (opacity 20%, ukuran diperkecil, tanpa kerucut pandang).
 */
function renderEntitasKamera() {
  if (!cctvDataSource) return;
  cctvDataSource.entities.removeAll();

  const hasActiveRoute = Array.isArray(activeRouteGeometry) && activeRouteGeometry.length >= 2;
  const CORRIDOR_RADIUS_M = 380;

  for (const cam of daftarKamera) {
    if (!Number.isFinite(cam.lat) || !Number.isFinite(cam.lon)) continue;

    const isSelected = cam.id === selectedCameraId;
    const isRouteCam = cam.id === highlightedCameraId;
    const isNearRoute = hasActiveRoute
      ? (isSelected || isRouteCam || jarakKameraKeRuteM(cam.lon, cam.lat, activeRouteGeometry) <= CORRIDOR_RADIUS_M)
      : true;
    const isDimmedOutside = hasActiveRoute && !isNearRoute;

    const variant = isSelected ? 'selected' : isRouteCam ? 'route' : 'normal';

    const heading = Number.isFinite(cam.headingDeg) ? cam.headingDeg : 0;
    const fov = Number.isFinite(cam.fovDeg) ? cam.fovDeg : 55;
    const rangeM = Number.isFinite(cam.rangeM) ? cam.rangeM : 140;

    // 1. Kerucut pandang (Viewshed Cone) di permukaan tanah.
    //    Warna disatukan ke rentang biru/slate tenang agar tidak bertabrakan dengan warna
    //    semantik kemacetan lalu lintas (hijau/kuning/merah), serta hanya ditampilkan pada
    //    kamera terpilih, kamera rute, atau saat pengguna melakukan zoom dekat.
    if (!isDimmedOutside) {
      const coneCoords = hitungKerucutPandang(cam.lat, cam.lon, heading, fov, rangeM);
      const flatDegrees = coneCoords.flatMap(([lon, lat]) => [lon, lat]);
      const coneColor = isSelected
        ? Cesium.Color.fromCssColorString('#0284FF').withAlpha(0.22)
        : isRouteCam
          ? Cesium.Color.fromCssColorString('#0284FF').withAlpha(0.16)
          : Cesium.Color.fromCssColorString('#0A2E6B').withAlpha(0.08);
      const coneOutline = isSelected
        ? Cesium.Color.fromCssColorString('#0284FF').withAlpha(0.75)
        : isRouteCam
          ? Cesium.Color.fromCssColorString('#0284FF').withAlpha(0.55)
          : Cesium.Color.fromCssColorString('#0A2E6B').withAlpha(0.28);
      const coneMaxDist = isSelected || isRouteCam ? 25000 : 4500;

      cctvDataSource.entities.add({
        id: `cctv-cone-${cam.id}`,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(flatDegrees),
          material: coneColor,
          classificationType: Cesium.ClassificationType.TERRAIN,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, coneMaxDist),
        },
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flatDegrees),
          width: isSelected || isRouteCam ? 2.0 : 1.2,
          material: coneOutline,
          classificationType: Cesium.ClassificationType.TERRAIN,
          clampToGround: true,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, coneMaxDist),
        },
      });
    }

    // 2. Penanda Billboard & Label Kamera
    const markerSize = isSelected ? 34 : isRouteCam ? 30 : isDimmedOutside ? 16 : 24;
    const entityDef = {
      id: `cctv-node-${cam.id}`,
      position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 0),
      properties: {
        isCctvMarker: true,
        cameraId: cam.id,
      },
      billboard: {
        image: buatIkonBillboardKamera(variant),
        width: markerSize,
        height: markerSize,
        color: isDimmedOutside ? Cesium.Color.WHITE.withAlpha(0.20) : Cesium.Color.WHITE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(800, 1.15, 35000, 0.55),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected || isRouteCam ? 65000 : 45000),
      },
    };

    if (!isDimmedOutside) {
      entityDef.label = {
        text: cam.nama,
        font: '700 12px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0E1430'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected || isRouteCam ? 25000 : 1200),
      };
    }

    cctvDataSource.entities.add(entityDef);
  }

  const viewer = getViewer();
  viewer?.scene.requestRender();
}

/**
 * Menghentikan pemutaran stream HLS aktif dan interval auto-refresh snapshot.
 */
function hentikanStreamKamera() {
  if (activeHls) {
    try {
      activeHls.stopLoad();
      activeHls.destroy();
    } catch { /* ignore */ }
    activeHls = null;
  }
  if (activeSnapTimer) {
    clearInterval(activeSnapTimer);
    activeSnapTimer = null;
  }

  const videoEl = /** @type {HTMLVideoElement|null} */ (document.getElementById('mapCctvVideo'));
  if (videoEl) {
    try {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
    } catch { /* ignore */ }
  }

  const frameEl = document.getElementById('mapCctvFrame');
  frameEl?.removeAttribute('data-gagal');
  setLoadingSpinner(false);
}

/**
 * Mengatur visibilitas dan teks indikator loading/buffer video.
 * @param {boolean} visible
 * @param {string} [teks]
 */
function setLoadingSpinner(visible, teks = 'Menghubungkan ke live stream...') {
  const spinWrap = document.getElementById('mapCctvSpinner');
  const spinTxt = document.getElementById('mapCctvSpinnerText');
  if (spinWrap) spinWrap.hidden = !visible;
  if (spinTxt && teks) spinTxt.textContent = teks;
}

/**
 * Mengalihkan mode tampilan kamera antara 'video' (Live HLS) dan 'snapshot' (Foto realtime).
 * @param {import('../api/cctvApi.js').Kamera} cam
 * @param {'video'|'snapshot'} mode
 */
function tampilkanModeKamera(cam, mode) {
  hentikanStreamKamera();
  currentViewMode = mode;

  const tabVid = document.getElementById('tabMapCctvVideo');
  const tabSnap = document.getElementById('tabMapCctvSnapshot');
  const videoEl = /** @type {HTMLVideoElement|null} */ (document.getElementById('mapCctvVideo'));
  const imgEl = /** @type {HTMLImageElement|null} */ (document.getElementById('mapCctvImg'));
  const liveBadge = document.getElementById('mapCctvLiveBadge');
  const liveLabel = document.getElementById('mapCctvLiveLabel');
  const qualityEl = document.getElementById('mapCctvQuality');
  const frameEl = document.getElementById('mapCctvFrame');
  const fallbackMsg = document.getElementById('mapCctvFallbackMsg');

  // Perbarui status tombol tab
  if (tabVid) tabVid.setAttribute('data-active', mode === 'video' ? '1' : '0');
  if (tabSnap) tabSnap.setAttribute('data-active', mode === 'snapshot' ? '1' : '0');

  // Update badge label
  if (mode === 'video') {
    if (liveBadge) liveBadge.style.display = 'inline-flex';
    if (liveLabel) liveLabel.textContent = 'LIVE STREAM';
    if (qualityEl) qualityEl.textContent = cam.hasLiveStream ? 'HLS 640p' : 'HLS N/A';
  } else {
    if (liveBadge) liveBadge.style.display = 'inline-flex';
    if (liveLabel) liveLabel.textContent = 'FOTO REALTIME';
    if (qualityEl) qualityEl.textContent = 'FOTO 720p';
  }

  if (mode === 'video') {
    // Mode Live HLS Video
    if (imgEl) imgEl.hidden = true;
    if (videoEl) {
      videoEl.hidden = false;
      videoEl.muted = true;
    }

    if (!cam.hasLiveStream) {
      // Kamera tidak memiliki stream HLS langsung, alihkan ke snapshot
      tampilkanModeKamera(cam, 'snapshot');
      return;
    }

    setLoadingSpinner(true, 'Menghubungkan ke live stream...');

    const streamUrl = urlStreamKamera(cam.id);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 15,
        liveSyncDurationCount: 3,
      });
      activeHls = hls;

      hls.loadSource(streamUrl);
      if (videoEl) hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoadingSpinner(false);
        videoEl?.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.warn('[JakSafe HLS] Fatal stream error, switching to snapshot:', data.type, data.details);
          hentikanStreamKamera();
          tampilkanModeKamera(cam, 'snapshot');
          if (fallbackMsg) fallbackMsg.textContent = 'Live video offline, beralih ke Snapshot';
        }
      });

      if (videoEl) {
        videoEl.onplaying = () => setLoadingSpinner(false);
        videoEl.onwaiting = () => setLoadingSpinner(true, 'Memuat segmen video...');
        videoEl.onerror = () => {
          hentikanStreamKamera();
          tampilkanModeKamera(cam, 'snapshot');
        };
      }
    } else if (videoEl && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Dukungan native HLS (Safari macOS / iOS)
      videoEl.src = streamUrl;
      videoEl.onloadedmetadata = () => {
        setLoadingSpinner(false);
        videoEl.play().catch(() => {});
      };
      videoEl.onerror = () => {
        tampilkanModeKamera(cam, 'snapshot');
      };
    } else {
      tampilkanModeKamera(cam, 'snapshot');
    }
  } else {
    // Mode Snapshot (Foto)
    if (videoEl) videoEl.hidden = true;
    if (imgEl) {
      imgEl.hidden = false;
      frameEl?.removeAttribute('data-gagal');
      imgEl.src = urlBingkaiKamera(cam.id, Date.now());
    }
    setLoadingSpinner(false);

    // Pasang interval auto-refresh jika diaktifkan pengguna
    if (autoRefreshEnabled) {
      activeSnapTimer = window.setInterval(() => {
        if (!selectedCameraId || currentViewMode !== 'snapshot') return;
        const currentImg = /** @type {HTMLImageElement|null} */ (document.getElementById('mapCctvImg'));
        if (currentImg && !currentImg.hidden) {
          currentImg.src = urlBingkaiKamera(selectedCameraId, Date.now());
        }
      }, 3000);
    }
  }
}

/**
 * Menampilkan modal / kartu mengambang CCTV di atas panggung peta saat kamera diklik.
 * @param {import('../api/cctvApi.js').Kamera|null} cam
 */
export function bukaPopupKameraPeta(cam) {
  const popup = document.getElementById('mapCctvPopup');
  if (!popup) return;

  if (!cam) {
    hentikanStreamKamera();
    selectedCameraId = null;
    popup.hidden = true;
    renderEntitasKamera();
    notifyListeners();
    return;
  }

  selectedCameraId = cam.id;
  renderEntitasKamera();
  notifyListeners();

  const titleEl = document.getElementById('mapCctvTitle');
  const metaEl = document.getElementById('mapCctvMeta');
  const aiBoxEl = document.getElementById('mapCctvAiResult');
  const btnAnalyze = document.getElementById('btnMapCctvAnalyze');
  const tabVid = document.getElementById('tabMapCctvVideo');

  if (titleEl) titleEl.textContent = cam.nama;
  if (metaEl) {
    const arah = Number.isFinite(cam.headingDeg) ? `Arah ${cam.headingDeg}°` : 'Arah 360°';
    metaEl.textContent = `${cam.provider || 'CCTV Jakarta'} · ${arah} · ${cam.lat.toFixed(4)}, ${cam.lon.toFixed(4)}`;
  }
  if (aiBoxEl) {
    aiBoxEl.hidden = true;
    aiBoxEl.innerHTML = '';
  }
  if (btnAnalyze) {
    btnAnalyze.disabled = false;
    btnAnalyze.innerHTML = `${ikon('i-spark', 13)} Analisis AI`;
  }

  if (tabVid) {
    tabVid.style.opacity = cam.hasLiveStream ? '1' : '0.45';
    tabVid.title = cam.hasLiveStream ? 'Tonton siaran langsung live video' : 'Kamera ini hanya menyediakan foto berkala';
  }

  popup.hidden = false;

  // Jalankan mode sesuai kapabilitas kamera
  const targetMode = cam.hasLiveStream ? 'video' : 'snapshot';
  tampilkanModeKamera(cam, targetMode);
}

/**
 * Mencari kamera CCTV yang berada di sekitar posisi kursor (screen space)
 * dengan toleransi radius toleran (default 28px) atau hasil hardware picking langsung.
 * Menghindari keharusan pengguna mengklik persis di 1 piksel ikon CCTV.
 * @param {Cesium.Viewer} viewer
 * @param {Cesium.Cartesian2} screenPos
 * @param {number} [radiusPx]
 * @returns {import('../api/cctvApi.js').Kamera|null}
 */
export function findNearbyCctvCamera(viewer, screenPos, radiusPx = 28) {
  if (!viewer || !screenPos || !layerEnabled) return null;
  if (!Array.isArray(daftarKamera) || daftarKamera.length === 0) return null;

  // 1. Cek hardware pick langsung terlebih dahulu
  try {
    const picked = viewer.scene.pick(screenPos);
    if (Cesium.defined(picked) && picked.id) {
      const camId = picked.id?.properties?.cameraId?.getValue?.();
      if (camId) {
        const cam = daftarKamera.find((c) => c.id === camId);
        if (cam) return cam;
      }
    }
  } catch {
    /* abaikan galat pick */
  }

  // 2. Fuzzy hit-testing: Cari kamera dengan jarak layar terdekat dalam radiusPx
  try {
    const scene = viewer.scene;
    const canvas = scene.canvas;
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    let closestCam = null;
    let minDistanceSq = radiusPx * radiusPx;

    const transformFn = Cesium.SceneTransforms.worldToWindowCoordinates
      || Cesium.SceneTransforms.wgs84ToWindowCoordinates;

    if (typeof transformFn !== 'function') return null;

    const scratchWinPos = new Cesium.Cartesian2();

    for (let i = 0; i < daftarKamera.length; i++) {
      const cam = daftarKamera[i];
      if (!Number.isFinite(cam.lat) || !Number.isFinite(cam.lon)) continue;

      if (!cam._cartesian) {
        cam._cartesian = Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 0);
      }

      const winPos = transformFn(scene, cam._cartesian, scratchWinPos);
      if (!winPos) continue;

      // Filter jika posisi kamera berada jauh di luar viewport layar
      if (
        winPos.x < -radiusPx ||
        winPos.x > canvasWidth + radiusPx ||
        winPos.y < -radiusPx ||
        winPos.y > canvasHeight + radiusPx
      ) {
        continue;
      }

      const dx = winPos.x - screenPos.x;
      const dy = winPos.y - screenPos.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= minDistanceSq) {
        minDistanceSq = distSq;
        closestCam = cam;
      }
    }

    return closestCam;
  } catch (err) {
    console.warn('[findNearbyCctvCamera] Error:', err);
    return null;
  }
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
    const cam = findNearbyCctvCamera(viewer, movement.position, 28);
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

  // Tab Live Video
  document.getElementById('tabMapCctvVideo')?.addEventListener('click', () => {
    const cam = daftarKamera.find((c) => c.id === selectedCameraId);
    if (!cam) return;
    tampilkanModeKamera(cam, 'video');
  });

  // Tab Snapshot
  document.getElementById('tabMapCctvSnapshot')?.addEventListener('click', () => {
    const cam = daftarKamera.find((c) => c.id === selectedCameraId);
    if (!cam) return;
    tampilkanModeKamera(cam, 'snapshot');
  });

  // Toggle Auto-Refresh
  document.getElementById('btnMapCctvAutoRefresh')?.addEventListener('click', () => {
    autoRefreshEnabled = !autoRefreshEnabled;
    const lbl = document.getElementById('lblMapCctvAutoRefresh');
    if (lbl) {
      lbl.textContent = autoRefreshEnabled ? 'ON' : 'OFF';
      lbl.style.color = autoRefreshEnabled ? '' : 'var(--text-3)';
    }
    const cam = daftarKamera.find((c) => c.id === selectedCameraId);
    if (cam && currentViewMode === 'snapshot') {
      tampilkanModeKamera(cam, 'snapshot');
    }
  });

  // Layar Penuh (Fullscreen)
  document.getElementById('btnMapCctvFullscreen')?.addEventListener('click', () => {
    const frame = document.getElementById('mapCctvFrame');
    if (!frame) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      frame.requestFullscreen?.().catch(() => {});
    }
  });

  // Muat Ulang (Refresh)
  document.getElementById('btnMapCctvRefresh')?.addEventListener('click', () => {
    const cam = daftarKamera.find((c) => c.id === selectedCameraId);
    if (!cam) return;
    tampilkanModeKamera(cam, currentViewMode);
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
        btn.innerHTML = `${ikon('i-spark', 13)} Analisis Ulang AI`;
      }
    }
  });
}


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
 * Menyorot kamera tertentu yang dipakai pada rute hasil navigasi
 * serta mengaktifkan Mode Fokus Koridor Rute (meredupkan kamera di luar koridor).
 * @param {string|null} cameraId
 * @param {number[][]|null} [routeGeometry]
 */
export function highlightRouteCamera(cameraId, routeGeometry = null) {
  highlightedCameraId = cameraId || null;
  activeRouteGeometry = Array.isArray(routeGeometry) && routeGeometry.length >= 2 ? routeGeometry : null;
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
    // Precompute Cartesian3 untuk optimasi hit-testing dan rendering instan
    for (let i = 0; i < daftarKamera.length; i++) {
      const c = daftarKamera[i];
      if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
        c._cartesian = Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 0);
      }
    }
    renderEntitasKamera();
    notifyListeners();
  } catch (err) {
    console.warn('[JakSafe CCTV Layer] Gagal memuat daftar kamera:', err?.message || err);
  }
}
