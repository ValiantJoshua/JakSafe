/*
   Pembungkus endpoint kamera CCTV.

   Tiga endpoint backend yang dipakai.
     GET /api/cctv/sources              seluruh kamera dalam katalog
     GET /api/cctv/nearest?coords=...   kamera terdekat dari satu titik
     GET /api/cctv/frame/:id            gambar terkini kamera tersebut

   Hal paling penting yang perlu diketahui tentang bagian ini.

   Frontend tidak pernah tahu alamat sumber kamera. Backend sengaja
   menyaringnya lewat fungsi publicView pada cctvCatalog.js, jadi yang
   sampai ke peramban hanya id, nama, koordinat, arah hadap, dan lisensi.
   Gambar diambil lewat /api/cctv/frame/:id yang mengunduhnya dari sisi
   server dengan penjagaan terhadap serangan permintaan sisi server.
   Karena itu frontend tidak boleh dan tidak bisa memanggil alamat kamera
   secara langsung, dan penjelasan ini yang dipakai kalau ditanya kenapa
   gambar CCTV tidak diambil langsung saja dari sumbernya.

   Hal kedua, katalog bisa kosong. Berkas backend/src/data/cctvCatalog.json
   saat ini masih berisi array kosong karena daftar kamera belum diisi.
   Jadi keadaan "tidak ada kamera" bukan galat, melainkan keadaan normal
   yang harus ditampilkan dengan tenang, bukan dengan pesan merah.
*/

import { minta, urlSumberDaya } from './httpClient.js';
import { TIMEOUT_MS, SAMPLING } from '../config/constants.js';
import { toCoordParam } from '../utils/geo.js';

/**
 * @typedef {object} Kamera
 * @property {string} id
 * @property {string} nama
 * @property {number} lat
 * @property {number} lon
 * @property {number|null} jarakM      hanya terisi pada hasil pencarian terdekat
 * @property {number|null} headingDeg  arah hadap kamera dalam derajat
 * @property {string|null} provider
 * @property {string|null} license
 */

/** Menyeragamkan bentuk kamera dari backend menjadi bentuk yang dipakai tampilan. */
function keKamera(c) {
  return {
    id: c.id,
    nama: c.name,
    lat: c.lat,
    lon: c.lon,
    jarakM: Number.isFinite(c.distanceM) ? c.distanceM : null,
    headingDeg: c.headingDeg ?? null,
    provider: c.provider ?? null,
    license: c.license ?? null,
  };
}

/**
 * Mengambil seluruh kamera dalam katalog.
 * Dipakai nanti oleh lapisan penanda kamera di peta 3D.
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
 * Radius bawaan diambil dari SAMPLING.radiusKameraM, bukan dari radius
 * bawaan backend yang hanya lima ratus meter. Alasannya, titik contoh di
 * tengah rute belum tentu persis berada di jalan protokol yang dipasangi
 * kamera, jadi jangkauan sedikit dilebarkan supaya peluang menemukan bukti
 * visual lebih besar.
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
 * Parameter t berisi penanda waktu dan hanya berfungsi memaksa peramban
 * mengambil gambar baru, bukan memakai yang tersimpan di cache. Backend
 * sudah mengirim header Cache-Control no-store, tetapi beberapa peramban
 * tetap memakai gambar lama kalau alamatnya persis sama, dan untuk kamera
 * lalu lintas gambar lama justru menyesatkan.
 *
 * @param {string} idKamera
 * @returns {string}
 */
export function urlBingkaiKamera(idKamera) {
  return urlSumberDaya(`/cctv/frame/${encodeURIComponent(idKamera)}`, { t: Date.now() });
}
