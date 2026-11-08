/*
   Lapisan garis rute dan penanda titik Awal (A) / Tujuan (B) di atas peta CesiumJS.
   Desain skema warna diadopsi dari Waze / Google Maps:
   - Rute Terpilih (Selected Route): Garis tebal ungu tua pekat (Deep Royal Purple, #581C87).
   - Rute Alternatif (Other Options): Garis ramping pastel lavender terang (#C4B5FD),
     kontras tinggi dan langsung dapat dibedakan seketika dari rute utama.
   - Interaktif: Dapat diklik langsung di peta untuk berpindah pilihan rute.
*/

import * as Cesium from 'cesium';
import { getViewer, getMapViewMode, flyToCoordinates } from './cesiumViewer.js';
import { boundsOf } from '../utils/geo.js';
import { pitaDariSkor, kunciDariLabel } from '../domain/scoreLabels.js';
import { pilihRuteByIndex, susunDaftarPilihanRute } from '../ui/controllers/resultController.js';

/** @type {Cesium.CustomDataSource|null} */
let routeDataSource = null;
/** @type {Cesium.ScreenSpaceEventHandler|null} */
let routeClickHandler = null;

let pinOriginDataUrl = null;
let pinDestDataUrl = null;

/**
 * Membuat ikon Titik Awal (Origin) yang identik dengan simbol di search bar:
 * Lingkaran biru berpendar (blue beacon dot) dengan cincin putih bersih dan outer glow.
 * @returns {string} data URL PNG
 */
function buatPinTitikAwal() {
  if (pinOriginDataUrl) return pinOriginDataUrl;

  const size = 44;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  // 1. Pendaran luar lembut (soft outer glow ala .field__pin--origin)
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
  ctx.fill();

  // 2. Lingkaran putih penegas kontras
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(14, 20, 48, 0.25)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // 3. Inti biru pekat (var(--jk-blue-1))
  ctx.beginPath();
  ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
  ctx.fillStyle = '#2563EB';
  ctx.fill();

  // 4. Titik pusat putih (GPS beacon core)
  ctx.beginPath();
  ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  pinOriginDataUrl = canvas.toDataURL('image/png');
  return pinOriginDataUrl;
}

/**
 * Membuat ikon Titik Tujuan (Destination) yang identik dengan simbol di search bar:
 * Pin tetes merah (teardrop map pin) dengan ujung runcing menghadap ke bawah tanah.
 * @returns {string} data URL PNG
 */
