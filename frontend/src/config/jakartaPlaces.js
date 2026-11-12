/*
   Daftar lokasi Jakarta & Pengelola Pencarian Lokasi Presisi (Spesifikasi Kalceria).

   PENTING soal urutan angka. Seluruh berkas ini menyimpan koordinat dalam
   bentuk { lat, lon } karena itu yang lazim dibaca manusia. Perubahan ke
   urutan "lon,lat" yang diminta backend dikerjakan di satu tempat saja,
   yaitu fungsi toCoordParam pada src/utils/geo.js.
*/

/**
 * @typedef {object} Tempat
 * @property {string} id            pengenal pendek, dipakai sebagai kunci daftar
 * @property {string} nama          baris utama (headline): nama tempat/perumahan, blok/nomor, jalan
 * @property {string} area          baris kedua (subtitle): kelurahan, kecamatan, kota, provinsi
 * @property {string} [headline]    alias Kalceria untuk baris utama
 * @property {string} [subtitle]    alias Kalceria untuk baris wilayah administratif
 * @property {string} [formatted]   alamat lengkap gabungan
 * @property {number} lat           lintang, bernilai negatif untuk Jakarta
 * @property {number} lon           bujur
 */

/** @type {Tempat[]} */
export const JAKARTA_PLACES = [
  { id: 'sudirman', nama: 'Jl. Jenderal Sudirman', area: 'Tanah Abang, Kota Jakarta Pusat, DKI Jakarta', lat: -6.2146, lon: 106.8211 },
  { id: 'monas', nama: 'Monumen Nasional', area: 'Gambir, Kota Jakarta Pusat, DKI Jakarta', lat: -6.1754, lon: 106.8272 },
  { id: 'thamrin', nama: 'Bundaran HI, Jl. M.H. Thamrin', area: 'Menteng, Kota Jakarta Pusat, DKI Jakarta', lat: -6.1944, lon: 106.8230 },
  { id: 'grand-indonesia', nama: 'Grand Indonesia, Jl. M.H. Thamrin', area: 'Kebon Melati, Kec. Menteng, Kota Jakarta Pusat', lat: -6.1950, lon: 106.8198 },
  { id: 'plaza-indonesia', nama: 'Plaza Indonesia, Jl. M.H. Thamrin', area: 'Gondangdia, Kec. Menteng, Kota Jakarta Pusat', lat: -6.1931, lon: 106.8219 },
  { id: 'thamrin-city', nama: 'Thamrin City, Jl. K.H. Mas Mansyur', area: 'Kebon Melati, Kec. Tanah Abang, Kota Jakarta Pusat', lat: -6.1942, lon: 106.8157 },
  { id: 'sarinah', nama: 'Sarinah Thamrin', area: 'Gondangdia, Kec. Menteng, Kota Jakarta Pusat', lat: -6.1873, lon: 106.8235 },
  { id: 'tanah-abang', nama: 'Pasar & Stasiun Tanah Abang', area: 'Kampung Bali, Kec. Tanah Abang, Kota Jakarta Pusat', lat: -6.1887, lon: 106.8117 },
  { id: 'gambir', nama: 'Stasiun Gambir', area: 'Gambir, Kec. Gambir, Kota Jakarta Pusat', lat: -6.1767, lon: 106.8306 },
  { id: 'senayan-city', nama: 'Senayan City, Jl. Asia Afrika', area: 'Gelora, Kec. Tanah Abang, Kota Jakarta Pusat', lat: -6.2272, lon: 106.7973 },
  { id: 'plaza-senayan', nama: 'Plaza Senayan, Jl. Asia Afrika', area: 'Gelora, Kec. Tanah Abang, Kota Jakarta Pusat', lat: -6.2254, lon: 106.7993 },
  { id: 'gbk', nama: 'Gelora Bung Karno (GBK)', area: 'Gelora, Kec. Tanah Abang, Kota Jakarta Pusat', lat: -6.2186, lon: 106.8018 },
  { id: 'scbd', nama: 'SCBD & Pacific Place, Jl. Jend. Sudirman', area: 'Senayan, Kec. Kebayoran Baru, Kota Jakarta Selatan', lat: -6.2243, lon: 106.8097 },
  { id: 'kuningan', nama: 'Jl. H.R. Rasuna Said, Kuningan', area: 'Karet Kuningan, Kec. Setiabudi, Kota Jakarta Selatan', lat: -6.2297, lon: 106.8295 },
  { id: 'kota-kasablanka', nama: 'Kota Kasablanka (Kokas), Jl. Casablanca Raya', area: 'Menteng Dalam, Kec. Tebet, Kota Jakarta Selatan', lat: -6.2241, lon: 106.8422 },
  { id: 'manggarai', nama: 'Stasiun Manggarai', area: 'Manggarai, Kec. Tebet, Kota Jakarta Selatan', lat: -6.2099, lon: 106.8502 },
  { id: 'blokm', nama: 'Blok M & M Bloc Space', area: 'Kramat Pela, Kec. Kebayoran Baru, Kota Jakarta Selatan', lat: -6.2441, lon: 106.8003 },
  { id: 'gandaria-city', nama: 'Gandaria City, Jl. Sultan Iskandar Muda', area: 'Kebayoran Lama Utara, Kec. Kebayoran Lama, Kota Jakarta Selatan', lat: -6.2442, lon: 106.7835 },
  { id: 'pim', nama: 'Pondok Indah Mall (PIM)', area: 'Pondok Pinang, Kec. Kebayoran Lama, Kota Jakarta Selatan', lat: -6.2655, lon: 106.7844 },
  { id: 'kemang', nama: 'Jl. Kemang Raya', area: 'Bangka, Kec. Mampang Prapatan, Kota Jakarta Selatan', lat: -6.2607, lon: 106.8137 },
  { id: 'tb-simatupang', nama: 'Jl. TB Simatupang', area: 'Cilandak Timur, Kec. Pasar Minggu, Kota Jakarta Selatan', lat: -6.2920, lon: 106.8139 },
  { id: 'kelapa-gading', nama: 'Mall Kelapa Gading, Jl. Boulevard Raya', area: 'Kelapa Gading Timur, Kec. Kelapa Gading, Kota Jakarta Utara', lat: -6.1588, lon: 106.9057 },
  { id: 'ancol', nama: 'Taman Impian Jaya Ancol', area: 'Ancol, Kec. Pademangan, Kota Jakarta Utara', lat: -6.1255, lon: 106.8307 },
  { id: 'pik', nama: 'Pantai Indah Kapuk (PIK)', area: 'Kamal Muara, Kec. Penjaringan, Kota Jakarta Utara', lat: -6.1090, lon: 106.7405 },
  { id: 'tanjung-priok', nama: 'Tanjung Priok', area: 'Kec. Tanjung Priok, Kota Jakarta Utara', lat: -6.1045, lon: 106.8800 },
  { id: 'kota-tua', nama: 'Kota Tua Jakarta, Jl. Taman Fatahillah', area: 'Pinangsia, Kec. Taman Sari, Kota Jakarta Barat', lat: -6.1352, lon: 106.8133 },
  { id: 'grogol', nama: 'Jl. Kyai Tapa, Grogol', area: 'Tomang, Kec. Grogol Petamburan, Kota Jakarta Barat', lat: -6.1668, lon: 106.7896 },
  { id: 'central-park', nama: 'Central Park & Mall Taman Anggrek', area: 'Tanjung Duren Selatan, Kec. Grogol Petamburan, Kota Jakarta Barat', lat: -6.1774, lon: 106.7907 },
  { id: 'kembangan', nama: 'Puri Indah, Jl. Puri Agung', area: 'Kembangan Selatan, Kec. Kembangan, Kota Jakarta Barat', lat: -6.1890, lon: 106.7400 },
  { id: 'cengkareng', nama: 'Cengkareng', area: 'Kec. Cengkareng, Kota Jakarta Barat', lat: -6.1467, lon: 106.7322 },
  { id: 'cawang', nama: 'Simpang & Stasiun Cawang, Jl. Letjen M.T. Haryono', area: 'Cawang, Kec. Kramat Jati, Kota Jakarta Timur', lat: -6.2444, lon: 106.8697 },
  { id: 'halim', nama: 'Bandara & Stasiun Whoosh Halim', area: 'Halim Perdanakusuma, Kec. Makasar, Kota Jakarta Timur', lat: -6.2666, lon: 106.8912 },
  { id: 'rawamangun', nama: 'Jl. Pemuda, Rawamangun', area: 'Rawamangun, Kec. Pulo Gadung, Kota Jakarta Timur', lat: -6.1962, lon: 106.8800 },
  { id: 'cakung', nama: 'Cakung', area: 'Kec. Cakung, Kota Jakarta Timur', lat: -6.1866, lon: 106.9405 },
  { id: 'kampus-ui', nama: 'Universitas Indonesia (Kampus UI Depok)', area: 'Pondok Cina, Kec. Beji, Kota Depok, Jawa Barat', lat: -6.3617, lon: 106.8272 },
  { id: 'soetta', nama: 'Bandara Internasional Soekarno-Hatta', area: 'Pajang, Kec. Benda, Kota Tangerang, Banten', lat: -6.1256, lon: 106.6559 },
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
const MAX_CLIENT_CACHE = 160;

/**
 * Ekstraksi micro-unit sisi klien (Blok, No., RT/RW, Kavling, Lantai) untuk
 * memperkaya hasil lokal ketika pengguna mengetik detail unit.
 */
function extractClientMicroUnit(raw) {
  const str = String(raw || '').trim();
  const microRegex =
    /\b((?:blok|block|no|nomor|rt|rw|kav|kavling|unit|lt|lantai)\b\s*[.:/-]?\s*[a-z0-9]+(?:\s+[a-z0-9/-]+)?)/gi;
  const matches = [];
  let m;
  while ((m = microRegex.exec(str)) !== null) {
    matches.push(m[1].trim());
  }
  const microUnit = matches.join(', ');
  const cleanQuery = str
    .replace(microRegex, '')
    .replace(/\b(?:jl|jln)\.?\s+/gi, 'Jl. ')
    .replace(/,\s*,+/g, ',')
    .replace(/^,\s*|\s*,\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { microUnit, cleanQuery };
}

/**
 * Mendaftarkan lokasi dinamis hasil pencarian geocoding
 * @param {Tempat} place
 */
export function registerCustomPlace(place) {
  if (place && place.id) {
    const normalized = {
      ...place,
      nama: place.headline || place.nama || '',
      area: place.subtitle || place.area || '',
      headline: place.headline || place.nama || '',
      subtitle: place.subtitle || place.area || '',
    };
    customPlaces.set(normalized.id, normalized);
  }
}

/**
 * Mencari satu tempat berdasarkan id.
 * @param {string} id
 * @returns {Tempat|null}
 */
export function findPlaceById(id) {
  if (!id) return null;
  if (customPlaces.has(id)) return customPlaces.get(id);
  return JAKARTA_PLACES.find((p) => p.id === id) || null;
}

/**
 * Mencari tempat berdasarkan teks yang diketik pengguna (pencarian lokal).
 * Mendukung dekonstruksi micro-unit (Blok/No/Kav) ala Kalceria.
 *
 * @param {string} teks
 * @param {number} [maks=6] jumlah saran paling banyak yang dikembalikan
 * @returns {Tempat[]}
 */
export function searchPlaces(teks, maks = 6) {
  const raw = String(teks || '').trim();
  if (!raw) return JAKARTA_PLACES.slice(0, maks);

  const { microUnit, cleanQuery } = extractClientMicroUnit(raw);
  const kunci = (cleanQuery || raw).toLowerCase();

  const customHits = Array.from(customPlaces.values()).filter((p) =>
    `${p.nama} ${p.area}`.toLowerCase().includes(kunci)
  );

  const presetHits = JAKARTA_PLACES.filter((p) =>
    `${p.nama} ${p.area}`.toLowerCase().includes(kunci)
  );

  const combined = [...customHits, ...presetHits];
  combined.sort((a, b) => {
    const aStarts = a.nama.toLowerCase().startsWith(kunci) ? 0 : 1;
    const bStarts = b.nama.toLowerCase().startsWith(kunci) ? 0 : 1;
    return aStarts - bStarts;
  });

  const unique = [];
  for (const item of combined) {
    if (!unique.some((u) => u.id === item.id || u.nama.toLowerCase() === item.nama.toLowerCase())) {
      if (microUnit && !item.nama.toLowerCase().includes(microUnit.toLowerCase())) {
        const enriched = {
          ...item,
          id: `${item.id}-${microUnit.replace(/\W+/g, '').toLowerCase()}`,
          nama: `${item.nama}, ${microUnit}`,
          headline: `${item.nama}, ${microUnit}`,
          subtitle: item.area,
        };
        registerCustomPlace(enriched);
        unique.push(enriched);
      } else {
        unique.push(item);
      }
      if (unique.length >= maks) break;
    }
  }
  return unique;
}

/**
 * Mencari lokasi secara dinamis menggunakan Geocoding & Address Parser Kalceria di backend.
 * Mendukung pencarian perumahan, gang, jalan spesifik, blok/nomor rumah, dan koordinat.
 *
 * @param {string} teks
 * @param {number} [maks=7]
 * @param {AbortSignal} [signal]
 * @returns {Promise<Tempat[]>}
 */
export async function searchPlacesLive(teks, maks = 7, signal) {
  const kunci = String(teks || '').trim();
  if (!kunci) return JAKARTA_PLACES.slice(0, maks);

  const cacheKey = kunci.toLowerCase();
  if (clientGeocodeCache.has(cacheKey)) {
    return clientGeocodeCache.get(cacheKey);
  }

  const localHits = searchPlaces(kunci, maks);
  if (kunci.length < 2) {
    return localHits;
  }

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
        const normalizedPlaces = data.places.map((p) => ({
          ...p,
          nama: p.headline || p.nama || '',
          area: p.subtitle || p.area || '',
          headline: p.headline || p.nama || '',
          subtitle: p.subtitle || p.area || '',
        }));
        normalizedPlaces.forEach((p) => registerCustomPlace(p));

        const hasil = [...normalizedPlaces];
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

/**
 * Menerjemahkan koordinat GPS pengguna menjadi alamat jalan presisi (Reverse Geocode).
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Tempat>}
 */
export async function reverseGeocodeLive(lat, lon) {
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    if (res.ok) {
      const data = await res.json();
      const rawPlace = data.place || data;
      if (rawPlace && rawPlace.id) {
        const place = {
          ...rawPlace,
          nama: rawPlace.headline || rawPlace.nama || `Lokasi Saya (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
          area: rawPlace.subtitle || rawPlace.area || 'Titik GPS Saat Ini',
          lat: Number(rawPlace.lat ?? lat),
          lon: Number(rawPlace.lon ?? lon),
        };
        registerCustomPlace(place);
        return place;
      }
    }
  } catch (err) {
    console.warn('[reverseGeocodeLive] Fallback koordinat GPS:', err.message);
  }

  const fallback = {
    id: `gps-${lat.toFixed(4)}-${lon.toFixed(4)}`,
    nama: `Lokasi Saya (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
    area: 'Titik GPS Saat Ini',
    lat: Number(lat),
    lon: Number(lon),
  };
  registerCustomPlace(fallback);
  return fallback;
}
