/*
   Lapisan Kualitas Udara (AQI & PM2.5) di atas peta CesiumJS JakSafe.

   Fitur:
   - Mendukung sakelar ON / OFF layer Kualitas Udara (setAqiLayerEnabled).
   - Memuat data langsung dari GET /api/aqi untuk titik-titik pantau utama
     Jakarta serta titik terburuk di sepanjang rute navigasi.
   - Menampilkan lingkaran zona paparan udara berwarna sesuai ambang PM2.5
     beserta lencana angka PM2.5 dan US AQI di atas peta.
*/

import * as Cesium from 'cesium';
import { ambilKualitasUdara } from '../api/aqiApi.js';
import { getViewer } from './cesiumViewer.js';

/** Titik pantau referensi kualitas udara di lima wilayah DKI Jakarta. */
const TITIK_PANTAU_JAKARTA = [
  { id: 'aqi-bundaran-hi', nama: 'Bundaran HI', lat: -6.1950, lon: 106.8230 },
  { id: 'aqi-monas', nama: 'Monas (Pusat)', lat: -6.1754, lon: 106.8272 },
  { id: 'aqi-kuningan', nama: 'Kuningan', lat: -6.2297, lon: 106.8295 },
  { id: 'aqi-kemang', nama: 'Kemang (Selatan)', lat: -6.2607, lon: 106.8136 },
  { id: 'aqi-grogol', nama: 'Grogol (Barat)', lat: -6.1670, lon: 106.7888 },
  { id: 'aqi-kelapa-gading', nama: 'Kelapa Gading (Utara)', lat: -6.1574, lon: 106.9080 },
];

/** @type {Cesium.CustomDataSource|null} */
let aqiDataSource = null;
/** @type {boolean} */
let layerEnabled = false;
/** @type {Array<{nama:string, lat:number, lon:number, pm2_5:number|null, us_aqi:number|null, isWorst?:boolean}>} */
let baseAqiPoints = [];
/** @type {object|null} */
let routeWorstPoint = null;

/** @type {Set<(info:{enabled:boolean, count:number})=>void>} */
const listeners = new Set();

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn({ enabled: layerEnabled, count: baseAqiPoints.length + (routeWorstPoint ? 1 : 0) });
    } catch { /* ignore */ }
  }
}

export function onAqiLayerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isAqiLayerEnabled() {
  return layerEnabled;
}

/** Menentukan warna lingkaran zona berdasarkan nilai PM2.5 (µg/m³). */
function warnaPm25(pm) {
  if (!Number.isFinite(pm)) return Cesium.Color.fromCssColorString('#64748B');
  if (pm <= 15) return Cesium.Color.fromCssColorString('#22C55E');
  if (pm <= 35) return Cesium.Color.fromCssColorString('#EAB308');
  if (pm <= 55) return Cesium.Color.fromCssColorString('#F97316');
  return Cesium.Color.fromCssColorString('#EF4444');
}

function renderAqiEntities() {
  if (!aqiDataSource) return;
  aqiDataSource.entities.removeAll();

  const allPoints = [...baseAqiPoints];
  if (routeWorstPoint) allPoints.push(routeWorstPoint);

  allPoints.forEach((pt, idx) => {
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) return;
    const baseColor = warnaPm25(pt.pm2_5);
    const pmText = Number.isFinite(pt.pm2_5) ? `PM2.5 ${Math.round(pt.pm2_5)}` : 'AQI -';
    const aqiText = Number.isFinite(pt.us_aqi) ? ` · AQI ${Math.round(pt.us_aqi)}` : '';

    aqiDataSource.entities.add({
      id: `aqi-zone-${idx}`,
      position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 22),
      ellipse: {
        semiMajorAxis: pt.isWorst ? 520 : 680,
        semiMinorAxis: pt.isWorst ? 520 : 680,
        material: baseColor.withAlpha(pt.isWorst ? 0.34 : 0.22),
        outline: true,
        outlineColor: baseColor.withAlpha(0.85),
        outlineWidth: 2,
        height: 8,
      },
      point: {
        pixelSize: pt.isWorst ? 14 : 11,
        color: baseColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${pt.nama}\n${pmText}${aqiText}`,
        font: '800 11.5px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0E1430'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 38000),
      },
    });
  });

  getViewer()?.scene.requestRender();
}

/**
 * Memperbarui titik terburuk AQI pada rute aktif.
 * @param {object|null} hasil
 */
export function updateRouteAqiOnMap(hasil) {
  const tb = hasil?.air?.titikTerburuk;
  if (tb && Number.isFinite(tb.lat) && Number.isFinite(tb.lon)) {
    routeWorstPoint = {
      nama: 'Titik Rute Terpolusi',
      lat: Number(tb.lat),
      lon: Number(tb.lon),
      pm2_5: Number(tb.values?.pm2_5 ?? hasil?.air?.pm2_5),
      us_aqi: Number(tb.values?.us_aqi ?? hasil?.air?.us_aqi),
      isWorst: true,
    };
  } else {
    routeWorstPoint = null;
  }
  renderAqiEntities();
  notifyListeners();
}

export function setAqiLayerEnabled(enabled) {
  layerEnabled = Boolean(enabled);
  if (aqiDataSource) {
    aqiDataSource.show = layerEnabled;
  }
  getViewer()?.scene.requestRender();
  notifyListeners();
}

export function toggleAqiLayer() {
  setAqiLayerEnabled(!layerEnabled);
  return layerEnabled;
}

export async function initAqiLayer() {
  const viewer = getViewer();
  if (!viewer) return;

  if (!aqiDataSource) {
    aqiDataSource = new Cesium.CustomDataSource('jaksafe-aqi');
    aqiDataSource.show = layerEnabled;
    await viewer.dataSources.add(aqiDataSource);
  }

  try {
    const res = await ambilKualitasUdara({ titik: TITIK_PANTAU_JAKARTA });
    baseAqiPoints = TITIK_PANTAU_JAKARTA.map((t, i) => {
      const r = res.results[i];
      return {
        nama: t.nama,
        lat: t.lat,
        lon: t.lon,
        pm2_5: Number(r?.values?.pm2_5),
        us_aqi: Number(r?.values?.us_aqi),
      };
    });
    renderAqiEntities();
    notifyListeners();
  } catch (err) {
    console.warn('[JakSafe AQI Layer] Gagal memuat titik pantau udara awal:', err?.message || err);
  }
}
