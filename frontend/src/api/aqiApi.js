/*
   Pembungkus endpoint kualitas udara.

   Endpoint backend
     GET /api/aqi?coords=lon,lat;lon,lat&metrics=uv_index,nitrogen_dioxide

   Balasan backend
     {
       ok: true,
       metrics: ["pm2_5", "us_aqi", ...],
       results: [
         {
           lat, lon, time,
           values: { pm2_5: 23.4, us_aqi: 78, ... },
           units:  { pm2_5: "µg/m³", ... },
           unavailable: ["ammonia"],
           usAqiCategory: { label: "Moderate", color: "#ffff00" }
         }
       ]
     }

   Dua hal yang sering ditanyakan tentang endpoint ini.

   Pertama, parameter metrics bersifat tambahan. Backend selalu menyertakan
   pm2_5 dan us_aqi lewat DEFAULT_METRICS, jadi frontend hanya perlu meminta
   metrik tambahan kalau memang relevan, misalnya uv_index saat pengguna
   memilih moda motor. Meminta semua metrik sekaligus hanya memperlambat
   tanpa menambah nilai apa pun pada penilaian.

   Kedua, daftar unavailable harus dihormati. Open-Meteo tidak punya data
   untuk sebagian variabel di wilayah Indonesia, misalnya ammonia. Metrik
   yang masuk daftar itu tidak boleh ditebak nilainya, cukup ditandai tidak
   tersedia di tampilan.
*/

import { minta } from './httpClient.js';
import { TIMEOUT_MS } from '../config/constants.js';
import { toCoordParam } from '../utils/geo.js';

/**
 * @typedef {object} HasilUdara
 * @property {number} lat
 * @property {number} lon
 * @property {string} time
 * @property {Record<string, number>} values
 * @property {Record<string, string>} units
 * @property {string[]} unavailable
 * @property {{label:string, color:string}|null} usAqiCategory
 */

/**
 * Metrik tambahan yang masuk akal untuk tiap moda perjalanan.
 *
 * Pilihan ini bukan hiasan. Pengendara motor dan pejalan kaki berada di
 * udara terbuka sepanjang perjalanan sehingga indeks ultraviolet dan gas
 * buang kendaraan benar benar mereka hirup, sedangkan pengguna mobil
 * berada di dalam kabin sehingga dua metrik itu kurang menggambarkan
 * paparan yang sebenarnya.
 *
 * @param {'car'|'bike'|'foot'} profil
 * @returns {string[]}
 */
export function metrikTambahanUntuk(profil) {
  if (profil === 'bike' || profil === 'foot') return ['uv_index', 'nitrogen_dioxide'];
  return [];
}

/**
 * Mengambil data kualitas udara untuk beberapa titik sekaligus.
 *
 * @param {object} opsi
 * @param {{lat:number, lon:number}[]} opsi.titik  satu sampai dua belas titik
 * @param {string[]} [opsi.metrikTambahan]
 * @param {AbortSignal} [opsi.signal]
 * @returns {Promise<{metrics:string[], results:HasilUdara[]}>}
 */
export async function ambilKualitasUdara({ titik, metrikTambahan = [], signal }) {
  const data = await minta('/aqi', {
    kueri: {
      coords: toCoordParam(titik),
      metrics: metrikTambahan.length ? metrikTambahan.join(',') : undefined,
    },
    timeoutMs: TIMEOUT_MS.udara,
    signal,
  });

  return {
    metrics: Array.isArray(data.metrics) ? data.metrics : [],
    results: Array.isArray(data.results) ? data.results : [],
  };
}

/**
 * Meringkas beberapa titik menjadi satu angka yang mewakili rute.
 *
 * Dipakai nilai terburuk, bukan rata rata, dan ini keputusan yang disengaja.
 * Rata rata bisa menyembunyikan satu ruas yang sangat kotor di antara empat
 * ruas bersih, padahal ruas itulah yang menentukan paparan pengguna. Untuk
 * peringatan kesehatan, titik terburuk lebih aman dijadikan dasar.
 *
 * @param {HasilUdara[]} results
 * @returns {{pm2_5:number|null, us_aqi:number|null, titikTerburuk:HasilUdara|null, uv_index:number|null}}
 */
export function ringkasUdara(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return { pm2_5: null, us_aqi: null, titikTerburuk: null, uv_index: null };
  }

  let terburuk = null;
  let pmTertinggi = -Infinity;
  let aqiTertinggi = -Infinity;
  let uvTertinggi = -Infinity;

  for (const r of results) {
    const pm = Number(r?.values?.pm2_5);
    const aqi = Number(r?.values?.us_aqi);
    const uv = Number(r?.values?.uv_index);
    if (Number.isFinite(pm) && pm > pmTertinggi) {
      pmTertinggi = pm;
      terburuk = r;
    }
    if (Number.isFinite(aqi) && aqi > aqiTertinggi) aqiTertinggi = aqi;
    if (Number.isFinite(uv) && uv > uvTertinggi) uvTertinggi = uv;
  }

  // Kalau pm2_5 kosong di semua titik, titik terburuk ditentukan dari us_aqi
  // supaya kartu kualitas udara tetap punya sesuatu untuk ditampilkan.
  if (!terburuk) {
    terburuk = results.find((r) => Number.isFinite(Number(r?.values?.us_aqi))) || results[0];
  }

  return {
    pm2_5: Number.isFinite(pmTertinggi) ? pmTertinggi : null,
    us_aqi: Number.isFinite(aqiTertinggi) ? aqiTertinggi : null,
    uv_index: Number.isFinite(uvTertinggi) ? uvTertinggi : null,
    titikTerburuk: terburuk,
  };
}