function buatPinTitikTujuan() {
  if (pinDestDataUrl) return pinDestDataUrl;

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

  // 1. Bayangan kontak di bawah ujung pin
  ctx.beginPath();
  ctx.ellipse(cx, tipY + 2, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14, 20, 48, 0.28)';
  ctx.fill();

  // 2. Bentuk tetes jarum peta (teardrop pin) menghadap ke bawah
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.bezierCurveTo(cx - headR, tipY - 14, cx - headR, headCy, cx - headR, headCy);
  ctx.arc(cx, headCy, headR, Math.PI, 0, false);
  ctx.bezierCurveTo(cx + headR, headCy, cx + headR, tipY - 14, cx, tipY);
  ctx.closePath();

  // Warna merah pekat khas alert / destination (var(--st-hindari))
  ctx.fillStyle = '#DC2626';
  ctx.shadowColor = 'rgba(220, 38, 38, 0.32)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Garis tepi putih tegas
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();

  // 3. Lingkaran putih di tengah kepala pin
  ctx.beginPath();
  ctx.arc(cx, headCy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // 4. Titik merah kecil di dalam lingkaran putih
  ctx.beginPath();
  ctx.arc(cx, headCy, 2, 0, Math.PI * 2);
  ctx.fillStyle = '#DC2626';
  ctx.fill();

  pinDestDataUrl = canvas.toDataURL('image/png');
  return pinDestDataUrl;
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
 * Menampilkan pratinjau pin Titik Awal (A) dan Tujuan (B) saat pengguna memilih lokasi,
 * serta mengarahkan kamera (hover/fly) ke titik yang dipilih.
 * @param {{lat:number, lon:number, nama:string}|null} asal
 * @param {{lat:number, lon:number, nama:string}|null} tujuan
 * @param {{fly?: boolean}} [opsi]
 */
export function previewEndpointsOnMap(asal, tujuan, { fly = false } = {}) {
  if (!routeDataSource) return;
  routeDataSource.entities.removeAll();

  const hasAsal = Boolean(asal && Number.isFinite(asal.lat) && Number.isFinite(asal.lon));
  const hasTujuan = Boolean(tujuan && Number.isFinite(tujuan.lat) && Number.isFinite(tujuan.lon));

  if (hasAsal) {
    routeDataSource.entities.add({
      id: 'route-pin-origin',
      position: Cesium.Cartesian3.fromDegrees(asal.lon, asal.lat, 24),
      billboard: {
        image: buatPinTitikAwal(),
        width: 32,
        height: 32,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `Awal: ${asal.nama}`,
        font: '800 12px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  if (hasTujuan) {
    routeDataSource.entities.add({
      id: 'route-pin-dest',
      position: Cesium.Cartesian3.fromDegrees(tujuan.lon, tujuan.lat, 24),
      billboard: {
        image: buatPinTitikTujuan(),
        width: 34,
        height: 42,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `Tujuan: ${tujuan.nama}`,
        font: '800 12px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -46),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  if (fly) {
    if (hasAsal && hasTujuan) {
      flyToRouteBounds([[asal.lon, asal.lat], [tujuan.lon, tujuan.lat]]);
    } else if (hasAsal) {
      flyToCoordinates({ lon: asal.lon, lat: asal.lat, height: 1600, duration: 1.2 });
    } else if (hasTujuan) {
      flyToCoordinates({ lon: tujuan.lon, lat: tujuan.lat, height: 1600, duration: 1.2 });
    }
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
        width: 5.5,
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
        width: 3.6,
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

  // 2. Gambar rute aktif (terpilih) paling atas ala Waze (Deep Royal Purple, ramping & kontras maksimal)
  const mainPositions = geometryToCartesianArray(hasil.route.geometry, 18);
  if (mainPositions.length >= 2) {
    // Casing gelap senada ungu tua pekat (#2E1065) agar garis terlihat tegas dan terpisah dari basemap
    routeDataSource.entities.add({
      id: 'route-main-casing',
      properties: { routeOptionIndex: indeksAktif },
      polyline: {
        positions: mainPositions,
        width: 8.5,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN,
        material: Cesium.Color.fromCssColorString('#2E1065').withAlpha(0.92),
      },
    });

    // Garis inti ungu tua ramping ala Waze (Selected Route)
    routeDataSource.entities.add({
      id: 'route-main-line',
      properties: { routeOptionIndex: indeksAktif },
      polyline: {
        positions: mainPositions,
        width: 5.6,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN,
        material: Cesium.Color.fromCssColorString('#581C87'),
      },
    });
  }

  // 3. Tambahkan pin Titik Awal dan Tujuan (identik dengan simbol search bar)
  const firstPair = hasil.route.geometry[0];
  const lastPair = hasil.route.geometry[hasil.route.geometry.length - 1];
  const asal = hasil.asal || (firstPair ? { lon: firstPair[0], lat: firstPair[1], nama: 'Titik Awal' } : null);
  const tujuan = hasil.tujuan || (lastPair ? { lon: lastPair[0], lat: lastPair[1], nama: 'Tujuan' } : null);

  if (asal) {
    routeDataSource.entities.add({
      id: 'route-pin-origin',
      position: Cesium.Cartesian3.fromDegrees(asal.lon, asal.lat, 26),
      billboard: {
        image: buatPinTitikAwal(),
        width: 32,
        height: 32,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${asal.nama}`,
        font: '800 12px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  if (tujuan) {
    routeDataSource.entities.add({
      id: 'route-pin-dest',
      position: Cesium.Cartesian3.fromDegrees(tujuan.lon, tujuan.lat, 26),
      billboard: {
        image: buatPinTitikTujuan(),
        width: 34,
        height: 42,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${tujuan.nama} (Rute ${indeksAktif + 1})`,
        font: '800 12px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -46),
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

let pinUserLocationDataUrl = null;

/**
 * Membuat ikon titik lokasi pengguna saat ini (blue GPS beacon dengan outer halo).
 */
function buatPinLokasiPengguna() {
  if (pinUserLocationDataUrl) return pinUserLocationDataUrl;

  const size = 52;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  // 1. Pendaran luar lembut
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(37, 99, 235, 0.25)';
  ctx.fill();

  // 2. Lingkaran putih penegas
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(14, 20, 48, 0.35)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // 3. Inti biru pekat (GPS beacon core)
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#2563EB';
  ctx.fill();

  // 4. Titik pusat putih
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  pinUserLocationDataUrl = canvas.toDataURL('image/png');
  return pinUserLocationDataUrl;
}

/**
 * Menampilkan penanda lokasi pengguna saat ini pada peta Cesium.
 * @param {number} lon
 * @param {number} lat
 */
export function showUserLocationOnMap(lon, lat) {
  if (!routeDataSource) return;

  const existing = routeDataSource.entities.getById('user-current-location');
  if (existing) {
    routeDataSource.entities.remove(existing);
  }

  routeDataSource.entities.add({
    id: 'user-current-location',
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 24),
    billboard: {
      image: buatPinLokasiPengguna(),
      width: 38,
      height: 38,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: 'Lokasi Anda',
      font: '800 12px Manrope, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#1E1B4B'),
      outlineWidth: 3.5,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

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
