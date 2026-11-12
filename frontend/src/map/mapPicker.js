/*
   Interaksi Klik Peta (Click-to-Pick Coordinate) — JakSafe.

   Fitur:
   - Klik Kanan atau Klik Kiri pada permukaan peta 3D / 2D untuk memilih titik koordinat.
   - Mendeteksi alamat jalan & wilayah presisi Indonesia secara otomatis (Reverse Geocoding).
   - Menu mengambang dengan tombol tindakan cepat:
     1. "📍 Titik Awal" -> Menjadikan lokasi terpilih sebagai titik awal perjalanan.
     2. "🏁 Tujuan"     -> Menjadikan lokasi terpilih sebagai tujuan perjalanan.
     3. "📋 Salin"      -> Menyalin koordinat [lat, lon] ke papan klip.
   - Menampilkan penanda pin visual mengambang (drop-pin) di atas titik peta yang dipilih.
   - Tetap menghormati klik pada kamera CCTV dan rute alternatif tanpa konflik event.
*/

import * as Cesium from 'cesium';
import { reverseGeocodeLive, registerCustomPlace, findPlaceById } from '../config/jakartaPlaces.js';
import { getState, setState } from '../state/appState.js';
import { toast } from '../ui/toast.js';
import { previewEndpointsOnMap } from './routeLayer.js';
import { bukaPopupKameraPeta, getAllLoadedCameras, isCctvLayerEnabled } from './cctvLayer.js';
import { pilihRuteByIndex } from '../ui/controllers/resultController.js';
import { toggleSidebar } from './mapControls.js';

/** @type {Cesium.Viewer|null} */
let viewerRef = null;
/** @type {Cesium.CustomDataSource|null} */
let pickerDataSource = null;
/** @type {Cesium.ScreenSpaceEventHandler|null} */
let pickerHandler = null;

let pinDataUrl = null;
let currentPlace = null;
let currentCoords = null;

/**
 * Membuat ikon billboard penanda titik peta terpilih (drop-pin locator).
 */
