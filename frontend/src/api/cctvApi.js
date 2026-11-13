/*
   Pembungkus endpoint kamera CCTV.

   Empat endpoint backend yang dipakai.
     GET /api/cctv/sources              seluruh kamera dalam katalog
     GET /api/cctv/nearest?coords=...   kamera terdekat dari satu titik
     GET /api/cctv/frame/:id            gambar terkini kamera tersebut
     GET /api/cctv/analyze/:id          analisis AI Vision Gemini untuk kamera tersebut

   Hal paling penting yang perlu diketahui tentang bagian ini.

   Frontend tidak pernah tahu alamat sumber kamera. Backend sengaja
   menyaringnya lewat fungsi publicView pada cctvCatalog.js, jadi yang
   sampai ke peramban hanya id, nama, koordinat, arah hadap, dan lisensi.
   Gambar diambil lewat /api/cctv/frame/:id yang mengunduhnya dari sisi
   server dengan penjagaan terhadap serangan permintaan sisi server.
   Karena itu frontend tidak boleh dan tidak bisa memanggil alamat kamera
   secara langsung, dan penjelasan ini yang dipakai kalau ditanya kenapa
   gambar CCTV tidak diambil langsung saja dari sumbernya.
*/

import { minta, urlSumberDaya } from './httpClient.js';
import { TIMEOUT_MS, SAMPLING } from '../config/constants.js';
import { toCoordParam } from '../utils/geo.js';

/**
 * @typedef {object} Kamera
 * @property {string} id
 * @property {string} nama
 * @property {string|null} city
 * @property {number} lat
 * @property {number} lon
 * @property {number|null} jarakM      hanya terisi pada hasil pencarian terdekat
 * @property {number|null} headingDeg  arah hadap kamera dalam derajat
 * @property {number|null} pitchDeg
 * @property {number|null} fovDeg
 * @property {number|null} rangeM
 * @property {string|null} provider
 * @property {boolean} hasLiveStream
 * @property {'online'|'offline'|'unknown'} status
 * @property {string|null} statusReason
 * @property {string|null} lastCheckedAt
 * @property {string|null} license
 */

/** Menyeragamkan bentuk kamera dari backend menjadi bentuk yang dipakai tampilan. */
function keKamera(c) {
  return {
    id: c.id,
    nama: c.name || c.nama || c.id,
    city: c.city ?? 'Jakarta',
    lat: Number(c.lat),
    lon: Number(c.lon),
    jarakM: Number.isFinite(c.distanceM) ? c.distanceM : (Number.isFinite(c.jarakM) ? c.jarakM : null),
    headingDeg: Number.isFinite(c.headingDeg) ? Number(c.headingDeg) : null,
    pitchDeg: Number.isFinite(c.pitchDeg) ? Number(c.pitchDeg) : null,
    fovDeg: Number.isFinite(c.fovDeg) ? Number(c.fovDeg) : null,
    rangeM: Number.isFinite(c.rangeM) ? Number(c.rangeM) : null,
    provider: c.provider ?? null,
    hasLiveStream: Boolean(c.hasLiveStream),
    status: c.status === 'online' || c.status === 'offline' ? c.status : 'unknown',
    statusReason: c.statusReason ?? null,
    lastCheckedAt: c.lastCheckedAt ?? null,
    license: c.license ?? null,
  };
}

/**
 * Mengambil seluruh kamera dalam katalog.
 * Dipakai oleh lapisan penanda kamera di peta 3D/2D.
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<Kamera[]>}
 */
export async function ambilSemuaKamera(signal) {
  const data = await minta('/cctv/sources', { timeoutMs: TIMEOUT_MS.cepat, signal });
  return (data.cameras || []).map(keKamera);
}

/**
 * Mencari kamera terdekat dari sebuah titik.
 *
 * @param {object} opsi
 * @param {{lat:number, lon:number}} opsi.titik
 * @param {number} [opsi.radiusM]
 * @param {number} [opsi.batas=3]
 * @param {AbortSignal} [opsi.signal]
 * @returns {Promise<Kamera[]>}
 */
export async function ambilKameraTerdekat({
  titik,
  radiusM = SAMPLING.radiusKameraM,
  batas = 3,
  signal,
}) {
  const data = await minta('/cctv/nearest', {
    kueri: {
      coords: toCoordParam([titik]),
      radius: radiusM,
      limit: batas,
    },
    timeoutMs: TIMEOUT_MS.cepat,
    signal,
  });
  return (data.cameras || []).map(keKamera);
}

/**
 * Menyusun alamat gambar satu kamera.
 *
 * @param {string} idKamera
 * @param {number} [cacheBust]
 * @returns {string}
 */
export function urlBingkaiKamera(idKamera, cacheBust = Date.now()) {
  return urlSumberDaya(`/cctv/frame/${encodeURIComponent(idKamera)}`, { t: cacheBust });
}

/**
 * Menyusun URL playlist HLS (.m3u8) video live stream untuk satu kamera.
 *
 * @param {string} idKamera
 * @returns {string}
 */
export function urlStreamKamera(idKamera) {
  return urlSumberDaya(`/cctv/stream/${encodeURIComponent(idKamera)}.m3u8`);
}

/**
 * Meminta analisis AI Vision (Gemini) untuk satu kamera CCTV dari backend.
 *
 * @param {string} idKamera
 * @param {AbortSignal} [signal]
 * @returns {Promise<{camera:Kamera|null, fetchedAt:string|null, analysis:object|null, cached:boolean}>}
 */
export async function analisisKamera(idKamera, signal) {
  const data = await minta(`/cctv/analyze/${encodeURIComponent(idKamera)}`, {
    timeoutMs: TIMEOUT_MS.navigasi,
    signal,
  });
  return {
    camera: data.camera ? keKamera(data.camera) : null,
    fetchedAt: data.fetchedAt || null,
    analysis: data.analysis || null,
    cached: Boolean(data.cached),
  };
}
