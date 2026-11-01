/*
   Lapisan garis rute dan penanda titik Awal (A) / Tujuan (B) di atas peta CesiumJS.

   Fitur:
   - Menggambar rute terpilih dengan warna sesuai pita skor keamanan JakSafe:
     Aman (#22C55E), Hati-hati (#F59E0B), Hindari (#EF4444), lengkap dengan
     garis pendar (glow outline) agar kontras di atas peta 3D maupun 2D.
   - Menggambar rute alternatif (jika ada) sebagai garis putus-putus transparan.
   - Menampilkan pin Titik Awal (A) dan Tujuan (B) beserta label namanya.
   - Mengarahkan kamera otomatis (flyTo) agar seluruh bentang rute terlihat jelas.
*/

import * as Cesium from 'cesium';
import { getViewer, getMapViewMode } from './cesiumViewer.js';
import { boundsOf } from '../utils/geo.js';
import { pitaDariSkor, kunciDariLabel } from '../domain/scoreLabels.js';

/** @type {Cesium.CustomDataSource|null} */
let routeDataSource = null;

const pinCache = new Map();

/** Membuat gambar pin bulat bertuliskan huruf ('A' atau 'B'). */
function buatPinLokasi(huruf, warnaBg, warnaTepi = '#FFFFFF') {
  const key = `${huruf}-${warnaBg}`;
  if (pinCache.has(key)) return pinCache.get(key);

  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14, 20, 48, 0.32)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, 16, 0, Math.PI * 2);
  ctx.fillStyle = warnaBg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = warnaTepi;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 16px "League Spartan", Manrope, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(huruf, cx, cy + 1);

  const url = canvas.toDataURL('image/png');
  pinCache.set(key, url);
  return url;
}

/** Menentukan warna garis rute berdasarkan status keamanan ('aman'|'hati'|'hindari'). */
function warnaStatusRute(kunciStatus) {
  if (kunciStatus === 'hindari') return Cesium.Color.fromCssColorString('#EF4444');
  if (kunciStatus === 'hati') return Cesium.Color.fromCssColorString('#F59E0B');
  return Cesium.Color.fromCssColorString('#22C55E');
}

/** Mengonversi array geometri [[lon, lat], ...] menjadi Cartesian3[] dengan ketinggian sedikit di atas jalan. */
function geometryToCartesianArray(geometry, heightM = 16) {
  if (!Array.isArray(geometry)) return [];
  const coords = [];
  for (const pair of geometry) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [lon, lat] = pair;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      coords.push(Cesium.Cartesian3.fromDegrees(lon, lat, heightM));
    }
  }
  return coords;
}

/**
 * Menampilkan pratinjau pin Titik Awal (A) dan Tujuan (B) saat pengguna memilih lokasi.
 * @param {{lat:number, lon:number, nama:string}|null} asal
 * @param {{lat:number, lon:number, nama:string}|null} tujuan
 */
