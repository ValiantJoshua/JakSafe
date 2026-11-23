/*
   Always-On Compact Weather Pill & Popover (Apple Maps Style) untuk Peta JakSafe.
   - Menggunakan endpoint hybrid /api/weather (BMKG utama untuk Jabodetabek + Open-Meteo fallback).
   - Smart Viewport Sync: hanya fetch ulang bila pusat layar bergeser > 2.5 km (debounce 650 ms).
   - Adaptive Zoom Label:
     * Zoom out (> 6.5 km) : menampilkan nama Kota (mis. "Jakarta Pusat", "Kota Bekasi")
     * Zoom in  (<= 6.5 km): menampilkan nama Kecamatan/Kelurahan (mis. "Menteng", "Bekasi Selatan")
*/

import * as Cesium from 'cesium';
import { ambilCuaca } from '../api/weatherApi.js';
import { getViewer } from './cesiumViewer.js';
import { escapeHtml } from '../utils/dom.js';

const ZOOM_DISTRICT_THRESHOLD_M = 6500;
const MIN_REFETCH_DISTANCE_M = 2500;
const DEBOUNCE_MS = 650;

let initialized = false;
let lastFetchedPoint = null;
let lastWeather = null;
let debounceTimer = null;
let activeController = null;
let popoverOpen = false;

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function weatherSvg(iconType = 'cloudy', size = 15) {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  switch (iconType) {
    case 'clear':
      return `<svg ${common}><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2.5 12h2M19.5 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;
    case 'partly-cloudy':
      return `<svg ${common}><path d="M12 3v1.5M5.6 5.6l1.1 1.1M3 12h1.5M17.3 6.7l1.1-1.1"/><path d="M9.5 12a3.5 3.5 0 0 1 6.4-1.8"/><path d="M7.5 19h9a3.5 3.5 0 0 0 .4-6.98A4.8 4.8 0 0 0 7.5 13.5 2.75 2.75 0 0 0 7.5 19Z"/></svg>`;
    case 'rain':
      return `<svg ${common}><path d="M6.5 15h10.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.8 9.2 3 3 0 0 0 6.5 15Z"/><path d="M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5"/></svg>`;
    case 'heavy-rain':
      return `<svg ${common}><path d="M6.5 14.5h10.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.8 8.7 3 3 0 0 0 6.5 14.5Z"/><path d="M8.5 17.5l-1.2 3.2M12.5 17.5l-1.2 3.2M16.5 17.5l-1.2 3.2"/></svg>`;
    case 'storm':
      return `<svg ${common}><path d="M6.5 14.5h10.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.8 8.7 3 3 0 0 0 6.5 14.5Z"/><path d="M13 14.5l-2 4h3l-1.5 3.5"/></svg>`;
    case 'fog':
      return `<svg ${common}><path d="M4 10h16M3 14h18M6 18h12"/></svg>`;
    default:
      return `<svg ${common}><path d="M6.5 18h10.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.8 12.2 3 3 0 0 0 6.5 18Z"/></svg>`;
  }
}

function getViewportCenterAndHeight() {
  const viewer = getViewer();
  if (!viewer) return null;
  const canvas = viewer.scene.canvas;
  const centerPixel = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const picked = viewer.camera.pickEllipsoid(centerPixel, viewer.scene.globe.ellipsoid);
  const carto = picked
    ? Cesium.Cartographic.fromCartesian(picked)
    : viewer.camera.positionCartographic;
  if (!carto) return null;
  const heightM = viewer.camera.positionCartographic?.height || 5200;
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
    heightM,
  };
}

function formatAdaptivePlace(weather, heightM) {
  const loc = weather?.location || {};
  const isZoomedIn = Number.isFinite(heightM) && heightM <= ZOOM_DISTRICT_THRESHOLD_M;
  if (isZoomedIn) {
    return loc.district || loc.subdistrict || loc.city || 'Jakarta';
  }
  return loc.city || loc.district || 'Jakarta';
}

function renderWeatherUi(weather, heightM) {
  const pill = document.getElementById('btnWeatherPill');
  const iconEl = document.getElementById('weatherPillIcon');
  const tempEl = document.getElementById('weatherPillTemp');
  const placeEl = document.getElementById('weatherPillPlace');
  const pop = document.getElementById('weatherPopover');
  if (!pill || !weather) return;

  const tempStr = Number.isFinite(weather.temperatureC) ? `${weather.temperatureC}°` : '—°';
  const placeStr = formatAdaptivePlace(weather, heightM);

  const condStr = weather.conditionEn || weather.condition || 'Cloudy';

  pill.dataset.rain = weather.isRain ? '1' : '0';
  pill.dataset.loaded = '1';
  if (iconEl) iconEl.innerHTML = weatherSvg(weather.iconType, 15);
  if (tempEl) tempEl.textContent = tempStr;
  if (placeEl) placeEl.textContent = placeStr;
  pill.title = `${condStr} · ${tempStr} (${placeStr}) — Click for weather details`;

  if (!pop) return;
  const loc = weather.location || {};
  const areaTitle = loc.district && loc.city && loc.district !== loc.city
    ? `${loc.district}, ${loc.city}`
    : (loc.city || loc.district || 'Greater Jakarta');
  const feelsLike = Number.isFinite(weather.apparentTemperatureC)
    ? `Feels like ${weather.apparentTemperatureC}°C`
    : '';
  const thirdMetricLabel = weather.precipitationMm !== null && weather.precipitationMm !== undefined
    ? 'Rain'
    : 'Clouds';
  const thirdMetricVal = weather.precipitationMm !== null && weather.precipitationMm !== undefined
    ? `${weather.precipitationMm} mm`
    : (Number.isFinite(weather.cloudCoverPct) ? `${weather.cloudCoverPct}%` : '—');

  pop.innerHTML = `
    <div class="weatherpop__head">
      <div>
        <div class="weatherpop__area">${escapeHtml(areaTitle)}</div>
        <div class="weatherpop__cond">${escapeHtml(condStr)}</div>
      </div>
      <span class="weatherpop__src" data-src="${escapeHtml(weather.source || 'bmkg')}">${escapeHtml(weather.sourceLabel || 'BMKG')}</span>
    </div>
    <div class="weatherpop__hero">
      <div class="weatherpop__hero-left">
        <span class="weatherpop__icon" data-rain="${weather.isRain ? '1' : '0'}">${weatherSvg(weather.iconType, 26)}</span>
        <strong class="weatherpop__temp">${escapeHtml(tempStr)}</strong>
      </div>
      ${feelsLike ? `<span class="weatherpop__feels">${escapeHtml(feelsLike)}</span>` : ''}
    </div>
    <div class="weatherpop__metrics">
      <div class="weatherpop__metric">
        <span class="weatherpop__mlabel">Humidity</span>
        <strong class="weatherpop__mval">${Number.isFinite(weather.humidityPct) ? `${weather.humidityPct}%` : '—'}</strong>
      </div>
      <div class="weatherpop__metric">
        <span class="weatherpop__mlabel">Wind</span>
        <strong class="weatherpop__mval">${Number.isFinite(weather.windSpeedKmh) ? `${weather.windSpeedKmh} km/h` : '—'}</strong>
      </div>
      <div class="weatherpop__metric">
        <span class="weatherpop__mlabel">${thirdMetricLabel}</span>
        <strong class="weatherpop__mval">${escapeHtml(thirdMetricVal)}</strong>
      </div>
    </div>
    <div class="weatherpop__foot">
      <span>${escapeHtml(weather.attribution || 'Source: BMKG (Indonesia Meteorological Agency)')}</span>
    </div>
  `;
}

async function syncWeatherForViewport({ force = false } = {}) {
  const vp = getViewportCenterAndHeight();
  if (!vp) return;

  // Perbarui label kota/kecamatan secara instan saat zoom berubah tanpa request tambahan
  if (lastWeather) {
    renderWeatherUi(lastWeather, vp.heightM);
  }

  if (!force && lastFetchedPoint) {
    const movedM = haversineM(lastFetchedPoint.lat, lastFetchedPoint.lon, vp.lat, vp.lon);
    if (movedM < MIN_REFETCH_DISTANCE_M) return;
  }

  if (activeController) {
    activeController.abort();
  }
  activeController = new AbortController();

  try {
    const weather = await ambilCuaca(vp.lat, vp.lon, { signal: activeController.signal });
    if (!weather) return;
    lastWeather = weather;
    lastFetchedPoint = { lat: vp.lat, lon: vp.lon };
    renderWeatherUi(weather, vp.heightM);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    // Biarkan pill tenang bila backend belum siap
  }
}

function setPopoverOpen(open) {
  popoverOpen = Boolean(open);
  const pill = document.getElementById('btnWeatherPill');
  const pop = document.getElementById('weatherPopover');
  if (pill) pill.setAttribute('aria-expanded', String(popoverOpen));
  if (pop) pop.hidden = !popoverOpen;
}

export function initWeatherPill() {
  if (initialized) return;
  const viewer = getViewer();
  const pill = document.getElementById('btnWeatherPill');
  const wrap = document.getElementById('weatherPillWrap');
  if (!viewer || !pill || !wrap) return;
  initialized = true;

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!lastWeather) {
      void syncWeatherForViewport({ force: true });
    }
    setPopoverOpen(!popoverOpen);
  });

  document.addEventListener('click', (e) => {
    if (popoverOpen && !wrap.contains(e.target)) {
      setPopoverOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popoverOpen) {
      setPopoverOpen(false);
    }
  });

  viewer.camera.moveEnd.addEventListener(() => {
    const vp = getViewportCenterAndHeight();
    if (vp && lastWeather) {
      renderWeatherUi(lastWeather, vp.heightM);
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void syncWeatherForViewport();
    }, DEBOUNCE_MS);
  });

  // Fetch awal saat peta siap
  void syncWeatherForViewport({ force: true });
}
