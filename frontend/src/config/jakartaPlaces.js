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
  { id: 'grand-indonesia', nama: 'Grand Indonesia', area: 'Jl. M.H. Thamrin, Jakarta Pusat', lat: -6.1950, lon: 106.8198 },
  { id: 'plaza-indonesia', nama: 'Plaza Indonesia', area: 'Jl. M.H. Thamrin, Jakarta Pusat', lat: -6.1931, lon: 106.8219 },
  { id: 'thamrin-city', nama: 'Thamrin City', area: 'KH Mas Mansyur, Jakarta Pusat', lat: -6.1942, lon: 106.8157 },
  { id: 'sarinah', nama: 'Sarinah Thamrin', area: 'Menteng, Jakarta Pusat', lat: -6.1873, lon: 106.8235 },
  { id: 'tanah-abang', nama: 'Pasar & Stasiun Tanah Abang', area: 'Tanah Abang, Jakarta Pusat', lat: -6.1887, lon: 106.8117 },
  { id: 'gambir', nama: 'Stasiun Gambir', area: 'Gambir, Jakarta Pusat', lat: -6.1767, lon: 106.8306 },
  { id: 'senayan-city', nama: 'Senayan City', area: 'Senayan, Jakarta Pusat', lat: -6.2272, lon: 106.7973 },
  { id: 'plaza-senayan', nama: 'Plaza Senayan', area: 'Senayan, Jakarta Pusat', lat: -6.2254, lon: 106.7993 },
  { id: 'gbk', nama: 'Gelora Bung Karno (GBK)', area: 'Senayan, Jakarta Pusat', lat: -6.2186, lon: 106.8018 },
  { id: 'scbd', nama: 'SCBD & Pacific Place', area: 'Kebayoran Baru, Jakarta Selatan', lat: -6.2243, lon: 106.8097 },
  { id: 'kuningan', nama: 'Kuningan', area: 'Jakarta Selatan', lat: -6.2297, lon: 106.8295 },
  { id: 'kota-kasablanka', nama: 'Kota Kasablanka (Kokas)', area: 'Tebet, Jakarta Selatan', lat: -6.2241, lon: 106.8422 },
  { id: 'manggarai', nama: 'Stasiun Manggarai', area: 'Tebet, Jakarta Selatan', lat: -6.2099, lon: 106.8502 },
  { id: 'blokm', nama: 'Blok M', area: 'Jakarta Selatan', lat: -6.2441, lon: 106.8003 },
  { id: 'gandaria-city', nama: 'Gandaria City', area: 'Kebayoran Lama, Jakarta Selatan', lat: -6.2442, lon: 106.7835 },
  { id: 'pim', nama: 'Pondok Indah Mall (PIM)', area: 'Kebayoran Lama, Jakarta Selatan', lat: -6.2655, lon: 106.7844 },
  { id: 'kemang', nama: 'Kemang', area: 'Jakarta Selatan', lat: -6.2607, lon: 106.8137 },
  { id: 'tb-simatupang', nama: 'TB Simatupang', area: 'Jakarta Selatan', lat: -6.2920, lon: 106.8139 },
  { id: 'kelapa-gading', nama: 'Kelapa Gading', area: 'Jakarta Utara', lat: -6.1588, lon: 106.9057 },
  { id: 'ancol', nama: 'Ancol', area: 'Jakarta Utara', lat: -6.1255, lon: 106.8307 },
  { id: 'pik', nama: 'Pantai Indah Kapuk (PIK)', area: 'Penjaringan, Jakarta Utara', lat: -6.1090, lon: 106.7405 },
  { id: 'tanjung-priok', nama: 'Tanjung Priok', area: 'Jakarta Utara', lat: -6.1045, lon: 106.8800 },
  { id: 'kota-tua', nama: 'Kota Tua Jakarta', area: 'Taman Sari, Jakarta Barat', lat: -6.1352, lon: 106.8133 },
  { id: 'grogol', nama: 'Grogol', area: 'Jakarta Barat', lat: -6.1668, lon: 106.7896 },
  { id: 'central-park', nama: 'Central Park & Mall Taman Anggrek', area: 'Tanjung Duren, Jakarta Barat', lat: -6.1774, lon: 106.7907 },
  { id: 'kembangan', nama: 'Kembangan & Puri Indah', area: 'Jakarta Barat', lat: -6.1890, lon: 106.7400 },
  { id: 'cengkareng', nama: 'Cengkareng', area: 'Jakarta Barat', lat: -6.1467, lon: 106.7322 },
  { id: 'cawang', nama: 'Cawang', area: 'Jakarta Timur', lat: -6.2444, lon: 106.8697 },
  { id: 'halim', nama: 'Bandara & Stasiun Whoosh Halim', area: 'Makasar, Jakarta Timur', lat: -6.2666, lon: 106.8912 },
  { id: 'rawamangun', nama: 'Rawamangun', area: 'Jakarta Timur', lat: -6.1962, lon: 106.8800 },
  { id: 'cakung', nama: 'Cakung', area: 'Jakarta Timur', lat: -6.1866, lon: 106.9405 },
  { id: 'kampus-ui', nama: 'Kampus UI Depok', area: 'Depok', lat: -6.3617, lon: 106.8272 },
  { id: 'soetta', nama: 'Bandara Soekarno Hatta', area: 'Tangerang', lat: -6.1256, lon: 106.6559 },
];

