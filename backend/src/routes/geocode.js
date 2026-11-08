import { Router } from 'express';

const router = Router();

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 300;
const FETCH_TIMEOUT_MS = 4000;
const geocodeCache = new Map();

/**
 * Katalog terkurasi lokasi populer, pusat perbelanjaan, stasiun, rumah sakit,
 * universitas, dan koridor jalan utama di DKI Jakarta & Jabodetabek.
 * Menjamin respons 0ms dan ketahanan 100% bahkan saat jaringan eksternal terganggu.
 */
const JAKARTA_GAZETTEER = [
  // Pusat Perbelanjaan & Landmark Utama
  { id: 'poi-grand-indonesia', nama: 'Grand Indonesia', area: 'Jl. M.H. Thamrin, Menteng, Jakarta Pusat', lat: -6.1950, lon: 106.8198, keywords: 'gi mall thamrin bundaran hi' },
  { id: 'poi-plaza-indonesia', nama: 'Plaza Indonesia', area: 'Jl. M.H. Thamrin, Menteng, Jakarta Pusat', lat: -6.1931, lon: 106.8219, keywords: 'pi mall thamrin bundaran hi' },
  { id: 'poi-thamrin-city', nama: 'Thamrin City', area: 'Jl. KH Mas Mansyur, Tanah Abang, Jakarta Pusat', lat: -6.1942, lon: 106.8157, keywords: 'tanah abang kebon melati' },
  { id: 'poi-sarinah', nama: 'Sarinah Thamrin', area: 'Jl. M.H. Thamrin, Gondangdia, Jakarta Pusat', lat: -6.1873, lon: 106.8235, keywords: 'sarinah menteng' },
  { id: 'poi-monas', nama: 'Monumen Nasional (Monas)', area: 'Gambir, Jakarta Pusat', lat: -6.1754, lon: 106.8272, keywords: 'monas medan merdeka gambir' },
  { id: 'poi-bundaran-hi', nama: 'Bundaran HI', area: 'Menteng, Jakarta Pusat', lat: -6.1944, lon: 106.8230, keywords: 'hotel indonesia thamrin sudirman' },
  { id: 'poi-tanah-abang', nama: 'Pasar Tanah Abang', area: 'Kampung Bali, Tanah Abang, Jakarta Pusat', lat: -6.1887, lon: 106.8117, keywords: 'blok a blok b tanah abang' },
  { id: 'poi-senayan-city', nama: 'Senayan City', area: 'Jl. Asia Afrika, Gelora, Jakarta Pusat', lat: -6.2272, lon: 106.7973, keywords: 'senci senayan' },
  { id: 'poi-plaza-senayan', nama: 'Plaza Senayan', area: 'Jl. Asia Afrika, Gelora, Jakarta Pusat', lat: -6.2254, lon: 106.7993, keywords: 'ps senayan' },
  { id: 'poi-gbk', nama: 'Gelora Bung Karno (GBK)', area: 'Senayan, Jakarta Pusat', lat: -6.2186, lon: 106.8018, keywords: 'stadion gbk senayan' },
  { id: 'poi-pacific-place', nama: 'Pacific Place & SCBD', area: 'SCBD, Jl. Jend. Sudirman, Jakarta Selatan', lat: -6.2243, lon: 106.8097, keywords: 'scbd sudirman central business district' },
  { id: 'poi-fx-sudirman', nama: 'fX Sudirman', area: 'Jl. Jend. Sudirman, Senayan, Jakarta Pusat', lat: -6.2246, lon: 106.8039, keywords: 'fx lifestyle sudirman' },
  { id: 'poi-kota-kasablanka', nama: 'Kota Kasablanka (Kokas)', area: 'Jl. Casablanca Raya, Tebet, Jakarta Selatan', lat: -6.2241, lon: 106.8422, keywords: 'kokas tebet kuningan casablanca' },
  { id: 'poi-lotter-avenue', nama: 'Lotte Shopping Avenue', area: 'Ciputra World, Kuningan, Jakarta Selatan', lat: -6.2238, lon: 106.8229, keywords: 'kuningan satrio' },
  { id: 'poi-kuningan-city', nama: 'Kuningan City', area: 'Jl. Prof. DR. Satrio, Kuningan, Jakarta Selatan', lat: -6.2248, lon: 106.8296, keywords: 'kuncit satrio kuningan' },
  { id: 'poi-ambassador', nama: 'Mal Ambassador & ITC Kuningan', area: 'Jl. Prof. DR. Satrio, Kuningan, Jakarta Selatan', lat: -6.2239, lon: 106.8266, keywords: 'ambas itc kuningan' },
  { id: 'poi-blok-m-plaza', nama: 'Blok M Plaza & M Bloc Space', area: 'Kramat Pela, Kebayoran Baru, Jakarta Selatan', lat: -6.2441, lon: 106.7995, keywords: 'blok m square m bloc melawai' },
  { id: 'poi-gandaria-city', nama: 'Gandaria City (Gancit)', area: 'Kebayoran Lama, Jakarta Selatan', lat: -6.2442, lon: 106.7835, keywords: 'gancit sultan iskandar muda' },
  { id: 'poi-pim', nama: 'Pondok Indah Mall (PIM 1/2/3)', area: 'Pondok Pinang, Kebayoran Lama, Jakarta Selatan', lat: -6.2655, lon: 106.7844, keywords: 'pim pondok indah' },
  { id: 'poi-kemang-village', nama: 'Lippo Mall Kemang', area: 'Jl. Pangeran Antasari, Kemang, Jakarta Selatan', lat: -6.2615, lon: 106.8124, keywords: 'kemvil kemang antasari' },
  { id: 'poi-cilandak-town-square', nama: 'Cilandak Town Square (Citos)', area: 'Jl. TB Simatupang, Cilandak, Jakarta Selatan', lat: -6.2916, lon: 106.7998, keywords: 'citos tb simatupang' },
  { id: 'poi-aeon-tanjung-barat', nama: 'AEON Mall Tanjung Barat', area: 'Jl. Raya Tanjung Barat, Jagakarsa, Jakarta Selatan', lat: -6.3061, lon: 106.8398, keywords: 'aeon lenteng agung pasar minggu' },
  { id: 'poi-central-park', nama: 'Central Park & Neo Soho', area: 'Jl. Letjen S. Parman, Tanjung Duren, Jakarta Barat', lat: -6.1774, lon: 106.7907, keywords: 'cp grogol podomoro city' },
  { id: 'poi-taman-anggrek', nama: 'Mall Taman Anggrek', area: 'Jl. Letjen S. Parman, Tanjung Duren, Jakarta Barat', lat: -6.1786, lon: 106.7922, keywords: 'mta grogol slipi' },
  { id: 'poi-puri-indah', nama: 'Puri Indah Mall & Lippo Mall Puri', area: 'Kembangan, Jakarta Barat', lat: -6.1886, lon: 106.7388, keywords: 'puri kembangan' },
  { id: 'poi-kota-tua', nama: 'Kawasan Kota Tua Jakarta', area: 'Pinangsia, Taman Sari, Jakarta Barat', lat: -6.1352, lon: 106.8133, keywords: 'fatahillah glodok mangga dua' },
  { id: 'poi-kelapa-gading', nama: 'Mall Kelapa Gading (MKG)', area: 'Kelapa Gading Timur, Jakarta Utara', lat: -6.1573, lon: 106.9082, keywords: 'mkg la piazza boulevard kelapa gading' },
  { id: 'poi-moi', nama: 'Mall of Indonesia (MOI)', area: 'Kelapa Gading Barat, Jakarta Utara', lat: -6.1516, lon: 106.8924, keywords: 'moi sunter kelapa gading' },
  { id: 'poi-pik-avenue', nama: 'PIK Avenue & Pantai Indah Kapuk', area: 'Penjaringan, Jakarta Utara', lat: -6.1090, lon: 106.7405, keywords: 'pik 1 pik 2 pantjoran golf island' },
  { id: 'poi-ancol', nama: 'Taman Impian Jaya Ancol & Dufan', area: 'Pademangan, Jakarta Utara', lat: -6.1255, lon: 106.8307, keywords: 'ancol dufan pantai' },
  { id: 'poi-jis', nama: 'Jakarta International Stadium (JIS)', area: 'Papanggo, Tanjung Priok, Jakarta Utara', lat: -6.1253, lon: 106.8605, keywords: 'jis sunter priok' },
  { id: 'poi-arion', nama: 'Arion Mall & Velodrome Rawamangun', area: 'Jl. Pemuda, Rawamangun, Jakarta Timur', lat: -6.1942, lon: 106.8891, keywords: 'rawamangun pemuda' },
  { id: 'poi-bassura', nama: 'Mall Bassura City', area: 'Jl. Jend. Basuki Rahmat, Jatinegara, Jakarta Timur', lat: -6.2255, lon: 106.8777, keywords: 'cipinang jatinegara' },
  { id: 'poi-tmii', nama: 'Taman Mini Indonesia Indah (TMII)', area: 'Cipayung, Jakarta Timur', lat: -6.3024, lon: 106.8952, keywords: 'tmii taman mini kramat jati' },

  // Stasiun, Bandara & Simpul Transportasi
  { id: 'st-gambir', nama: 'Stasiun Gambir', area: 'Gambir, Jakarta Pusat', lat: -6.1767, lon: 106.8306, keywords: 'kereta api gambir monas' },
  { id: 'st-manggarai', nama: 'Stasiun Manggarai', area: 'Manggarai, Tebet, Jakarta Selatan', lat: -6.2099, lon: 106.8502, keywords: 'krl manggarai tebet' },
  { id: 'st-sudirman', nama: 'Stasiun Sudirman & Dukuh Atas BNI City', area: 'Menteng, Jakarta Pusat', lat: -6.2024, lon: 106.8232, keywords: 'mrt lrt krl dukuh atas sudirman' },
  { id: 'st-pasar-senen', nama: 'Stasiun Pasar Senen', area: 'Senen, Jakarta Pusat', lat: -6.1748, lon: 106.8454, keywords: 'senen kereta' },
  { id: 'st-tanah-abang', nama: 'Stasiun Tanah Abang', area: 'Cideng, Tanah Abang, Jakarta Pusat', lat: -6.1856, lon: 106.8108, keywords: 'krl tanah abang' },
  { id: 'st-jakarta-kota', nama: 'Stasiun Jakarta Kota (Beos)', area: 'Pinangsia, Taman Sari, Jakarta Barat', lat: -6.1376, lon: 106.8146, keywords: 'kota tua beos' },
  { id: 'st-cawang', nama: 'Stasiun & Simpang Cawang', area: 'Cawang, Kramat Jati, Jakarta Timur', lat: -6.2426, lon: 106.8588, keywords: 'lrt cawang mt haryono' },
  { id: 'st-lebak-bulus', nama: 'Stasiun MRT Lebak Bulus Grab', area: 'Lebak Bulus, Cilandak, Jakarta Selatan', lat: -6.2894, lon: 106.7749, keywords: 'mrt lebak bulus ciputat' },
  { id: 'air-soetta', nama: 'Bandara Internasional Soekarno-Hatta (CGK)', area: 'Tangerang, Banten', lat: -6.1256, lon: 106.6559, keywords: 'bandara soetta cengkareng terminal 1 2 3' },
  { id: 'air-halim', nama: 'Bandara Halim Perdanakusuma & Stasiun Whoosh Halim', area: 'Makasar, Jakarta Timur', lat: -6.2666, lon: 106.8912, keywords: 'halim kcjb whoosh kereta cepat' },

  // Koridor Jalan & Kawasan Utama
  { id: 'jl-sudirman', nama: 'Jl. Jenderal Sudirman', area: 'Jakarta Pusat - Jakarta Selatan', lat: -6.2146, lon: 106.8211, keywords: 'semanggi bendungan hilir setiabudi' },
  { id: 'jl-thamrin', nama: 'Jl. M.H. Thamrin', area: 'Menteng, Jakarta Pusat', lat: -6.1912, lon: 106.8229, keywords: 'thamrin kebon sirih' },
  { id: 'jl-gatot-subroto', nama: 'Jl. Jenderal Gatot Subroto', area: 'Kuningan - Semanggi - Pancoran, Jakarta Selatan', lat: -6.2361, lon: 106.8266, keywords: 'gatsu semanggi pancoran' },
  { id: 'jl-rasuna-said', nama: 'Jl. H.R. Rasuna Said (Kuningan)', area: 'Setiabudi, Kuningan, Jakarta Selatan', lat: -6.2216, lon: 106.8322, keywords: 'kuningan setiabudi' },
  { id: 'jl-mt-haryono', nama: 'Jl. Letjen M.T. Haryono', area: 'Tebet - Cawang, Jakarta Selatan', lat: -6.2432, lon: 106.8531, keywords: 'pancoran cawang' },
  { id: 'jl-tb-simatupang', nama: 'Jl. TB Simatupang', area: 'Cilandak - Pasar Minggu, Jakarta Selatan', lat: -6.2920, lon: 106.8139, keywords: 'fatmawati ampera ragunan' },
  { id: 'jl-wahid-hasyim', nama: 'Jl. K.H. Wahid Hasyim', area: 'Menteng - Tanah Abang, Jakarta Pusat', lat: -6.1881, lon: 106.8205, keywords: 'sabang menteng' },
  { id: 'jl-mas-mansyur', nama: 'Jl. K.H. Mas Mansyur', area: 'Tanah Abang - Karet Tengsin, Jakarta Pusat', lat: -6.2015, lon: 106.8155, keywords: 'karet tanah abang' },
  { id: 'jl-kemang-raya', nama: 'Jl. Kemang Raya', area: 'Bangka, Mampang Prapatan, Jakarta Selatan', lat: -6.2607, lon: 106.8137, keywords: 'kemang timur mampang' },
  { id: 'jl-daan-mogot', nama: 'Jl. Daan Mogot', area: 'Grogol - Kalideres, Jakarta Barat', lat: -6.1563, lon: 106.7577, keywords: 'cengkareng grogol kalideres' },
  { id: 'jl-pramuka', nama: 'Jl. Pramuka & Matraman', area: 'Matraman - Cempaka Putih, Jakarta Pusat/Timur', lat: -6.1928, lon: 106.8639, keywords: 'salemba matraman rawamangun' },
  { id: 'jl-gunung-sahari', nama: 'Jl. Gunung Sahari & Kemayoran', area: 'Kemayoran - Sawah Besar, Jakarta Pusat', lat: -6.1568, lon: 106.8394, keywords: 'jiexpo kemayoran pasar baru' },

  // Kampus, Rumah Sakit & Kota Penyangga
  { id: 'edu-ui-salemba', nama: 'Universitas Indonesia (Kampus Salemba) & RSCM', area: 'Salemba, Senen, Jakarta Pusat', lat: -6.1955, lon: 106.8490, keywords: 'ui salemba rscm cipto mangunkusumo' },
  { id: 'edu-ui-depok', nama: 'Universitas Indonesia (Kampus UI Depok)', area: 'Beji, Depok, Jawa Barat', lat: -6.3617, lon: 106.8272, keywords: 'ui depok margonda' },
  { id: 'edu-binus', nama: 'Universitas Bina Nusantara (BINUS Kemanggisan)', area: 'Kebon Jeruk, Palmerah, Jakarta Barat', lat: -6.2018, lon: 106.7823, keywords: 'binus anggrek syahdan' },
  { id: 'edu-trisakti', nama: 'Universitas Trisakti & UNTAR', area: 'Jl. Kyai Tapa, Grogol, Jakarta Barat', lat: -6.1675, lon: 106.7901, keywords: 'trisakti tarumanagara grogol' },
  { id: 'sat-bsd', nama: 'BSD City & AEON Mall BSD', area: 'Serpong, Tangerang Selatan', lat: -6.3016, lon: 106.6435, keywords: 'bsd serpong ice bsd' },
  { id: 'sat-bintaro', nama: 'Bintaro Jaya Xchange (BXc)', area: 'Pondok Aren, Tangerang Selatan', lat: -6.2852, lon: 106.7279, keywords: 'bintaro sektor 7 sektor 9' },
  { id: 'sat-alam-sutera', nama: 'Alam Sutera & Mall @ Alam Sutera', area: 'Pinang, Tangerang', lat: -6.2233, lon: 106.6531, keywords: 'alsut ikea alam sutera' },
  { id: 'sat-summarecon-bekasi', nama: 'Summarecon Mall Bekasi', area: 'Bekasi Utara, Kota Bekasi', lat: -6.2260, lon: 107.0010, keywords: 'smb bekasi barat' },
];

