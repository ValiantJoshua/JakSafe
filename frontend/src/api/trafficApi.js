/*
   Pembungkus endpoint lalu lintas TomTom.

   Endpoint backend
     GET /api/tomtom/status                 keadaan kunci dan sisa kuota
     GET /api/tomtom/segment?point=lat,lon  kecepatan dan keterlambatan satu titik
     GET /api/tomtom/flow/:z/:x/:y.pbf      tile vektor untuk pewarnaan peta

   Bagian ini punya satu sifat yang tidak dimiliki endpoint lain, yaitu
   kuota harian. TomTom tingkat gratis dibatasi sekitar dua ribu lima ratus
   panggilan per hari, dan backend memasang pagar di angka dua ribu empat
   ratus lewat TOMTOM_DAILY_TILE_BUDGET. Kalau pagar itu terlampaui backend
   membalas status 429 dengan pesan budget_exceeded, dan kalau kuncinya
   memang belum dipasang balasannya 503 dengan pesan no_key.

   Karena itu seluruh fungsi di berkas ini memperlakukan kegagalan lalu
   lintas sebagai keadaan yang dapat diterima, bukan sebagai kegagalan
   pencarian rute. Tanpa data TomTom, penilaian tetap berjalan memakai
   perkiraan waktu dasar dari OSRM, dan tampilan menandai sumbernya supaya
   pengguna tahu angkanya belum dikalibrasi dengan kondisi sebenarnya.

   PERHATIAN pada urutan koordinat. Endpoint segment menerima dua bentuk,
   point memakai urutan lintang lalu bujur, sedangkan coords memakai
   urutan bujur lalu lintang seperti endpoint lain. Di sini dipilih bentuk
   coords supaya seluruh frontend memakai satu kebiasaan yang sama dan
   tidak ada tempat yang perlu dibalik sendiri.
*/

import { minta, urlSumberDaya } from './httpClient.js';
import { TIMEOUT_MS } from '../config/constants.js';
import { toCoordParam } from '../utils/geo.js';

/**
 * @typedef {object} StatusLaluLintas
 * @property {boolean} adaKunci       kunci TomTom sudah dipasang di backend
 * @property {number} terpakai        jumlah panggilan hari ini
 * @property {number} kuota           pagar harian yang dipasang backend
 * @property {string} tanggal
 * @property {boolean} tersedia       siap dipakai, ada kunci dan kuota belum habis
 */

/**
 * @typedef {object} SegmenLaluLintas
 * @property {number|null} currentSpeedKmH
 * @property {number|null} freeFlowSpeedKmH
 * @property {number} delayPercent     persentase keterlambatan dibanding arus bebas
 * @property {boolean} roadClosure     jalan dilaporkan tertutup
 * @property {number|null} confidence
 */

/**
 * Memeriksa kesiapan layanan lalu lintas.
 * Seperti cekKesehatan, fungsi ini tidak melempar pengecualian karena
 * ketiadaan TomTom bukan keadaan luar biasa dalam proyek ini.
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<StatusLaluLintas>}
 */
export async function cekStatusLaluLintas(signal) {
  try {
    const data = await minta('/tomtom/status', { timeoutMs: TIMEOUT_MS.cepat, signal });
    const terpakai = Number(data?.dailyCount) || 0;
    const kuota = Number(data?.budget) || 0;
    return {
      adaKunci: Boolean(data?.hasKey),
      terpakai,
      kuota,
      tanggal: data?.date || '',
      tersedia: Boolean(data?.hasKey) && (kuota === 0 || terpakai < kuota),
    };
  } catch {
    return { adaKunci: false, terpakai: 0, kuota: 0, tanggal: '', tersedia: false };
  }
}

/**
 * Mengambil data arus lalu lintas pada satu titik.
 *
 * Mengembalikan null, bukan melempar, ketika TomTom tidak tersedia. Dengan
 * begitu pemanggil cukup memeriksa apakah hasilnya ada, dan alur penilaian
 * tidak perlu dibungkus try catch di banyak tempat.
 *
 * @param {object} opsi
 * @param {{lat:number, lon:number}} opsi.titik
 * @param {AbortSignal} [opsi.signal]
 * @returns {Promise<SegmenLaluLintas|null>}
 */
export async function ambilSegmenLaluLintas({ titik, signal }) {
  try {
    const data = await minta('/tomtom/segment', {
      kueri: { coords: toCoordParam([titik]) },
      timeoutMs: TIMEOUT_MS.cepat,
      signal,
    });
    return data?.data || null;
  } catch {
    return null;
  }
}

/**
 * Mengambil data lalu lintas untuk beberapa titik lalu memilih yang terparah.
 *
 * Alasan memilih yang terparah sama dengan alasan pada kualitas udara.
 * Satu ruas yang tertutup atau macet berat menentukan pengalaman seluruh
 * perjalanan, sedangkan rata rata akan menyamarkannya. Jalan tertutup
 * selalu menang atas pertimbangan apa pun karena rute itu memang tidak
 * bisa dilewati.
 *
 * @param {object} opsi
 * @param {{lat:number, lon:number}[]} opsi.titik
 * @param {AbortSignal} [opsi.signal]
 * @returns {Promise<SegmenLaluLintas|null>}
 */
export async function ambilLaluLintasTerparah({ titik, signal }) {
  const hasil = await Promise.all(
    titik.map((t) => ambilSegmenLaluLintas({ titik: t, signal })),
  );
  const terisi = hasil.filter(Boolean);
  if (terisi.length === 0) return null;

  const tertutup = terisi.find((s) => s.roadClosure);
  if (tertutup) return tertutup;

  return terisi.reduce((a, b) => ((b.delayPercent || 0) > (a.delayPercent || 0) ? b : a));
}

/**
 * Pola alamat tile vektor untuk lapisan lalu lintas di peta 3D.
 * Belum dipakai pada tahap ini, disiapkan supaya modul peta nanti tidak
 * perlu lagi menebak bentuk alamatnya.
 *
 * @returns {string} pola dengan penanda {z}, {x}, dan {y}
 */
export function polaUrlTileLaluLintas() {
  return urlSumberDaya('/tomtom/flow/{z}/{x}/{y}.pbf');
}
