/*
   Pengendali utama tombol peta, pemilih mode 3D / 2D Normal Map,
   sakelar panel samping (collapsible sidebar ala Google Maps),
   dan sakelar layer ON / OFF (Traffic, CCTV, Gedung 3D, Udara).
*/

import { subscribe, getState } from '../state/appState.js';
import { findPlaceById, registerCustomPlace } from '../config/jakartaPlaces.js';
import { toast } from '../ui/toast.js';
import {
  initCesiumViewer,
  setMapViewMode,
  getMapViewMode,
  toggleBuildingsLayer,
  isBuildingsLayerEnabled,
  flyToPreset,
  zoomMap,
  flyToCoordinates,
  onMapModeChange,
  getViewer,
} from './cesiumViewer.js';
import {
  initTrafficLayer,
  toggleTrafficLayer,
  isTrafficLayerEnabled,
  onTrafficLayerChange,
  setTrafficRouteFocusMode,
} from './trafficLayer.js';
import {
  initCctvLayer,
  toggleCctvLayer,
  isCctvLayerEnabled,
  onCctvLayerChange,
  highlightRouteCamera,
} from './cctvLayer.js';
import {
  initRouteLayer,
  renderRouteOnMap,
  previewEndpointsOnMap,
  flyToRouteBounds,
  showUserLocationOnMap,
} from './routeLayer.js';
import {
  initAqiLayer,
  toggleAqiLayer,
  isAqiLayerEnabled,
  onAqiLayerChange,
  updateRouteAqiOnMap,
} from './aqiLayer.js';

/** Memperbarui tampilan tombol pemilih mode 3D / 2D Peta / Satelit. */
function sinkronkanTombolMode(mode, buildingsEnabled) {
  const tombolMode = document.querySelectorAll('[data-map-mode]');
  tombolMode.forEach((btn) => {
    const aktif = btn.getAttribute('data-map-mode') === mode;
    btn.setAttribute('aria-pressed', String(aktif));
  });

  const btnBld = document.getElementById('btnLayerBuildings');
  const badgeBld = document.getElementById('badgeLayerBuildings');
  if (btnBld) {
    const aktif3D = Boolean(buildingsEnabled) && mode === '3d';
    btnBld.setAttribute('aria-pressed', String(aktif3D));
    if (badgeBld) badgeBld.textContent = aktif3D ? 'ON' : 'OFF';
  }
}

/** Memperbarui tampilan tombol sakelar layer ON / OFF. */
function sinkronkanTombolLayer() {
  const btnTraffic = document.getElementById('btnLayerTraffic');
  const badgeTraffic = document.getElementById('badgeLayerTraffic');
  if (btnTraffic) {
    const on = isTrafficLayerEnabled();
    btnTraffic.setAttribute('aria-pressed', String(on));
    if (badgeTraffic) badgeTraffic.textContent = on ? 'ON' : 'OFF';
  }

  const btnCctv = document.getElementById('btnLayerCctv');
  const badgeCctv = document.getElementById('badgeLayerCctv');
  if (btnCctv) {
    const on = isCctvLayerEnabled();
    btnCctv.setAttribute('aria-pressed', String(on));
    if (badgeCctv && !badgeCctv.dataset.countLoaded) {
      badgeCctv.textContent = on ? 'ON' : 'OFF';
    }
  }

  const btnBld = document.getElementById('btnLayerBuildings');
  const badgeBld = document.getElementById('badgeLayerBuildings');
  if (btnBld) {
    const on = isBuildingsLayerEnabled() && getMapViewMode() === '3d';
    btnBld.setAttribute('aria-pressed', String(on));
    if (badgeBld) badgeBld.textContent = on ? 'ON' : 'OFF';
  }

  const btnAqi = document.getElementById('btnLayerAqi');
  const badgeAqi = document.getElementById('badgeLayerAqi');
  if (btnAqi) {
    const on = isAqiLayerEnabled();
    btnAqi.setAttribute('aria-pressed', String(on));
    if (badgeAqi) badgeAqi.textContent = on ? 'ON' : 'OFF';
  }
}

