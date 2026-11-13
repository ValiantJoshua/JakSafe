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
import { bukaPopupKameraPeta, getAllLoadedCameras, isCctvLayerEnabled, findNearbyCctvCamera } from './cctvLayer.js';
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
 * Menggunakan bentuk teardrop map-pin solid Deep Navy (#0A2E6B) dengan ring putih tegas
 * dan inti lime green (#A3E635), seragam secara geometris dengan pin titik awal & tujuan.
 */
function buatPinTitikTerpilih() {
  if (pinDataUrl) return pinDataUrl;

  const width = 44;
  const height = 54;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const cx = width / 2;
  const headCy = 18;
  const headR = 13.5;
  const tipY = 48;

  // 1. Bayangan kontak tanah di bawah ujung jarum pin (kontak halus tanpa pendaran)
  ctx.beginPath();
  ctx.ellipse(cx, tipY + 1.5, 6.5, 2.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
  ctx.fill();

  // 2. Badan pin tetes (teardrop pin) meruncing ke bawah tepat di (cx, tipY)
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.bezierCurveTo(cx - headR, tipY - 14, cx - headR, headCy, cx - headR, headCy);
  ctx.arc(cx, headCy, headR, Math.PI, 0, false);
  ctx.bezierCurveTo(cx + headR, headCy, cx + headR, tipY - 14, cx, tipY);
  ctx.closePath();

  // Warna solid Deep Navy khas JakSafe (#0A2E6B) - flat & tegas
  ctx.fillStyle = '#0A2E6B';
  ctx.fill();

  // Garis tepi putih tegas penegas kontras
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();

  // 3. Lingkaran putih di kepala pin
  ctx.beginPath();
  ctx.arc(cx, headCy, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // 4. Inti lime green (#A3E635) penegas posisi
  ctx.beginPath();
  ctx.arc(cx, headCy, 3.8, 0, Math.PI * 2);
  ctx.fillStyle = '#A3E635';
  ctx.fill();

  pinDataUrl = canvas.toDataURL('image/png');
  return pinDataUrl;
}

/**
 * Mengambil koordinat WGS84 [lat, lon] dari posisi piksel di layar kanvas Cesium.
 * Mendahulukan raycasting globe & ellipsoid bumi agar koordinat tanah/jalan akurat,
 * kemudian fallback ke pickPosition jika mengklik objek 3D.
 * @param {Cesium.Viewer} viewer
 * @param {Cesium.Cartesian2} windowPosition
 * @returns {{lat: number, lon: number, cartesian: Cesium.Cartesian3}|null}
 */
export function pickCoordinatesFromPixel(viewer, windowPosition) {
  if (!viewer || !windowPosition) return null;
  const scene = viewer.scene;
  let cartesian = null;

  // 1. Ray picking pada ellipsoid bumi (paling akurat & konsisten untuk basemap 2D & 3D)
  try {
    cartesian = viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid);
  } catch {
    cartesian = null;
  }

  // 2. Jika di atas gedung 3D Tiles dan pickPosition didukung
  if ((!cartesian || !Cesium.defined(cartesian)) && scene.pickPositionSupported) {
    try {
      cartesian = scene.pickPosition(windowPosition);
    } catch {
      cartesian = null;
    }
  }

  // 3. Fallback ray picking globe terrain
  if (!cartesian || !Cesium.defined(cartesian)) {
    try {
      const ray = viewer.camera.getPickRay(windowPosition);
      if (ray) {
        cartesian = scene.globe.pick(ray, scene);
      }
    } catch {
      cartesian = null;
    }
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
 * Terkunci di tanah (CLAMP_TO_GROUND) dengan ujung jarum menancap di permukaan (BOTTOM).
 * Bersih tanpa label teks melayang di atas pin.
 */
function renderPinSementara(lon, lat) {
  if (!pickerDataSource) return;
  hapusPinSementara();

  pickerDataSource.entities.add({
    id: 'map-picked-temp-pin',
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    billboard: {
      image: buatPinTitikTerpilih(),
      width: 36,
      height: 44,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  viewerRef?.scene.requestRender();
}

/**
 * Memposisikan menu mengambang pada layar dengan batas aman yang ketat terhadap wadah .mapstage.
 * Menjamin menu 100% masuk ke dalam frame layar tanpa terpotong di tepi mana pun.
 * @param {Cesium.Cartesian2} screenPos
 */
export function posisikanMenuPick(screenPos) {
  const menu = document.getElementById('mapPickMenu');
  if (!menu || !screenPos) return;

  const stage = document.querySelector('.mapstage');
  const stageWidth = stage ? stage.clientWidth : window.innerWidth;
  const stageHeight = stage ? stage.clientHeight : window.innerHeight;

  // Ukur dimensi kartu (fall back ke 320x170 jika belum ter-render)
  const menuW = menu.offsetWidth || 320;
  const menuH = menu.offsetHeight || 170;

  const pad = 16;
  const topPad = 74;    // jarak aman dari bar mode 3D/2D di kiri atas & tombol zoom di kanan atas
  const bottomPad = 86; // jarak aman dari bar dock layer di bawah

  // 1. Sumbu X: coba tampil di kanan kursor (+16px)
  let x = screenPos.x + 16;
  // Jika menabrak tepi kanan frame peta, posisikan di sebelah kiri kursor
  if (x + menuW > stageWidth - pad) {
    x = screenPos.x - menuW - 16;
  }
  // Kunci (clamp) X agar absolut aman di dalam frame layar
  x = Math.max(pad, Math.min(x, stageWidth - menuW - pad));

  // 2. Sumbu Y: coba tampil sejajar atau sedikit di atas kursor (-24px)
  let y = screenPos.y - 24;
  // Jika menabrak tepi bawah frame peta, posisikan di atas kursor
  if (y + menuH > stageHeight - bottomPad) {
    y = screenPos.y - menuH - 16;
  }
  // Kunci (clamp) Y agar absolut aman di dalam frame layar
  y = Math.max(topPad, Math.min(y, stageHeight - menuH - bottomPad));

  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
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

  // Pasang pin visual di peta (tanpa label teks di atas pin)
  renderPinSementara(lon, lat);

  const menu = document.getElementById('mapPickMenu');
  const titleEl = document.getElementById('mapPickTitle');
  const areaEl = document.getElementById('mapPickArea');
  const coordsEl = document.getElementById('mapPickCoords');

  if (!menu) return;

  // Tampilkan menu dan hitung posisinya agar presisi di dalam viewport layar
  menu.hidden = false;
  posisikanMenuPick(screenPos);

  // Indikator memuat alamat
  if (titleEl) titleEl.textContent = 'Mendeteksi alamat...';
  if (areaEl) areaEl.textContent = 'Mengidentifikasi area wilayah...';
  if (coordsEl) coordsEl.textContent = `[${lat.toFixed(4)}, ${lon.toFixed(4)}]`;

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
      if (areaEl) areaEl.textContent = subtitle;
      if (coordsEl) coordsEl.textContent = `[${lat.toFixed(4)}, ${lon.toFixed(4)}]`;

      // Perbarui posisi kartu jika tinggi kartu berubah karena teks alamat
      posisikanMenuPick(screenPos);
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
    try {
      // a. Cek apakah pengguna mengklik kamera CCTV atau area sekitarnya (radius toleran 28px)
      const nearbyCam = findNearbyCctvCamera(viewer, movement.position, 28);
      if (nearbyCam) {
        tutupMapPickMenu();
        bukaPopupKameraPeta(nearbyCam);
        return;
      }

      const picked = viewer.scene.pick(movement.position);

      // Jika pengguna mengklik entitas interaktif (Kamera CCTV langsung, Rute, atau Pin):
      if (Cesium.defined(picked) && picked.id) {
        const entity = picked.id;

        // Klik pada CCTV Marker (jika lolos dari proximity)
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
    } catch (err) {
      console.warn('[mapPicker] Left click check error:', err);
    }

    // Klik pada area peta (tanah, jalan, atau gedung)
    handleMapClick(movement.position);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 2. Tangani Klik Kanan (Right Click) — Langsung memicu menu konteks
  pickerHandler.setInputAction((movement) => {
    try {
      const nearbyCam = findNearbyCctvCamera(viewer, movement.position, 28);
      if (nearbyCam) {
        tutupMapPickMenu();
        bukaPopupKameraPeta(nearbyCam);
        return;
      }
    } catch (err) {
      console.warn('[mapPicker] Right click check error:', err);
    }
    handleMapClick(movement.position);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // 3. Tangani Dobel Klik (Double Click) — Tutup menu pick agar tidak menghalangi zoom
  pickerHandler.setInputAction(() => {
    tutupMapPickMenu();
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  // 4. Tangani Gerakan Kursor (Mouse Move) — Indikator kursor 'pointer' interaktif
  pickerHandler.setInputAction((movement) => {
    if (!movement.endPosition) return;

    try {
      // Hover di atas / dekat kamera CCTV
      const hoveredCam = findNearbyCctvCamera(viewer, movement.endPosition, 24);
      if (hoveredCam) {
        viewer.scene.canvas.style.cursor = 'pointer';
        return;
      }

      // Hover di atas polyline rute
      const picked = viewer.scene.pick(movement.endPosition);
      if (Cesium.defined(picked) && picked.id) {
        const routeIdx = picked.id?.properties?.routeOptionIndex?.getValue?.();
        if (Number.isInteger(routeIdx)) {
          viewer.scene.canvas.style.cursor = 'pointer';
          return;
        }
      }
    } catch {
      /* abaikan galat hover */
    }

    viewer.scene.canvas.style.cursor = '';
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  // Perbarui posisi popup agar selalu menempel dengan titik pin di peta saat kamera digeser/di-zoom
  viewer.scene.postRender.addEventListener(() => {
    const menu = document.getElementById('mapPickMenu');
    if (!menu || menu.hidden || !currentCoords) return;

    const pinCartesian = Cesium.Cartesian3.fromDegrees(currentCoords.lon, currentCoords.lat, 0);
    const transformFn = Cesium.SceneTransforms.worldToWindowCoordinates
      || Cesium.SceneTransforms.wgs84ToWindowCoordinates;

    if (typeof transformFn !== 'function') return;

    try {
      const winPos = transformFn(viewer.scene, pinCartesian);
      if (winPos) {
        const stage = document.querySelector('.mapstage');
        const stageWidth = stage ? stage.clientWidth : window.innerWidth;
        const stageHeight = stage ? stage.clientHeight : window.innerHeight;

        // Jika pin digeser sangat jauh ke luar layar (> 200px), tutup menu
        if (
          winPos.x < -200 ||
          winPos.x > stageWidth + 200 ||
          winPos.y < -200 ||
          winPos.y > stageHeight + 200
        ) {
          tutupMapPickMenu();
        } else {
          posisikanMenuPick(winPos);
        }
      }
    } catch {
      /* abaikan galat render */
    }
  });

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

