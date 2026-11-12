/**
 * Indonesian Address Parser & Hierarchical Location Compositor
 *
 * 1. Deconstructs granular Indonesian addresses (Perumahan, Komplek, Cluster, Gang,
 *    Blok, No., RT/RW, Kavling, Lantai) into clean geocoding candidates so OSM/Photon/ArcGIS
 *    do not fail on unindexed micro-units.
 * 2. Resolves administrative boundary discrepancies across DKI Jakarta & Jabodetabek.
 * 3. Re-composes the geocoded coordinates with the user's original micro-unit and estate details.
 */

import crypto from 'node:crypto';

export const INDONESIAN_PROVINCES = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Kepulauan Riau',
  'Jambi', 'Sumatera Selatan', 'Kepulauan Bangka Belitung', 'Bengkulu', 'Lampung',
  'DKI Jakarta', 'Jawa Barat', 'Jawa Tengah', 'Daerah Istimewa Yogyakarta', 'Jawa Timur',
  'Banten', 'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur',
  'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara',
  'Sulawesi Utara', 'Gorontalo', 'Sulawesi Tengah', 'Sulawesi Barat', 'Sulawesi Selatan', 'Sulawesi Tenggara',
  'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Selatan', 'Papua Tengah',
  'Papua Pegunungan', 'Papua Barat Daya',
];

export const ID_BOUNDS = { minLat: -11.2, maxLat: 6.2, minLon: 94.9, maxLon: 141.1 };
export const JABODETABEK_BOUNDS = { minLat: -6.75, maxLat: -5.95, minLon: 106.45, maxLon: 107.25 };

const LOCATION_HMAC_SECRET =
  process.env.LOCATION_HMAC_SECRET ||
  process.env.JWT_SECRET ||
  'jaksafe-geo-validation-secret';

export function isWithinIndonesiaBounds(lat, lon) {
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return false;
  return (
    nLat >= ID_BOUNDS.minLat &&
    nLat <= ID_BOUNDS.maxLat &&
    nLon >= ID_BOUNDS.minLon &&
    nLon <= ID_BOUNDS.maxLon
  );
}

export function signLocationToken(formatted, lat = '', lon = '') {
  const norm = String(formatted || '').trim().toLowerCase();
  const latStr = lat !== '' && lat !== null && lat !== undefined ? Number(lat).toFixed(4) : '';
  const lonStr = lon !== '' && lon !== null && lon !== undefined ? Number(lon).toFixed(4) : '';
  return crypto
    .createHmac('sha256', LOCATION_HMAC_SECRET)
    .update(`${norm}:${latStr}:${lonStr}`)
    .digest('hex');
}

/**
 * 1. DECONSTRUCTOR:
 * Splits "Perumahan Green Permata, Blok Olive 9, Pesanggrahan" into:
 * - estateOrComplex: "Perumahan Green Permata"
 * - microUnit: "Blok Olive 9"
 * - searchCandidates: ordered from most specific to broadest so OSM doesn't choke on "Blok Olive 9"
 */