function buatPinTitikTerpilih() {
  if (pinDataUrl) return pinDataUrl;

  const size = 52;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  // 1. Halo pendaran luar
  ctx.beginPath();
  ctx.arc(cx, cy, 21, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(2, 132, 255, 0.28)';
  ctx.fill();

  // 2. Lingkaran putih penegas dengan bayangan
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(10, 46, 107, 0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // 3. Inti biru terang
  ctx.beginPath();
  ctx.arc(cx, cy, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = '#0284FF';
  ctx.fill();

  // 4. Titik pusat lime (JakSafe identity)
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#A3E635';
  ctx.fill();

  pinDataUrl = canvas.toDataURL('image/png');
  return pinDataUrl;
}

/**
 * Mengambil koordinat WGS84 [lat, lon] dari posisi piksel di layar kanvas Cesium.
 * Mendukung permukaan tanah rata, permukaan 3D Tiles (gedung), dan raycasting globe.
 * @param {Cesium.Viewer} viewer
 * @param {Cesium.Cartesian2} windowPosition
 * @returns {{lat: number, lon: number, cartesian: Cesium.Cartesian3}|null}
 */
export function pickCoordinatesFromPixel(viewer, windowPosition) {
  if (!viewer || !windowPosition) return null;
  const scene = viewer.scene;
  let cartesian = null;

  // 1. Presisi pada gedung 3D Tiles / permukaan arsitektural
  if (scene.pickPositionSupported) {
    try {
      cartesian = scene.pickPosition(windowPosition);
    } catch {
      cartesian = null;
    }
  }

  // 2. Ray picking pada globe dasar
  if (!cartesian || !Cesium.defined(cartesian)) {
    const ray = viewer.camera.getPickRay(windowPosition);
    if (ray) {
      cartesian = scene.globe.pick(ray, scene);
    }
  }

  // 3. Fallback ke ellipsoid
  if (!cartesian || !Cesium.defined(cartesian)) {
    cartesian = viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid);
  }

  if (!cartesian || !Cesium.defined(cartesian)) return null;

  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  if (!cartographic) return null;

  const lon = Cesium.Math.toDegrees(cartographic.longitude);
  const lat = Cesium.Math.toDegrees(cartographic.latitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }

  return { lat, lon, cartesian };
}

/**
 * Menghilangkan penanda pin sementara dari peta.
 */
export function hapusPinSementara() {
  if (!pickerDataSource) return;
  const entity = pickerDataSource.entities.getById('map-picked-temp-pin');
  if (entity) {
    pickerDataSource.entities.remove(entity);
  }
  viewerRef?.scene.requestRender();
}

/**
 * Menutup menu mengambang titik peta terpilih.
 */
export function tutupMapPickMenu() {
  const menu = document.getElementById('mapPickMenu');
  if (menu) menu.hidden = true;
  hapusPinSementara();
}

/**
 * Menampilkan pin sementara di posisi koordinat yang diklik.
 */
function renderPinSementara(lon, lat) {
  if (!pickerDataSource) return;
  hapusPinSementara();

  pickerDataSource.entities.add({
    id: 'map-picked-temp-pin',
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 26),
    billboard: {
      image: buatPinTitikTerpilih(),
      width: 40,
      height: 40,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: 'Titik Terpilih',
      font: '800 11px Manrope, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#0A2E6B'),
      outlineWidth: 3.5,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  viewerRef?.scene.requestRender();
}

/**
 * Menangani pemilihan titik pada peta (baik klik kiri maupun klik kanan).
 * @param {Cesium.Cartesian2} screenPos
 */
async function handleMapClick(screenPos) {
  if (!viewerRef) return;

  const result = pickCoordinatesFromPixel(viewerRef, screenPos);
  if (!result) return;

  const { lat, lon } = result;
  currentCoords = { lat, lon };

  // Tutup popup CCTV lain yang mungkin sedang terbuka
  bukaPopupKameraPeta(null);

  // Pasang pin visual di peta
  renderPinSementara(lon, lat);

  const menu = document.getElementById('mapPickMenu');
  const titleEl = document.getElementById('mapPickTitle');
  const metaEl = document.getElementById('mapPickMeta');

  if (!menu) return;

  // Posisikan menu pada layar dengan batasan agar tidak terpotong tepi layar
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const menuWidth = 310;
  const menuHeight = 175;

  let x = screenPos.x + 14;
  let y = screenPos.y - 40;

  // Jika terlalu ke kanan, buka ke kiri kursor
  if (x + menuWidth > viewportWidth - 16) {
    x = Math.max(16, screenPos.x - menuWidth - 14);
  }
  // Jika terlalu ke bawah, buka ke atas kursor
  if (y + menuHeight > viewportHeight - 80) {
    y = Math.max(76, viewportHeight - menuHeight - 80);
  }
  if (y < 76) y = 76;

  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
  menu.hidden = false;

  // Indikator memuat alamat
  if (titleEl) titleEl.textContent = 'Mendeteksi alamat presisi...';
  if (metaEl) metaEl.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  // Buat objek tempat sementara berbasis koordinat
  currentPlace = {
    id: `map-${lat.toFixed(4)}-${lon.toFixed(4)}`,
    nama: `Titik Peta [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
    headline: `Titik Peta [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
    area: 'Koordinat Peta',
    subtitle: 'Koordinat Peta',
    lat,
    lon,
  };

  // Panggil Reverse Geocoding ke backend secara asinkron
  try {
    const resolved = await reverseGeocodeLive(lat, lon);
    if (resolved && currentCoords && currentCoords.lat === lat && currentCoords.lon === lon) {
      currentPlace = resolved;
      registerCustomPlace(resolved);

      const headline = resolved.headline || resolved.nama || `Titik [${lat.toFixed(4)}, ${lon.toFixed(4)}]`;
      const subtitle = resolved.subtitle || resolved.area || 'Jakarta & Sekitarnya';

      if (titleEl) titleEl.textContent = headline;
      if (metaEl) metaEl.textContent = `${subtitle} · [${lat.toFixed(4)}, ${lon.toFixed(4)}]`;
    }
  } catch (err) {
    console.warn('[mapPicker] Reverse geocode error:', err);
  }
}

/**
 * Menjadikan titik terpilih sebagai Titik Awal.
 */
function tetapkanSebagaiTitikAwal() {
  if (!currentPlace) return;

  registerCustomPlace(currentPlace);
  const inpOrigin = document.getElementById('inpOrigin');
  if (inpOrigin) {
    inpOrigin.value = currentPlace.headline || currentPlace.nama;
  }

  const state = getState();
  setState({
    idAsal: currentPlace.id,
    asal: currentPlace,
    hasil: null,
    tampilan: 'siap',
  });

  // Buka sidebar navigasi jika sedang tertutup
  toggleSidebar(true);

  // Perbarui preview pin pada peta
  const destPlace = findPlaceById(state.idTujuan);
  previewEndpointsOnMap(currentPlace, destPlace, { fly: false });

  toast(`📍 Titik awal diatur ke: ${currentPlace.headline || currentPlace.nama}`);
  tutupMapPickMenu();
}

/**
 * Menjadikan titik terpilih sebagai Titik Tujuan.
 */
function tetapkanSebagaiTujuan() {
  if (!currentPlace) return;

  registerCustomPlace(currentPlace);
  const inpDest = document.getElementById('inpDest');
  if (inpDest) {
    inpDest.value = currentPlace.headline || currentPlace.nama;
  }

  const state = getState();
  setState({
    idTujuan: currentPlace.id,
    tujuan: currentPlace,
    hasil: null,
    tampilan: 'siap',
  });

  // Buka sidebar navigasi jika sedang tertutup
  toggleSidebar(true);

  // Perbarui preview pin pada peta
  const originPlace = findPlaceById(state.idAsal);
  previewEndpointsOnMap(originPlace, currentPlace, { fly: false });

  toast(`🏁 Tujuan diatur ke: ${currentPlace.headline || currentPlace.nama}`);
  tutupMapPickMenu();
}

/**
 * Menyalin koordinat titik terpilih ke clipboard.
 */
function salinKoordinat() {
  if (!currentCoords) return;
  const text = `${currentCoords.lat.toFixed(5)}, ${currentCoords.lon.toFixed(5)}`;
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
    toast(`📋 Koordinat disalin: ${text}`);
  } else {
    toast(`Koordinat: ${text}`);
  }
  tutupMapPickMenu();
}

/**
 * Menginisialisasi modul Click-to-Pick Coordinate pada kanvas Cesium.
 * @param {Cesium.Viewer} viewer
 */
export async function initMapPicker(viewer) {
  if (!viewer) return;
  viewerRef = viewer;

  if (!pickerDataSource) {
    pickerDataSource = new Cesium.CustomDataSource('jaksafe-map-picker');
    await viewer.dataSources.add(pickerDataSource);
  }

  // Nonaktifkan menu konteks klik kanan bawaan browser pada kanvas Cesium
  viewer.scene.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  if (pickerHandler) {
    pickerHandler.destroy();
    pickerHandler = null;
  }

  pickerHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  // 1. Tangani Klik Kiri (Left Click)
  pickerHandler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);

    // Jika pengguna mengklik entitas interaktif (Kamera CCTV atau Rute):
    if (Cesium.defined(picked) && picked.id) {
      const entity = picked.id;

      // a. Klik pada CCTV Marker
      const camId = entity?.properties?.cameraId?.getValue?.();
      if (camId) {
        tutupMapPickMenu();
        const allCameras = getAllLoadedCameras();
        const cam = allCameras.find((c) => c.id === camId);
        if (cam) bukaPopupKameraPeta(cam);
        return;
      }

      // b. Klik pada Polyline Rute Alternatif
      const routeIdx = entity?.properties?.routeOptionIndex?.getValue?.();
      if (Number.isInteger(routeIdx)) {
        tutupMapPickMenu();
        pilihRuteByIndex(routeIdx);
        return;
      }

      // c. Klik pada Pin Sementara sendiri
      if (entity.id === 'map-picked-temp-pin') {
        return;
      }
    }

    // Klik pada area kosong peta (tanah, jalan, atau gedung)
    handleMapClick(movement.position);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 2. Tangani Klik Kanan (Right Click) — Langsung memicu menu konteks
  pickerHandler.setInputAction((movement) => {
    handleMapClick(movement.position);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // Pasang aksi tombol menu konteks
  document.getElementById('btnPickAsOrigin')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tetapkanSebagaiTitikAwal();
  });

  document.getElementById('btnPickAsDest')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tetapkanSebagaiTujuan();
  });

  document.getElementById('btnPickCopy')?.addEventListener('click', (e) => {
    e.stopPropagation();
    salinKoordinat();
  });

  document.getElementById('btnMapPickClose')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tutupMapPickMenu();
  });

  // Tutup menu jika pengguna menekan Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      tutupMapPickMenu();
    }
  });

  // Tutup menu jika klik di luar area menu
  document.addEventListener('pointerdown', (e) => {
    const menu = document.getElementById('mapPickMenu');
    if (!menu || menu.hidden) return;
    if (!menu.contains(e.target) && !viewer.scene.canvas.contains(e.target)) {
      tutupMapPickMenu();
    }
  });
}