export function previewEndpointsOnMap(asal, tujuan) {
  if (!routeDataSource) return;
  routeDataSource.entities.removeAll();

  if (asal && Number.isFinite(asal.lat) && Number.isFinite(asal.lon)) {
    routeDataSource.entities.add({
      id: 'route-pin-origin',
      position: Cesium.Cartesian3.fromDegrees(asal.lon, asal.lat, 24),
      billboard: {
        image: buatPinLokasi('A', '#2A40D0'),
        width: 38,
        height: 38,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `Awal: ${asal.nama}`,
        font: '800 13px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0E1430'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  if (tujuan && Number.isFinite(tujuan.lat) && Number.isFinite(tujuan.lon)) {
    routeDataSource.entities.add({
      id: 'route-pin-dest',
      position: Cesium.Cartesian3.fromDegrees(tujuan.lon, tujuan.lat, 24),
      billboard: {
        image: buatPinLokasi('B', '#16A34A'),
        width: 38,
        height: 38,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `Tujuan: ${tujuan.nama}`,
        font: '800 13px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0E1430'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  getViewer()?.scene.requestRender();
}

/**
 * Mengarahkan kamera agar seluruh kotak pembatas rute masuk ke dalam layar.
 * @param {number[][]} geometry
 */
export function flyToRouteBounds(geometry) {
  const viewer = getViewer();
  if (!viewer || !Array.isArray(geometry) || geometry.length < 2) return;

  const b = boundsOf(geometry);
  if (!b) return;

  const centerLon = (b.minLon + b.maxLon) / 2;
  const centerLat = (b.minLat + b.maxLat) / 2;
  const spanDeg = Math.max(b.maxLon - b.minLon, b.maxLat - b.minLat, 0.015);
  const is3D = getMapViewMode() === '3d';

  const height = Math.max(1200, Math.min(24000, spanDeg * 145000));
  const pitchDeg = is3D ? -42 : -89.9;
  const latOffset = is3D ? (height / 111320) * 0.62 : 0;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat - latOffset, height),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(pitchDeg),
      roll: 0,
    },
    duration: 1.35,
  });
}

/**
 * Menggambar hasil rute navigasi lengkap (rute utama, alternatif, pin A & B) dan mengarahkan kamera.
 * @param {object|null} hasil
 */
export function renderRouteOnMap(hasil) {
  if (!routeDataSource) return;
  routeDataSource.entities.removeAll();

  if (!hasil || !hasil.route || !Array.isArray(hasil.route.geometry)) {
    getViewer()?.scene.requestRender();
    return;
  }

  const kunci = kunciDariLabel(hasil.score?.label)
    || pitaDariSkor(hasil.score?.totalScore ?? 20).key;
  const warnaUtama = warnaStatusRute(kunci);

  // 1. Gambar rute alternatif (bila ada) sebagai garis putus-putus abu-kebiruan
  const alternatives = Array.isArray(hasil.alternatives) ? hasil.alternatives : [];
  alternatives.forEach((alt, idx) => {
    if (!Array.isArray(alt?.geometry) || alt.geometry.length < 2) return;
    const altPositions = geometryToCartesianArray(alt.geometry, 13);
    routeDataSource.entities.add({
      id: `route-alt-${idx}`,
      polyline: {
        positions: altPositions,
        width: 5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#94A3B8').withAlpha(0.75),
          dashLength: 16,
        }),
      },
    });
  });

  // 2. Gambar rute utama dengan efek pendar (PolylineGlow)
  const mainPositions = geometryToCartesianArray(hasil.route.geometry, 18);
  if (mainPositions.length >= 2) {
    // Lapisan dasar gelap agar kontras di atas jalan terang
    routeDataSource.entities.add({
      id: 'route-main-casing',
      polyline: {
        positions: mainPositions,
        width: 13,
        material: Cesium.Color.fromCssColorString('#0E1430').withAlpha(0.85),
      },
    });

    // Garis inti berwarna status keamanan (Aman / Hati-hati / Hindari)
    routeDataSource.entities.add({
      id: 'route-main-line',
      polyline: {
        positions: mainPositions,
        width: 8,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.22,
          color: warnaUtama,
        }),
      },
    });
  }

  // 3. Tambahkan pin Titik Awal (A) dan Tujuan (B)
  const firstPair = hasil.route.geometry[0];
  const lastPair = hasil.route.geometry[hasil.route.geometry.length - 1];
  const asal = hasil.asal || (firstPair ? { lon: firstPair[0], lat: firstPair[1], nama: 'Titik Awal' } : null);
  const tujuan = hasil.tujuan || (lastPair ? { lon: lastPair[0], lat: lastPair[1], nama: 'Tujuan' } : null);

  if (asal) {
    routeDataSource.entities.add({
      id: 'route-pin-origin',
      position: Cesium.Cartesian3.fromDegrees(asal.lon, asal.lat, 26),
      billboard: {
        image: buatPinLokasi('A', '#2A40D0'),
        width: 40,
        height: 40,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${asal.nama}`,
        font: '800 13px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0E1430'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -25),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  if (tujuan) {
    routeDataSource.entities.add({
      id: 'route-pin-dest',
      position: Cesium.Cartesian3.fromDegrees(tujuan.lon, tujuan.lat, 26),
      billboard: {
        image: buatPinLokasi('B', warnaUtama.toCssColorString()),
        width: 40,
        height: 40,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${tujuan.nama} (Skor ${hasil.score?.totalScore ?? '-'})`,
        font: '800 13px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0E1430'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -25),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  flyToRouteBounds(hasil.route.geometry);
  getViewer()?.scene.requestRender();
}

export function clearRouteOnMap() {
  if (!routeDataSource) return;
  routeDataSource.entities.removeAll();
  getViewer()?.scene.requestRender();
}

export async function initRouteLayer() {
  const viewer = getViewer();
  if (!viewer) return;
  if (!routeDataSource) {
    routeDataSource = new Cesium.CustomDataSource('jaksafe-route');
    await viewer.dataSources.add(routeDataSource);
  }
}
