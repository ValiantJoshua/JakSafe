/*
   Daftar lokasi Jakarta untuk kotak isian titik awal dan tujuan.

   Kenapa daftar ini ada di frontend dan bukan di backend. Backend JakSafe
   tidak menyediakan layanan geocoding, jadi ia hanya menerima koordinat
   mentah pada /api/route dengan urutan bujur lalu lintang. Sampai pencarian
   alamat yang sebenarnya dipasang, daftar tetap ini yang menerjemahkan nama
   tempat menjadi koordinat sebelum permintaan dikirim.

   PENTING soal urutan angka. Seluruh berkas ini menyimpan koordinat dalam
   bentuk { lat, lon } karena itu yang lazim dibaca manusia. Perubahan ke
   urutan "lon,lat" yang diminta backend dikerjakan di satu tempat saja,
   yaitu fungsi toCoordParam pada src/utils/geo.js. Jangan membalik urutan
   di tempat lain supaya tidak ada rute yang melenceng ke tengah laut.
*/

/**
 * @typedef {object} Tempat
 * @property {string} id    pengenal pendek, dipakai sebagai kunci daftar
 * @property {string} nama  nama yang ditampilkan ke pengguna
 * @property {string} area  wilayah administratif, untuk memperjelas pilihan
 * @property {number} lat   lintang, bernilai negatif untuk Jakarta
 * @property {number} lon   bujur
 */

/** @type {Tempat[]} */
export const JAKARTA_PLACES = [
  { id: 'sudirman', nama: 'Jl. Jenderal Sudirman', area: 'Jakarta Pusat', lat: -6.2146, lon: 106.8211 },
  { id: 'monas', nama: 'Monumen Nasional', area: 'Jakarta Pusat', lat: -6.1754, lon: 106.8272 },
  { id: 'thamrin', nama: 'Bundaran HI', area: 'Jakarta Pusat', lat: -6.1944, lon: 106.8230 },
  { id: 'kuningan', nama: 'Kuningan', area: 'Jakarta Selatan', lat: -6.2297, lon: 106.8295 },
  { id: 'blokm', nama: 'Blok M', area: 'Jakarta Selatan', lat: -6.2441, lon: 106.8003 },
  { id: 'kemang', nama: 'Kemang', area: 'Jakarta Selatan', lat: -6.2607, lon: 106.8137 },
  { id: 'tb-simatupang', nama: 'TB Simatupang', area: 'Jakarta Selatan', lat: -6.2920, lon: 106.8139 },
  { id: 'kelapa-gading', nama: 'Kelapa Gading', area: 'Jakarta Utara', lat: -6.1588, lon: 106.9057 },
  { id: 'ancol', nama: 'Ancol', area: 'Jakarta Utara', lat: -6.1255, lon: 106.8307 },
  { id: 'tanjung-priok', nama: 'Tanjung Priok', area: 'Jakarta Utara', lat: -6.1045, lon: 106.8800 },
  { id: 'grogol', nama: 'Grogol', area: 'Jakarta Barat', lat: -6.1668, lon: 106.7896 },
  { id: 'kembangan', nama: 'Kembangan', area: 'Jakarta Barat', lat: -6.1890, lon: 106.7400 },
  { id: 'cengkareng', nama: 'Cengkareng', area: 'Jakarta Barat', lat: -6.1467, lon: 106.7322 },
  { id: 'cawang', nama: 'Cawang', area: 'Jakarta Timur', lat: -6.2444, lon: 106.8697 },
  { id: 'rawamangun', nama: 'Rawamangun', area: 'Jakarta Timur', lat: -6.1962, lon: 106.8800 },
  { id: 'cakung', nama: 'Cakung', area: 'Jakarta Timur', lat: -6.1866, lon: 106.9405 },
  { id: 'kampus-ui', nama: 'Kampus UI Depok', area: 'Depok', lat: -6.3617, lon: 106.8272 },
  { id: 'soetta', nama: 'Bandara Soekarno Hatta', area: 'Tangerang', lat: -6.1256, lon: 106.6559 },
];

/** Titik awal dan tujuan yang terisi saat halaman pertama dibuka. */
export const DEFAULT_TRIP = {
  origin: 'sudirman',
  destination: 'monas',
};

/**
 * Mencari satu tempat berdasarkan id.
 * @param {string} id
 * @returns {Tempat|null}
 */
export function findPlaceById(id) {
  return JAKARTA_PLACES.find((p) => p.id === id) || null;
}

/**
 * Mencari tempat berdasarkan teks yang diketik pengguna.
 * Pencocokan dibuat longgar, tidak peduli huruf besar kecil, dan juga
 * mencocokkan nama wilayah supaya mengetik "Jakarta Utara" tetap memberi
 * hasil. Dipakai oleh daftar saran pada kotak isian.
 *
 * @param {string} teks
 * @param {number} [maks=6] jumlah saran paling banyak yang dikembalikan
 * @returns {Tempat[]}
 */
export function searchPlaces(teks, maks = 6) {
  const kunci = String(teks || '').trim().toLowerCase();
  if (!kunci) return JAKARTA_PLACES.slice(0, maks);
  return JAKARTA_PLACES
    .filter((p) => `${p.nama} ${p.area}`.toLowerCase().includes(kunci))
    .slice(0, maks);
}
