/*
   Daftar lokasi Jakarta untuk kotak isian titik awal dan tujuan.

   PENTING soal urutan angka. Seluruh berkas ini menyimpan koordinat dalam
   bentuk { lat, lon } karena itu yang lazim dibaca manusia. Perubahan ke
   urutan "lon,lat" yang diminta backend dikerjakan di satu tempat saja,
   yaitu fungsi toCoordParam pada src/utils/geo.js.
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

/** Peta memori untuk menyimpan lokasi dinamis hasil pencarian geocoding live */
const customPlaces = new Map();

/**
 * Mendaftarkan lokasi dinamis hasil pencarian geocoding
 * @param {Tempat} place
 */
export function registerCustomPlace(place) {
  if (place && place.id) {
    customPlaces.set(place.id, place);
  }
}

/**
 * Mencari satu tempat berdasarkan id.
 * @param {string} id
 * @returns {Tempat|null}
 */
export function findPlaceById(id) {
  if (customPlaces.has(id)) return customPlaces.get(id);
  return JAKARTA_PLACES.find((p) => p.id === id) || null;
}

/**
 * Mencari tempat berdasarkan teks yang diketik pengguna (pencarian lokal).
 * @param {string} teks
 * @param {number} [maks=6] jumlah saran paling banyak yang dikembalikan
 * @returns {Tempat[]}
 */
export function searchPlaces(teks, maks = 6) {
  const kunci = String(teks || '').trim().toLowerCase();
  if (!kunci) return JAKARTA_PLACES.slice(0, maks);

  const customHits = Array.from(customPlaces.values()).filter((p) =>
    `${p.nama} ${p.area}`.toLowerCase().includes(kunci)
  );

  const presetHits = JAKARTA_PLACES.filter((p) =>
    `${p.nama} ${p.area}`.toLowerCase().includes(kunci)
  );

  return [...customHits, ...presetHits].slice(0, maks);
}

/**
 * Mencari lokasi secara dinamis menggunakan Geocoding API (Google Geocoding / OSM Photon / Nominatim).
 * Mendukung pencarian alamat spesifik apa pun di Jakarta & Indonesia (nama jalan, nomor rumah, gedung, koordinat).
 *
 * @param {string} teks
 * @param {number} [maks=6]
 * @returns {Promise<Tempat[]>}
 */
export async function searchPlacesLive(teks, maks = 6) {
  const kunci = String(teks || '').trim();
  if (!kunci) return JAKARTA_PLACES.slice(0, maks);

  // 1. Cek kecocokan lokal di preset Jakarta
  const localHits = searchPlaces(kunci, maks);
  if (localHits.length >= 3 && localHits.some((h) => h.nama.toLowerCase().startsWith(kunci.toLowerCase()))) {
    return localHits;
  }

  // 2. Panggil endpoint Geocoding di backend
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(kunci)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.places) && data.places.length > 0) {
        data.places.forEach((p) => registerCustomPlace(p));
        // Gabungkan hasil geocoding dengan preset yang relevan
        const hasil = [...data.places];
        for (const loc of localHits) {
          if (!hasil.some((h) => h.nama.toLowerCase() === loc.nama.toLowerCase())) {
            hasil.push(loc);
          }
        }
        return hasil.slice(0, maks);
      }
    }
  } catch (err) {
    console.warn('[searchPlacesLive] Gagal memanggil geocode backend, fallback ke lokal:', err.message);
  }

  return localHits;
}
