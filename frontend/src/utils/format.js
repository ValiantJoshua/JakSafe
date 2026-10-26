/*
   Pemformatan angka dan waktu untuk tampilan.

   Semua angka yang dilihat pengguna melewati berkas ini. Tujuannya dua.
   Pertama, satuan yang dipakai konsisten di seluruh layar, misalnya jarak
   selalu kilometer dengan satu angka di belakang koma. Kedua, nilai kosong
   dari backend tidak pernah bocor ke layar menjadi tulisan "null" atau
   "NaN", melainkan menjadi tanda hubung yang netral.
*/

/** Tanda yang dipakai kalau datanya memang tidak tersedia. */
export const KOSONG = '–';

/**
 * Jarak dari meter menjadi teks siap tampil.
 * Di bawah satu kilometer tetap ditulis dalam meter karena membulatkan
 * 400 meter menjadi 0,4 km justru lebih susah dibayangkan pengguna.
 *
 * @param {number} meter
 * @returns {string}
 */
export function formatJarak(meter) {
  if (!Number.isFinite(meter)) return KOSONG;
  if (meter < 1000) return `${Math.round(meter)} m`;
  return `${(meter / 1000).toFixed(1)} km`;
}

/**
 * Durasi dari detik menjadi teks siap tampil.
 * Di atas satu jam dipecah menjadi jam dan menit karena "97 menit" lebih
 * lambat dicerna daripada "1 jam 37 menit".
 *
 * @param {number} detik
 * @returns {string}
 */
export function formatDurasi(detik) {
  if (!Number.isFinite(detik)) return KOSONG;
  const menit = Math.round(detik / 60);
  if (menit < 60) return `${menit} menit`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa === 0 ? `${jam} jam` : `${jam} jam ${sisa} menit`;
}

/**
 * Angka dengan jumlah desimal tetap, memakai koma sebagai pemisah desimal
 * sesuai kebiasaan penulisan Indonesia.
 *
 * @param {number} nilai
 * @param {number} [desimal=1]
 * @returns {string}
 */
export function formatAngka(nilai, desimal = 1) {
  if (!Number.isFinite(nilai)) return KOSONG;
  return nilai.toFixed(desimal).replace('.', ',');
}

/**
 * Durasi pendek untuk jejak proses, misalnya lama satu panggilan API.
 * Di bawah satu detik ditulis dalam milidetik supaya perbedaan kecil
 * antar panggilan masih terlihat saat sesi tanya jawab.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatLama(ms) {
  if (!Number.isFinite(ms)) return KOSONG;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} detik`;
}

/**
 * Waktu jam dan menit zona Jakarta dari sebuah penanda waktu ISO.
 * Backend sudah mengirim waktu Open-Meteo dalam zona Asia/Jakarta, tetapi
 * penanda waktu lain seperti X-Frame-Fetched-At memakai UTC, jadi zona
 * waktunya ditetapkan di sini supaya seragam di layar.
 *
 * @param {string} iso
 * @returns {string}
 */
export function formatJam(iso) {
  if (!iso) return KOSONG;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return KOSONG;
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(d);
}

/**
 * Mengubah kode kondisi jalan dari backend menjadi kalimat yang terbaca.
 * Daftar kode ini mengikuti nilai yang mungkin muncul pada breakdown
 * condition.traffic di backend/src/scoring/routeScorer.js.
 *
 * @param {string} kode
 * @returns {string}
 */
export function labelKondisiJalan(kode) {
  const peta = {
    lancar: 'Lancar',
    normal: 'Normal',
    padat: 'Padat',
    merayap: 'Merayap',
    macet: 'Macet',
    macet_total: 'Macet total',
    macet_berat: 'Macet berat',
  };
  return peta[String(kode || '').toLowerCase()] || 'Tidak diketahui';
}

/**
 * Mengubah tingkat genangan dari hasil analisis citra menjadi teks tampilan.
 * Kata kuncinya mengikuti yang dibaca normalizeConditionScore di backend.
 *
 * @param {string} tingkat
 * @returns {string}
 */
export function labelGenangan(tingkat) {
  const peta = {
    ringan: 'Genangan ringan',
    rendah: 'Genangan ringan',
    sedang: 'Genangan sedang',
    berat: 'Genangan berat',
    tinggi: 'Genangan berat',
  };
  return peta[String(tingkat || '').toLowerCase()] || 'Ada genangan';
}
