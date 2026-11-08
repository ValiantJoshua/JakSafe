/*
   Lapisan garis rute dan penanda titik Awal (A) / Tujuan (B) di atas peta CesiumJS.
   Desain skema warna diadopsi dari Waze / Google Maps:
   - Rute Terpilih (Selected Route): Garis tebal ungu tua pekat (Deep Royal Purple, #581C87).
   - Rute Alternatif (Other Options): Garis ramping pastel lavender terang (#C4B5FD),
     kontras tinggi dan langsung dapat dibedakan seketika dari rute utama.
   - Interaktif: Dapat diklik langsung di peta untuk berpindah pilihan rute.
*/

import * as Cesium from 'cesium';
import { getViewer, getMapViewMode } from './cesiumViewer.js';
import { boundsOf } from '../utils/geo.js';
import { pitaDariSkor, kunciDariLabel } from '../domain/scoreLabels.js';
import { pilihRuteByIndex, susunDaftarPilihanRute } from '../ui/controllers/resultController.js';

/** @type {Cesium.CustomDataSource|null} */
let routeDataSource = null;
/** @type {Cesium.ScreenSpaceEventHandler|null} */
let routeClickHandler = null;

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
        image: buatPinLokasi('A', '#2563EB'),
        width: 38,
        height: 38,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `Awal: ${asal.nama}`,
        font: '800 13px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
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
        image: buatPinLokasi('B', '#DC2626'),
        width: 38,
        height: 38,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `Tujuan: ${tujuan.nama}`,
        font: '800 13px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
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
 * Menggambar hasil rute navigasi lengkap (rute utama, alternatif interaktif, pin A & B) dan mengarahkan kamera.
 * Skema warna ala Waze:
 * - Rute Utama: Deep Royal Purple (#581C87) tebal & solid.
 * - Rute Alternatif: Pastel Lavender (#C4B5FD) ramping & terang.
 *
 * @param {object|null} hasil
 */
export function renderRouteOnMap(hasil) {
  if (!routeDataSource) return;
  routeDataSource.entities.removeAll();

  if (!hasil || !hasil.route || !Array.isArray(hasil.route.geometry)) {
    getViewer()?.scene.requestRender();
    return;
  }

  const semuaPilihan = susunDaftarPilihanRute(hasil);
  const indeksAktif = Number.isInteger(hasil.indeksRuteAktif) ? hasil.indeksRuteAktif : 0;

  // 1. Gambar seluruh rute alternatif (opsi lain yang tidak aktif)
  //    Gaya Waze: garis ramping, warna pastel lavender terang (#C4B5FD), outline lembut tanpa dark-blue.
  semuaPilihan.forEach((opt, idx) => {
    if (idx === indeksAktif) return;
    const geom = opt.route?.geometry;
    if (!Array.isArray(geom) || geom.length < 2) return;

    const altPositions = geometryToCartesianArray(geom, 14);

    // Casing tipis lavender-ungu lembut (bukan dark blue) agar batas garis tetap rapi
    routeDataSource.entities.add({
      id: `route-alt-casing-${idx}`,
      properties: { routeOptionIndex: idx },
      polyline: {
        positions: altPositions,
        width: 8.5,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN,
        material: Cesium.Color.fromCssColorString('#A78BFA').withAlpha(0.45),
      },
    });

    // Garis inti pastel lavender terang ala Waze (Other Options)
    routeDataSource.entities.add({
      id: `route-alt-line-${idx}`,
      properties: { routeOptionIndex: idx },
      polyline: {
        positions: altPositions,
        width: 5.5,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN,
        material: Cesium.Color.fromCssColorString('#C4B5FD').withAlpha(0.95),
      },
    });

    // Lencana (pill) melayang pada rute alternatif agar pengguna dapat melihat & mengklik langsung di peta
    const anchorRatio = Math.min(0.75, Math.max(0.28, 0.35 + (idx - 1) * 0.22));
    const midPair = geom[Math.floor(geom.length * anchorRatio)];
    if (Array.isArray(midPair) && midPair.length >= 2) {
      const effMin = opt.score?.breakdown?.time?.effectiveDurationMin
        ?? Math.max(1, Math.round((opt.route.durationS || 0) / 60));
      routeDataSource.entities.add({
        id: `route-alt-badge-${idx}`,
        position: Cesium.Cartesian3.fromDegrees(midPair[0], midPair[1], 28),
        properties: { routeOptionIndex: idx },
        label: {
          text: `Rute ${idx + 1} · ${effMin} mnt`,
          font: '800 12px Manrope, sans-serif',
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#FFFFFF').withAlpha(0.96),
          backgroundPadding: new Cesium.Cartesian2(11, 6),
          fillColor: Cesium.Color.fromCssColorString('#581C87'),
          outlineColor: Cesium.Color.fromCssColorString('#DDD6FE'),
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  });

  // 2. Gambar rute aktif (terpilih) paling atas ala Waze (Deep Royal Purple, tebal & kontras maksimal)
  const mainPositions = geometryToCartesianArray(hasil.route.geometry, 18);
  if (mainPositions.length >= 2) {
    // Casing gelap senada ungu tua pekat (#2E1065) agar garis terlihat tegas dan terpisah dari basemap
    routeDataSource.entities.add({
      id: 'route-main-casing',
      properties: { routeOptionIndex: indeksAktif },
      polyline: {
        positions: mainPositions,
        width: 14.5,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN,
        material: Cesium.Color.fromCssColorString('#2E1065').withAlpha(0.92),
      },
    });

    // Garis inti ungu tua tebal ala Waze (Selected Route)
    routeDataSource.entities.add({
      id: 'route-main-line',
      properties: { routeOptionIndex: indeksAktif },
      polyline: {
        positions: mainPositions,
        width: 10,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN,
        material: Cesium.Color.fromCssColorString('#581C87'),
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
        image: buatPinLokasi('A', '#2563EB'),
        width: 40,
        height: 40,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${asal.nama}`,
        font: '800 13px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
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
        image: buatPinLokasi('B', '#DC2626'),
        width: 40,
        height: 40,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${tujuan.nama} (Rute ${indeksAktif + 1})`,
        font: '800 13px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -25),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  if (!hasil.hanyaGantiPilihan) {
    flyToRouteBounds(hasil.route.geometry);
  }
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

  if (!routeClickHandler) {
    routeClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    routeClickHandler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      if (!Cesium.defined(picked) || !picked.id) return;
      const entity = picked.id;
      const routeIdx = entity?.properties?.routeOptionIndex?.getValue?.();
      if (Number.isInteger(routeIdx)) {
        pilihRuteByIndex(routeIdx);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
}