/**
 * Mencari kecocokan pada katalog lokal Jakarta & Jabodetabek.
 */
function matchLocalGazetteer(query, limit = 6) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored = [];
  for (const item of JAKARTA_GAZETTEER) {
    const namaLower = item.nama.toLowerCase();
    const areaLower = item.area.toLowerCase();
    const haystack = `${namaLower} ${areaLower} ${item.keywords || ''}`.toLowerCase();

    let score = 0;
    if (namaLower === q) score += 100;
    else if (namaLower.startsWith(q)) score += 80;
    else if (namaLower.includes(q)) score += 60;
    else if (haystack.includes(q)) score += 40;
    else if (tokens.length > 1 && tokens.every((t) => haystack.includes(t))) score += 35;

    if (score > 0) {
      scored.push({ score, item });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => ({
      id: item.id,
      nama: item.nama,
      area: item.area,
      lat: item.lat,
      lon: item.lon,
    }));
}

/**
 * Helper fetch dengan batas waktu ketat agar tidak pernah menggantung koneksi proxy.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider 1: Google Maps Geocoding API (jika GOOGLE_MAPS_API_KEY tersedia)
 */
async function queryGoogleGeocoder(query, googleKey) {
  if (!googleKey) return [];
  const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:ID&language=id&key=${encodeURIComponent(googleKey)}`;
  const gRes = await fetchWithTimeout(gUrl);
  if (!gRes.ok) return [];
  const gData = await gRes.json();
  if (gData.status !== 'OK' || !Array.isArray(gData.results)) return [];
  return gData.results.slice(0, 6).map((item, idx) => {
    const loc = item.geometry?.location || {};
    const parts = String(item.formatted_address || '').split(',');
    const nama = parts[0]?.trim() || item.formatted_address;
    const area = parts.slice(1, 3).join(',').trim() || 'DKI Jakarta';
    return {
      id: `gmaps-${item.place_id || idx}`,
      nama,
      area,
      alamatLengkap: item.formatted_address,
      lat: Number(loc.lat),
      lon: Number(loc.lng),
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Provider 2: ArcGIS World Geocoding Service (CDN global IPv4, sangat cepat di Indonesia, tanpa API key)
 */
async function queryArcGisGeocoder(query) {
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates`
    + `?SingleLine=${encodeURIComponent(query)}&countryCode=IDN&location=106.8272,-6.1754`
    + `&outFields=PlaceName,Place_addr,Type&maxLocations=6&f=json`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'JakSafe-Navigation-App/1.0' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  return candidates.map((c, idx) => {
    const attrs = c.attributes || {};
    const rawAddr = String(attrs.Place_addr || c.address || '').trim();
    const parts = rawAddr.split(',').map((s) => s.trim()).filter(Boolean);
    const nama = attrs.PlaceName || parts[0] || c.address || query;
    const area = parts.filter((p) => p.toLowerCase() !== nama.toLowerCase()).slice(0, 3).join(', ') || 'DKI Jakarta';
    const lat = Number(c.location?.y);
    const lon = Number(c.location?.x);
    return {
      id: `arcgis-${idx}-${lat.toFixed(4)}-${lon.toFixed(4)}`,
      nama,
      area,
      lat,
      lon,
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Provider 3: OpenStreetMap Photon
 */
async function queryPhotonGeocoder(query) {
  const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=-6.2088&lon=106.8456&limit=6&lang=en`;
  const pRes = await fetchWithTimeout(photonUrl, {
    headers: { 'User-Agent': 'JakSafe-Navigation-App/1.0' },
  });
  if (!pRes.ok) return [];
  const pData = await pRes.json();
  const features = Array.isArray(pData?.features) ? pData.features : [];
  return features.map((f, idx) => {
    const props = f.properties || {};
    const [lon, lat] = f.geometry?.coordinates || [NaN, NaN];
    const nama = props.name || props.street || query;
    const areaParts = [props.district, props.city || props.county, props.state].filter(Boolean);
    const area = areaParts.length > 0 ? areaParts.join(', ') : 'Indonesia';
    return {
      id: `osm-${props.osm_id || idx}`,
      nama,
      area,
      lat: Number(lat),
      lon: Number(lon),
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Provider 4: OpenStreetMap Nominatim
 */
async function queryNominatimGeocoder(query) {
  const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=id&format=json&limit=5&addressdetails=1`;
  const nRes = await fetchWithTimeout(nomUrl, {
    headers: { 'User-Agent': 'JakSafe-Navigation-App/1.0' },
  });
  if (!nRes.ok) return [];
  const nData = await nRes.json();
  if (!Array.isArray(nData)) return [];
  return nData.map((item) => {
    const addr = item.address || {};
    const nama = item.name || addr.road || addr.suburb || query;
    const area = [addr.suburb || addr.city_district, addr.city || addr.regency].filter(Boolean).join(', ') || 'Jakarta';
    return {
      id: `nom-${item.place_id}`,
      nama,
      area,
      lat: Number(item.lat),
      lon: Number(item.lon),
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Menggabungkan daftar tempat tanpa duplikasi nama/lokasi yang berdekatan.
 */
function mergePlaces(lists, max = 6) {
  const merged = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
      const isDup = merged.some((existing) => {
        const sameName = existing.nama.toLowerCase() === item.nama.toLowerCase();
        const closeBy = Math.hypot(existing.lat - item.lat, existing.lon - item.lon) < 0.003;
        return sameName && closeBy;
      });
      if (!isDup) {
        merged.push(item);
        if (merged.length >= max) return merged;
      }
    }
  }
  return merged;
}

/**
 * Endpoint Geocoding: Menerjemahkan nama jalan, gedung, mall, atau alamat spesifik
 * menjadi koordinat { lat, lon }.
 */
router.get('/', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ ok: false, error: 'Query q diperlukan' });
  }

  // 1. Cek apakah pengguna langsung mengetik koordinat angka
  const coordMatch = query.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
  if (coordMatch) {
    const a = Number(coordMatch[1]);
    const b = Number(coordMatch[2]);
    const lat = Math.abs(a) <= 90 && a < 15 ? a : b;
    const lon = lat === a ? b : a;
    return res.json({
      ok: true,
      source: 'coordinate',
      places: [
        {
          id: `coord-${lat.toFixed(4)}-${lon.toFixed(4)}`,
          nama: `Titik Koordinat [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
          area: 'Koordinat Kustom',
          lat,
          lon,
        },
      ],
    });
  }

  const cacheKey = query.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  // 2. Kecocokan katalog lokal Jakarta & Jabodetabek (instan 0ms)
  const localMatches = matchLocalGazetteer(query, 6);

  // Jika kueri pendek (< 3 huruf) atau sudah ada kecocokan persis di katalog lokal,
  // langsung kembalikan tanpa perlu membebani jaringan luar.
  if (query.length < 3 || (localMatches.length > 0 && localMatches[0].nama.toLowerCase().startsWith(cacheKey))) {
    if (localMatches.length >= 2 || (localMatches.length === 1 && localMatches[0].nama.toLowerCase().startsWith(cacheKey))) {
      const payload = { ok: true, source: 'jakarta-gazetteer', places: localMatches };
      geocodeCache.set(cacheKey, { payload, at: Date.now() });
      return res.json(payload);
    }
  }

  const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';
  let remotePlaces = [];
  let source = 'jakarta-gazetteer';

  // 3. Coba Google Maps Geocoding terlebih dahulu jika kunci tersedia
  if (googleKey) {
    try {
      const gPlaces = await queryGoogleGeocoder(query, googleKey);
      if (gPlaces.length > 0) {
        remotePlaces = gPlaces;
        source = 'google';
      }
    } catch {
      // Lanjut ke penyedia berikutnya secara senyap
    }
  }

  // 4. Jalankan ArcGIS World Geocoder & OSM Photon secara paralel (cepat & tahan blokir ISP)
  if (remotePlaces.length === 0) {
    const [arcRes, photonRes] = await Promise.allSettled([
      queryArcGisGeocoder(query),
      queryPhotonGeocoder(query),
    ]);

    const arcPlaces = arcRes.status === 'fulfilled' ? arcRes.value : [];
    const photonPlaces = photonRes.status === 'fulfilled' ? photonRes.value : [];

    if (arcPlaces.length > 0 || photonPlaces.length > 0) {
      remotePlaces = mergePlaces([arcPlaces, photonPlaces], 6);
      source = arcPlaces.length > 0 ? 'arcgis' : 'osm-photon';
    }
  }

  // 5. Fallback terakhir ke Nominatim hanya jika semua penyedia di atas kosong
  if (remotePlaces.length === 0 && localMatches.length === 0) {
    try {
      const nomPlaces = await queryNominatimGeocoder(query);
      if (nomPlaces.length > 0) {
        remotePlaces = nomPlaces;
        source = 'osm-nominatim';
      }
    } catch {
      // Abaikan jika Nominatim sedang tidak terjangkau
    }
  }

  const finalPlaces = mergePlaces([localMatches, remotePlaces], 6);
  const payload = {
    ok: true,
    source: finalPlaces.length > 0 ? source : 'none',
    places: finalPlaces,
  };

  if (finalPlaces.length > 0) {
    geocodeCache.set(cacheKey, { payload, at: Date.now() });
    if (geocodeCache.size > CACHE_MAX) {
      geocodeCache.delete(geocodeCache.keys().next().value);
    }
  }

  return res.json(payload);
});

export default router;
