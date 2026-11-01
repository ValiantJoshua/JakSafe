/*
   Pembungkus endpoint agen navigasi.

   KEADAAN SAAT INI, BACA SEBELUM MENGUBAH APA PUN.

   Endpoint POST /api/navigate BELUM ADA di backend. Pada
   backend/src/server.js masih tertulis baris penanda

       // TODO: POST /api/navigate

   Jadi memanggilnya sekarang pasti menghasilkan 404. Modul ini tetap
   dibuat lebih dulu, dengan tiga tujuan.

   Pertama, bentuk permintaan dan balasan yang diharapkan frontend sudah
   tertulis hitam di atas putih, sehingga pemegang backend tinggal
   mencocokkan tanpa perlu rapat tambahan.

   Kedua, kegagalan 404 dikenali secara khusus lewat sebab BELUM_ADA, bukan
   diperlakukan sebagai galat biasa. Dengan begitu lapisan di atasnya bisa
   memilih jalan lain tanpa menampilkan layar galat ke pengguna.

   Ketiga, saat endpoint itu nanti selesai, tidak ada satu baris pun di
   tampilan yang perlu diubah. Panggilan ini akan berhasil, jalan cadangan
   berhenti dipakai dengan sendirinya, dan penanda sumber hasil di layar
   otomatis berubah dari Pratinjau menjadi Agen.

   BENTUK PERMINTAAN YANG DIHARAPKAN
     POST /api/navigate
     {
       origin:      { lat, lon },
       destination: { lat, lon },
       profile:     "car" | "bike" | "foot",
       preferences: { healthSensitive: boolean }
     }

   BENTUK BALASAN YANG DIHARAPKAN
     {
       ok: true,
       route: { distanceM, durationS, geometry: [[lon,lat], ...] },
       score: {
         totalScore, label, color,
         breakdown: { time: {...}, aqi: {...}, condition: {...} }
       },
       air:   { pm2_5, us_aqi, usAqiCategory, time },
       visual:{ cameraId, cameraName, fetchedAt, analysis },
       reasoning: [ { step, thought, action, observation, durationMs } ],
       alternatives: [ { distanceM, durationS, totalScore, label } ]
     }

   Bagian score sengaja dibuat sama persis dengan keluaran
   calculateRouteScore pada backend/src/scoring/routeScorer.js supaya
   backend cukup meneruskan objeknya apa adanya.
*/

import { minta, SEBAB } from './httpClient.js';
import { TIMEOUT_MS } from '../config/constants.js';

/**
 * Menanyakan rekomendasi rute kepada agen di backend.
 *
 * @param {object} opsi
 * @param {{lat:number, lon:number}} opsi.asal
 * @param {{lat:number, lon:number}} opsi.tujuan
 * @param {'car'|'bike'|'foot'} opsi.profil
 * @param {boolean} [opsi.sensitifKesehatan=false]
 * @param {AbortSignal} [opsi.signal]
 * @returns {Promise<object>} balasan agen apa adanya
 * @throws {import('./httpClient.js').ApiError}
 */
export async function mintaNavigasi({
  asal,
  tujuan,
  profil,
  sensitifKesehatan = false,
  signal,
}) {
  return minta('/navigate', {
    metode: 'POST',
    badan: {
      origin: { lat: asal.lat, lon: asal.lon },
      destination: { lat: tujuan.lat, lon: tujuan.lon },
      profile: profil,
      preferences: { healthSensitive: sensitifKesehatan },
    },
    timeoutMs: TIMEOUT_MS.navigasi,
    signal,
  });
}

/**
 * Memeriksa apakah sebuah galat berarti endpoint agen memang belum dibuat.
 *
 * Dipisah menjadi fungsi tersendiri supaya pengetahuan tentang arti 404 di
 * jalur ini hanya tertulis di satu tempat. Kalau nanti backend memilih
 * membalas 501 Not Implemented, cukup berkas ini yang disesuaikan.
 *
 * @param {unknown} galat
 * @returns {boolean}
 */
export function karenaEndpointBelumAda(galat) {
  return Boolean(galat && galat.sebab === SEBAB.BELUM_ADA);
}
