/*
   Pengendali utama tombol peta, pemilih mode 3D / 2D Normal Map,
   sakelar panel samping (collapsible sidebar ala Google Maps),
   dan sakelar layer ON / OFF (Traffic, CCTV, Gedung 3D, Udara).
*/

import { subscribe, getState } from '../state/appState.js';
import { findPlaceById, registerCustomPlace } from '../config/jakartaPlaces.js';
import { toast } from '../ui/toast.js';
import { animateSpring, project, rubberband } from '../utils/spring.js';
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
import { initMapPicker } from './mapPicker.js';

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

let sheetSpring = null;
let sheetOffsetY = 0;
let sheetVelY = 0;

function isMobileSheetViewport() {
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches;
}

function getMobileSheetDetents(panelEl) {
  const h = Math.max(260, panelEl?.offsetHeight || Math.round(window.innerHeight * 0.78));
  const peekOffset = Math.max(140, h - 82);
  const halfOffset = Math.round(h * 0.34);
  return {
    height: h,
    expanded: 0,
    half: halfOffset,
    peek: peekOffset,
  };
}

function snapSheetKeDetent(namaDetent, initialVelocity = 0) {
  const ws = document.getElementById('workspace');
  const panel = document.getElementById('sidePanel');
  if (!ws || !panel || !isMobileSheetViewport()) return;

  if (sheetSpring) {
    const prev = sheetSpring.stop();
    sheetOffsetY = prev.value;
    if (!initialVelocity) initialVelocity = prev.velocity;
    sheetSpring = null;
  }

  const detents = getMobileSheetDetents(panel);
  const targetOffset =
    namaDetent === 'expanded'
      ? detents.expanded
      : namaDetent === 'peek'
        ? detents.peek
        : detents.half;

  ws.setAttribute('data-sheet', namaDetent);
  ws.setAttribute('data-sidebar', namaDetent === 'peek' ? 'collapsed' : 'open');

  sheetSpring = animateSpring({
    from: sheetOffsetY,
    to: targetOffset,
    velocity: initialVelocity,
    damping: 0.82,
    response: 0.32,
    precision: 0.5,
    onUpdate(y, v) {
      sheetOffsetY = y;
      sheetVelY = v;
      panel.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    },
    onComplete() {
      sheetSpring = null;
      sheetOffsetY = targetOffset;
      sheetVelY = 0;
      panel.style.transform = `translate3d(0, ${targetOffset}px, 0)`;
      const v = getViewer();
      v?.resize();
      v?.scene.requestRender();
    },
  });
}

function pasangGestureSheetMobile() {
  const grabber = document.getElementById('sheetGrabber');
  const panel = document.getElementById('sidePanel');
  const ws = document.getElementById('workspace');
  if (!grabber || !panel || !ws) return;

  let dragging = false;
  let startPointerY = 0;
  let startOffsetY = 0;
  let moved = false;
  /** @type {Array<{ y: number, t: number }>} */
  let samples = [];

  const sinkronUkuranLayar = () => {
    if (!isMobileSheetViewport()) {
      if (sheetSpring) {
        sheetSpring.stop();
        sheetSpring = null;
      }
      sheetOffsetY = 0;
      panel.style.transform = '';
      return;
    }
    const detent = ws.getAttribute('data-sheet') || 'half';
    const d = getMobileSheetDetents(panel);
    sheetOffsetY = detent === 'expanded' ? d.expanded : detent === 'peek' ? d.peek : d.half;
    panel.style.transform = `translate3d(0, ${sheetOffsetY}px, 0)`;
  };

  window.addEventListener('resize', sinkronUkuranLayar, { passive: true });
  requestAnimationFrame(sinkronUkuranLayar);

  grabber.addEventListener('pointerdown', (e) => {
    if (!isMobileSheetViewport()) return;
    if (sheetSpring) {
      const prev = sheetSpring.stop();
      sheetOffsetY = prev.value;
      sheetVelY = prev.velocity;
      sheetSpring = null;
    }

    dragging = true;
    moved = false;
    startPointerY = e.clientY;
    startOffsetY = sheetOffsetY;
    samples = [{ y: e.clientY, t: performance.now() }];
    grabber.setPointerCapture?.(e.pointerId);
  });

  grabber.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startPointerY;
    if (!moved && Math.abs(dy) < 6) return;
    moved = true;

    const detents = getMobileSheetDetents(panel);
    const rawOffset = startOffsetY + dy;

    let clampedOffset = rawOffset;
    if (rawOffset < detents.expanded) {
      clampedOffset = detents.expanded + rubberband(rawOffset - detents.expanded, detents.height, 0.55);
    } else if (rawOffset > detents.peek) {
      clampedOffset = detents.peek + rubberband(rawOffset - detents.peek, detents.height, 0.55);
    }

    sheetOffsetY = clampedOffset;
    panel.style.transform = `translate3d(0, ${clampedOffset.toFixed(2)}px, 0)`;

    const now = performance.now();
    samples.push({ y: e.clientY, t: now });
    while (samples.length > 5 && now - samples[0].t > 100) {
      samples.shift();
    }
  });

  const akhiriDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      grabber.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }

    if (!moved) {
      // Tap singkat pada grabber: siklus half -> expanded -> peek -> half
      const cur = ws.getAttribute('data-sheet') || 'half';
      const next = cur === 'half' ? 'expanded' : cur === 'expanded' ? 'peek' : 'half';
      snapSheetKeDetent(next, 0);
      return;
    }

    let releaseVel = 0;
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt > 0.004) {
        releaseVel = (last.y - first.y) / dt;
      }
    }

    const detents = getMobileSheetDetents(panel);
    const projected = sheetOffsetY + project(releaseVel, 0.99);
    const candidates = [
      { name: 'expanded', y: detents.expanded },
      { name: 'half', y: detents.half },
      { name: 'peek', y: detents.peek },
    ];
    candidates.sort((a, b) => Math.abs(a.y - projected) - Math.abs(b.y - projected));
    snapSheetKeDetent(candidates[0].name, releaseVel);
  };

  grabber.addEventListener('pointerup', akhiriDrag);
  grabber.addEventListener('pointercancel', akhiriDrag);
  grabber.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const cur = ws.getAttribute('data-sheet') || 'half';
      const next = cur === 'half' ? 'expanded' : cur === 'expanded' ? 'peek' : 'half';
      snapSheetKeDetent(next, 0);
    }
  });
}

/** Menutup atau membuka panel samping (Sidebar Toggle ala Google Maps & Fluid Mobile Sheet). */
export function toggleSidebar(forceOpen) {
  const ws = document.getElementById('workspace');
  if (!ws) return;
  const sedangTerbuka = ws.getAttribute('data-sidebar') !== 'collapsed';
  const buka = typeof forceOpen === 'boolean' ? forceOpen : !sedangTerbuka;

  if (isMobileSheetViewport()) {
    snapSheetKeDetent(buka ? 'half' : 'peek', 0);
    return;
  }

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
        height: 2400,
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
  // 0. Tombol Lipat / Buka Sidebar (di Topbar, Tepi Sidebar, & Gesture Sheet Mobile)
  document.getElementById('btnToggleSidebar')?.addEventListener('click', () => toggleSidebar());
  document.getElementById('btnSidebarTab')?.addEventListener('click', () => toggleSidebar());
  pasangGestureSheetMobile();

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
    initMapPicker(viewer),
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