/** Menutup atau membuka panel samping (Sidebar Toggle ala Google Maps). */
function toggleSidebar(forceOpen) {
  const ws = document.getElementById('workspace');
  if (!ws) return;
  const sedangTerbuka = ws.getAttribute('data-sidebar') !== 'collapsed';
  const buka = typeof forceOpen === 'boolean' ? forceOpen : !sedangTerbuka;
  ws.setAttribute('data-sidebar', buka ? 'open' : 'collapsed');

  setTimeout(() => {
    const v = getViewer();
    v?.resize();
    v?.scene.requestRender();
  }, 260);
}

/**
 * Meminta izin akses lokasi browser dan mengarahkan kamera peta ke titik koordinat pengguna saat ini.
 */
function arahkanKeLokasiPengguna() {
  if (!('geolocation' in navigator)) {
    toast('Browser Anda tidak mendukung deteksi lokasi (Geolocation).');
    return;
  }

  const btnLocate = document.getElementById('btnMapLocate');
  if (btnLocate) btnLocate.classList.add('is-loading');

  toast('Mendeteksi lokasi Anda saat ini...');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (btnLocate) btnLocate.classList.remove('is-loading');
      const { latitude, longitude } = pos.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        toast('Koordinat lokasi tidak valid.');
        return;
      }

      flyToCoordinates({
        lon: longitude,
        lat: latitude,
        height: 1200,
        pitchDeg: -40,
        duration: 1.4,
      });

      showUserLocationOnMap(longitude, latitude);

      registerCustomPlace({
        id: 'user-gps-location',
        nama: 'Lokasi Saya Saat Ini',
        area: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        lat: latitude,
        lon: longitude,
      });

      toast('Lokasi Anda berhasil ditemukan.');
    },
    (err) => {
      if (btnLocate) btnLocate.classList.remove('is-loading');
      let msg = 'Gagal mendeteksi lokasi saat ini.';
      if (err.code === 1) { // PERMISSION_DENIED
        msg = 'Izin lokasi ditolak. Harap izinkan akses lokasi pada peramban web Anda.';
      } else if (err.code === 2) { // POSITION_UNAVAILABLE
        msg = 'Sinyal lokasi GPS tidak tersedia.';
      } else if (err.code === 3) { // TIMEOUT
        msg = 'Waktu permintaan lokasi habis. Coba klik kembali.';
      }
      toast(msg);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    }
  );
}