/** Titik awal dan tujuan default saat halaman pertama dibuka (kosong). */
export const DEFAULT_TRIP = {
  origin: null,
  destination: null,
};

/** Peta memori untuk menyimpan lokasi dinamis hasil pencarian geocoding live */
const customPlaces = new Map();
/** Cache hasil pencarian geocoding di sisi klien agar query yang sama tidak hit API berulang */
const clientGeocodeCache = new Map();
const MAX_CLIENT_CACHE = 120;

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

  // Urutkan yang diawali kata kunci di paling atas
  const combined = [...customHits, ...presetHits];
  combined.sort((a, b) => {
    const aStarts = a.nama.toLowerCase().startsWith(kunci) ? 0 : 1;
    const bStarts = b.nama.toLowerCase().startsWith(kunci) ? 0 : 1;
    return aStarts - bStarts;
  });

  const unique = [];
  for (const item of combined) {
    if (!unique.some((u) => u.id === item.id || u.nama.toLowerCase() === item.nama.toLowerCase())) {
      unique.push(item);
      if (unique.length >= maks) break;
    }
  }
  return unique;
}

/**
 * Mencari lokasi secara dinamis menggunakan Geocoding API di backend.
 * Mendukung pembatalan (AbortSignal) saat pengguna mengetik cepat agar tidak membanjiri proxy.
 *
 * @param {string} teks
 * @param {number} [maks=6]
 * @param {AbortSignal} [signal]
 * @returns {Promise<Tempat[]>}
 */
export async function searchPlacesLive(teks, maks = 6, signal) {
  const kunci = String(teks || '').trim();
  if (!kunci) return JAKARTA_PLACES.slice(0, maks);

  const cacheKey = kunci.toLowerCase();
  if (clientGeocodeCache.has(cacheKey)) {
    return clientGeocodeCache.get(cacheKey);
  }

  // 1. Cek kecocokan lokal di preset Jakarta
  const localHits = searchPlaces(kunci, maks);
  if (
    kunci.length < 3 ||
    (localHits.length >= 1 && localHits[0].nama.toLowerCase().startsWith(kunci.toLowerCase()))
  ) {
    if (localHits.length > 0) return localHits;
  }

  // 2. Panggil endpoint Geocoding di backend dengan batas waktu & AbortSignal
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 5000);
  const onAbort = () => timeoutCtrl.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      return localHits;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(kunci)}`, {
      signal: timeoutCtrl.signal,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.places) && data.places.length > 0) {
        data.places.forEach((p) => registerCustomPlace(p));
        const hasil = [...data.places];
        for (const loc of localHits) {
          if (!hasil.some((h) => h.nama.toLowerCase() === loc.nama.toLowerCase())) {
            hasil.push(loc);
          }
        }
        const finalHits = hasil.slice(0, maks);
        clientGeocodeCache.set(cacheKey, finalHits);
        if (clientGeocodeCache.size > MAX_CLIENT_CACHE) {
          const firstKey = clientGeocodeCache.keys().next().value;
          clientGeocodeCache.delete(firstKey);
        }
        return finalHits;
      }
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn('[searchPlacesLive] Fallback ke katalog lokal:', err.message);
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  return localHits;
}