export function deconstructIndonesianAddress(rawQuery) {
  const raw = String(rawQuery || '').trim();
  if (!raw) return { raw: '', estateOrComplex: '', microUnit: '', searchCandidates: [] };

  // Extract micro-unit details (Blok X, No. Y, RT/RW, Kavling, Unit, Lantai)
  const microRegex =
    /\b((?:blok|block|no|nomor|rt|rw|kav|kavling|unit|lt|lantai)\b\s*[.:/-]?\s*[a-z0-9]+(?:\s+[a-z0-9/-]+)?)/gi;
  const microMatches = [];
  let match;
  while ((match = microRegex.exec(raw)) !== null) {
    microMatches.push(match[1].trim());
  }
  const microUnit = microMatches.join(', ');

  // Extract explicit Estate / Perumahan / Cluster / Apartemen / Gedung name if typed by user
  const estateRegex =
    /\b((?:perumahan|perum|komplek|komp|cluster|apartemen|apt|villa|graha|griyo|griya|pesona|taman|ruko|gedung|menara|wisma)\s+[a-z0-9\s.'-]+?)(?=,|$|\b(?:blok|block|no|nomor|rt|rw|kav|kavling|unit|lt|lantai|jl|jln|jalan)\b)/i;
  const estateMatch = raw.match(estateRegex);
  const estateOrComplex = estateMatch ? estateMatch[1].trim() : '';

  // Remove micro-unit details (like "Blok Olive 9" or "No. 12") from the geocoder search string
  // because OSM does not index individual block/house numbers in Indonesia
  const withoutMicro = raw
    .replace(microRegex, '')
    .replace(/\b(?:jl|jln)\.?\s+/gi, 'Jalan ')
    .replace(/\bgg\.?\s+/gi, 'Gang ')
    .replace(/,\s*,+/g, ',')
    .replace(/^,\s*|\s*,\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip the word "Perumahan/Komplek/Cluster" for an alternative search candidate
  // because OSM often names the polygon "Green Permata" instead of "Perumahan Green Permata"
  const coreNameQuery = withoutMicro
    .replace(/\b(?:perumahan|perum|komplek|komp|cluster)\s+/gi, '')
    .trim();

  // Split comma segments so if "Green Permata, Pesanggrahan" fails, we can search segments
  const segments = withoutMicro
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

  const candidates = new Set();
  if (withoutMicro.length >= 2) candidates.add(withoutMicro);
  if (coreNameQuery.length >= 2) candidates.add(coreNameQuery);

  if (segments.length >= 2) {
    const firstCore = segments[0].replace(/\b(?:perumahan|perum|komplek|komp|cluster)\s+/gi, '').trim();
    if (firstCore.length >= 3) candidates.add(firstCore);
    candidates.add(`${firstCore} ${segments[segments.length - 1]}`);
    candidates.add(segments[segments.length - 1]);
  }

  // Also extract "Jalan ..." or "Gang ..." street name if present
  const jalanMatch = withoutMicro.match(/\b((?:Jalan|Gang)\s+[a-z0-9\s.'-]+?)(?=,|$)/i);
  if (jalanMatch && jalanMatch[1].trim().length >= 5) {
    candidates.add(jalanMatch[1].trim());
  }

  return {
    raw,
    estateOrComplex,
    microUnit,
    searchCandidates: Array.from(candidates),
  };
}

/**
 * Builds search candidates for geocoding queries, maintaining backwards compatibility
 */
export function buildIndonesianSearchCandidates(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return [];

  if (/^jl\.?$/i.test(raw)) {
    return ['Jalan Raya'];
  }

  const deconstructed = deconstructIndonesianAddress(raw);
  const candidates = new Set(deconstructed.searchCandidates);

  const cleaned = raw
    .replace(/\b(?:jl|jln)\.?\s+/gi, 'Jalan ')
    .replace(/\b(?:rt|rw)\s*\/?\s*\d+\s*\/?\s*\d*/gi, '')
    .replace(/\bno\.?\s*\d+[a-z]?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length >= 3) {
    candidates.add(cleaned);
  }

  const streetMatch = cleaned.match(/Jalan\s+[a-z0-9\s]+?(?=,|$)/i);
  if (streetMatch && streetMatch[0].trim().length >= 5) {
    candidates.add(streetMatch[0].trim());
  }

  return Array.from(candidates);
}

/**
 * Fixes province mismatches (like Jakarta Selatan / Pesanggrahan showing "Banten")
 */
export function resolveAccurateProvince(rawProvince, city = '', district = '') {
  const combined = `${city} ${district} ${rawProvince}`.toLowerCase();

  // Strict override: Any Jakarta administrative city/kecamatan is ALWAYS DKI Jakarta
  if (
    /jakarta\s+(selatan|pusat|barat|timur|utara)|kepulauan\s+seribu|pesanggrahan|kebayoran|cilandak|tebet|setiabudi|mampang|pancoran|jagakarsa|pasar\s+minggu|menteng|gambir|tanah\s+abang|senen|cempaka\s+putih|johar\s+baru|kemayoran|sawah\s+besar|kebon\s+jeruk|palmerah|grogol|taman\s+sari|tambora|kalideres|cengkareng|kembangan|penjaringan|pademangan|tanjung\s+priok|koja|kelapa\s+gading|cilincing|matraman|pulo\s+gadung|jatinegara|duren\s+sawit|kramat\s+jati|makasar|pasar\s+rebo|ciracas|cipayung|cakung/i.test(
      combined
    )
  ) {
    return 'DKI Jakarta';
  }
  if (/kota\s+depok|depok|kota\s+bekasi|kabupaten\s+bekasi|bekasi|kota\s+bogor|kabupaten\s+bogor|bogor|kota\s+bandung/i.test(combined)) {
    return 'Jawa Barat';
  }
  if (/tangerang|bintaro|serpong|bsd|ciputat|pamulang|cilegon|serang|lebak|pandeglang/i.test(combined)) {
    return 'Banten';
  }
  if (/yogyakarta|sleman|bantul|kulon\s+progo|gunung\s+kidul/i.test(combined)) {
    return 'Daerah Istimewa Yogyakarta';
  }

  const pLower = String(rawProvince || '').toLowerCase();
  const found = INDONESIAN_PROVINCES.find(
    (p) => p.toLowerCase() === pLower || pLower.includes(p.toLowerCase())
  );
  return found || rawProvince || 'DKI Jakarta';
}

/**
 * 2. FULL HIERARCHY EXTRACTOR + RE-COMPOSITOR:
 * Extracts Perumahan -> Jalan -> Kelurahan -> Kecamatan -> Kota -> Provinsi
 * AND re-attaches the user's "Blok Olive 9" / "Perumahan Green Permata" so nothing is lost.
 */
export function composeDetailedIndonesianLocation(osmData, deconstructed = {}) {
  const {
    name = '',
    road = '',
    residential = '',
    neighbourhood = '',
    kelurahan = '',
    kecamatan = '',
    city = '',
    province = '',
    lat = 0,
    lon = 0,
    sourceId,
  } = osmData;

  const { estateOrComplex = '', microUnit = '' } = deconstructed;
  const trueProvince = resolveAccurateProvince(province, city, kecamatan);

  // Determine the most specific place/estate name
  let primaryPlace = residential || neighbourhood || name || '';
  if (
    estateOrComplex &&
    (!primaryPlace ||
      primaryPlace.toLowerCase() === kecamatan.toLowerCase() ||
      primaryPlace.toLowerCase() === kelurahan.toLowerCase())
  ) {
    primaryPlace = estateOrComplex;
  }

  // Build Headline (Line 1 in dropdown):
  // e.g. "Perumahan Green Permata, Blok Olive 9, Jl. Swadarma Raya"
  const headlineParts = [];
  if (primaryPlace) headlineParts.push(primaryPlace);
  if (microUnit && !primaryPlace.toLowerCase().includes(microUnit.toLowerCase())) {
    headlineParts.push(microUnit);
  }
  if (road && road.toLowerCase() !== primaryPlace.toLowerCase()) {
    headlineParts.push(road);
  }

  // Build Administrative Subtitle (Line 2 in dropdown):
  // e.g. "Ulujami, Kec. Pesanggrahan, Kota Jakarta Selatan, DKI Jakarta"
  const adminParts = [];
  if (kelurahan) adminParts.push(kelurahan);
  if (kecamatan && kecamatan.toLowerCase() !== kelurahan.toLowerCase()) {
    adminParts.push(kecamatan.startsWith('Kec.') ? kecamatan : `Kec. ${kecamatan}`);
  }
  if (
    city &&
    city.toLowerCase() !== kecamatan.toLowerCase() &&
    !city.toLowerCase().includes('daerah khusus ibukota')
  ) {
    adminParts.push(city);
  }
  if (trueProvince) {
    adminParts.push(trueProvince);
  }

  // Deduplicate across headline and adminParts
  const headline = headlineParts.join(', ') || adminParts[0] || '';
  const subtitle = adminParts.filter((p) => p.toLowerCase() !== headline.toLowerCase()).join(', ') || trueProvince;
  const fullFormatted = [headline, subtitle].filter(Boolean).join(', ');

  const token = signLocationToken(fullFormatted, lat, lon);
  const id = sourceId
    ? (microUnit ? `${sourceId}-${crypto.createHash('md5').update(microUnit).digest('hex').slice(0, 6)}` : sourceId)
    : `id-${crypto.createHash('md5').update(`${fullFormatted}:${lat}:${lon}`).digest('hex').slice(0, 10)}`;

  return {
    id,
    // Kalceria specification fields
    headline,
    subtitle,
    formatted: fullFormatted,
    selectionToken: token,
    estate: primaryPlace,
    unit: microUnit,
    road,
    kelurahan,
    kecamatan,
    city,
    province: trueProvince,
    // JakSafe contract fields
    nama: headline,
    area: subtitle,
    alamatLengkap: fullFormatted,
    lat: Number(lat),
    lon: Number(lon),
  };
}