/** Memasang seluruh event klik pada HUD peta & sidebar. */
function pasangEventHudPeta() {
  // 0. Tombol Lipat / Buka Sidebar (di Topbar & di Tepi Sidebar)
  document.getElementById('btnToggleSidebar')?.addEventListener('click', () => toggleSidebar());
  document.getElementById('btnSidebarTab')?.addEventListener('click', () => toggleSidebar());

  // 1. Pemilih Mode Peta: 3D <-> 2D Peta <-> Satelit
  document.querySelectorAll('[data-map-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetMode = btn.getAttribute('data-map-mode');
      if (targetMode) setMapViewMode(targetMode, { fly: true });
    });
  });

  // 2. Sakelar Layer ON / OFF (Traffic, CCTV, Gedung 3D, Udara)
  document.getElementById('btnLayerTraffic')?.addEventListener('click', () => {
    toggleTrafficLayer();
  });

  document.getElementById('btnLayerCctv')?.addEventListener('click', () => {
    toggleCctvLayer();
  });

  document.getElementById('btnLayerBuildings')?.addEventListener('click', async () => {
    if (getMapViewMode() !== '3d') {
      await setMapViewMode('3d', { fly: true });
    } else {
      toggleBuildingsLayer();
    }
  });

  document.getElementById('btnLayerAqi')?.addEventListener('click', () => {
    toggleAqiLayer();
  });

  // 3. Tombol Zoom In / Out / Menuju Lokasi Pengguna (Geolocation)
  document.getElementById('btnMapZoomIn')?.addEventListener('click', () => {
    zoomMap(1);
  });

  document.getElementById('btnMapZoomOut')?.addEventListener('click', () => {
    zoomMap(-1);
  });

  document.getElementById('btnMapLocate')?.addEventListener('click', () => {
    arahkanKeLokasiPengguna();
  });

  // 5. Langganan status perubahan mode dan layer
  onMapModeChange(({ mode, buildingsEnabled }) => {
    sinkronkanTombolMode(mode, buildingsEnabled);
  });

  onTrafficLayerChange(({ enabled, mode }) => {
    const btn = document.getElementById('btnLayerTraffic');
    const badge = document.getElementById('badgeLayerTraffic');
    if (btn) btn.setAttribute('aria-pressed', String(enabled));
    if (badge) {
      badge.textContent = !enabled ? 'OFF' : mode === 'live' ? 'LIVE' : 'ON';
    }
  });

  onCctvLayerChange(({ enabled, count }) => {
    const btn = document.getElementById('btnLayerCctv');
    const badge = document.getElementById('badgeLayerCctv');
    if (btn) btn.setAttribute('aria-pressed', String(enabled));
    if (badge) {
      badge.dataset.countLoaded = count > 0 ? '1' : '';
      badge.textContent = enabled ? (count > 0 ? `${count} ON` : 'ON') : 'OFF';
    }
  });

  onAqiLayerChange(({ enabled }) => {
    const btn = document.getElementById('btnLayerAqi');
    const badge = document.getElementById('badgeLayerAqi');
    if (btn) btn.setAttribute('aria-pressed', String(enabled));
    if (badge) badge.textContent = enabled ? 'ON' : 'OFF';
  });

  sinkronkanTombolMode(getMapViewMode(), isBuildingsLayerEnabled());
  sinkronkanTombolLayer();
}

/**
 * Menginisialisasi peta Cesium 3D/2D beserta seluruh layer (Traffic, CCTV, Route, AQI)
 * dan menghubungkannya dengan perubahan state aplikasi.
 */
export async function pasangPengendaliPeta() {
  pasangEventHudPeta();

  const viewer = await initCesiumViewer('mapCanvas');
  if (!viewer) return;

  await Promise.all([
    initRouteLayer(),
    initTrafficLayer(),
    initCctvLayer(),
    initAqiLayer(),
  ]);

  const awal = getState();
  if (!awal.hasil && (awal.idAsal || awal.idTujuan)) {
    previewEndpointsOnMap(findPlaceById(awal.idAsal), findPlaceById(awal.idTujuan), { fly: false });
  }

  subscribe((keadaan, berubah) => {
    if (berubah.includes('hasil')) {
      if (keadaan.hasil) {
        // Pastikan sidebar terbuka saat hasil rute selesai dihitung
        toggleSidebar(true);
        renderRouteOnMap(keadaan.hasil);
        const camId = keadaan.hasil.visual?.cameraId || keadaan.hasil.visual?.kamera?.id || null;
        highlightRouteCamera(camId, keadaan.hasil.route?.geometry || null);
        setTrafficRouteFocusMode(true);
        updateRouteAqiOnMap(keadaan.hasil);
      } else {
        highlightRouteCamera(null, null);
        setTrafficRouteFocusMode(false);
        previewEndpointsOnMap(findPlaceById(keadaan.idAsal), findPlaceById(keadaan.idTujuan), { fly: false });
      }
      return;
    }

    if ((berubah.includes('idAsal') || berubah.includes('idTujuan')) && !keadaan.hasil) {
      previewEndpointsOnMap(findPlaceById(keadaan.idAsal), findPlaceById(keadaan.idTujuan), { fly: true });
    }
  });
}
