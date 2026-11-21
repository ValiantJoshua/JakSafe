import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../src/data/cctvCatalog.json');
const BACKUP_PATH = path.resolve(__dirname, '../src/data/cctvCatalog.backup.json');

const NUSANTARA_MAX_CAMERAS = 30;
const MIN_DEDUP_METERS = 80; // Tidak boleh ada 2 kamera dalam radius 80m (anti tumpuk titik)
const NUSANTARA_SPACING_METERS = 1400; // Sebar merata kamera CCTV Nusantara minimal 1.4km antar titik
const MONAS_COORD = { lat: -6.1754, lon: 106.8272 };

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isTooClose(cam, list, minMeters) {
  return list.some((other) => haversineM(cam.lat, cam.lon, other.lat, other.lon) < minMeters);
}

/**
 * Cek cepat apakah URL snapshot mengembalikan gambar valid (bukan 404/500/svg offline).
 */
async function probeSnapshotLive(url, timeoutMs = 6000) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'image/*',
      },
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || !ct.startsWith('image/') || ct.includes('svg')) {
      await res.body?.cancel().catch(() => {});
      return false;
    }
    const reader = res.body?.getReader?.();
    if (reader) {
      const { done, value } = await reader.read();
      await reader.cancel().catch(() => {});
      return !done && Boolean(value && value.byteLength > 0);
    }
    return true;
  } catch {
    return false;
  }
}

// Koordinat referensi presisi untuk site Pemprov DKI Jakarta (JakCCTV)
const JAKCCTV_COORDS = {
  'JKP POLDA JPO JL. GATOT SUBROTO 7': { lat: -6.2238, lon: 106.8142, desc: 'JPO Gatot Subroto KM 7 (Depan Polda Metro Jaya / Semanggi)' },
  'JKP POLDA JL. GERBANG PEMUDA C02': { lat: -6.2132, lon: 106.7989, desc: 'Jl. Gerbang Pemuda (Kemenpora / Senayan)' },
  'JKP POLDA JL. GERBANG PEMUDA C03': { lat: -6.2140, lon: 106.8005, desc: 'Jl. Gerbang Pemuda (Pintu Barat GBK / TVRI)' },
  'JKP SATPOL PP JL. GERBANG PEMUDA C04': { lat: -6.2155, lon: 106.8020, desc: 'Jl. Gerbang Pemuda (Flyover Senayan / Lapangan Panahan)' },
  'JKP SATPOL PP JL. JEND. GATOT SUBROTO C11': { lat: -6.2365, lon: 106.8320, desc: 'Jl. Gatot Subroto (Simpang Kuningan / Mampang)' },
  'JKB SATPOL PP SIMPANG JL. LETJEN. S. PARMAN C07': { lat: -6.1867, lon: 106.7973, desc: 'Simpang Jl. Letjen S. Parman (Tomang / Slipi)' },
  'JKB SATPOL PP SIMPANG JL. LETJEN. S. PARMAN C08': { lat: -6.1895, lon: 106.7955, desc: 'Jl. Letjen S. Parman (Slipi Jaya / Kemanggisan)' },
  'JKP POLDA JL. JEND. GATOT SUBROTO C13': { lat: -6.2415, lon: 106.8395, desc: 'Jl. Gatot Subroto (Pancoran Barat / Medistra)' },
  'JKP POLDA JL. TENTARA PELAJAR C04': { lat: -6.2146, lon: 106.7945, desc: 'Jl. Tentara Pelajar (Stasiun Palmerah / DPR-MPR)' },
  'JKP POLDA JL. JEND. GATOT SUBROTO C14': { lat: -6.2320, lon: 106.8260, desc: 'Jl. Gatot Subroto (Gedung LIPI / Menara Mulia)' },
  'JKP DBM FLYOVER LADOKGI C01': { lat: -6.2115, lon: 106.8087, desc: 'Flyover Ladokgi RE Martadinata (Bendungan Hilir / Sudirman)' },
  'JKP SATPOL PP SIMPANG JL. MH. THAMRIN C07': { lat: -6.1885, lon: 106.8235, desc: 'Simpang Jl. MH Thamrin (Gedung Sarinah / Jl. Wahid Hasyim)' },
  'JKP SATPOL PP SIMPANG JL. MH. THAMRIN C08': { lat: -6.1929, lon: 106.8215, desc: 'Jl. MH Thamrin (Plaza Indonesia / Grand Hyatt)' },
  'JKP DISHUB JL. MH. THAMRIN C01': { lat: -6.1865, lon: 106.8238, desc: 'Jl. MH Thamrin (Kementerian Agama / Bank Indonesia)' },
  'JKP SATPOLPP JL. MH. THAMRIN C02': { lat: -6.1905, lon: 106.8228, desc: 'Jl. MH Thamrin (Kedutaan Prancis / Sinarmas Land)' },
  'JKP SATPOL PP SIMPANG JL. MH. THAMRIN C09': { lat: -6.1944, lon: 106.8230, desc: 'Bundaran HI (Hotel Indonesia Kempinski / Pos Polisi)' },
  'JKP POLRI UOB PLAZA C01': { lat: -6.1989, lon: 106.8223, desc: 'UOB Plaza Thamrin Nine (Kawasan Dukuh Atas)' },
  'Taman Literasi-C01': { lat: -6.2435, lon: 106.7989, desc: 'Taman Literasi Martha Tiahahu (Kawasan Blok M)' },
  'Simpang Jl. Panglima Polim-C01': { lat: -6.2468, lon: 106.7985, desc: 'Simpang Jl. Panglima Polim (Stasiun MRT Blok M BCA)' },
  'Jl. Sultan Agung-C03': { lat: -6.2074, lon: 106.8417, desc: 'Jl. Sultan Agung (Halte Pasar Rumput / Setiabudi)' },
  'Simpang Jl. Sultan Agung-C01': { lat: -6.2086, lon: 106.8455, desc: 'Simpang Jl. Sultan Agung (Stasiun Manggarai / Tambak)' },
  'Simpang Jl. Sultan Agung-C02': { lat: -6.2092, lon: 106.8468, desc: 'Jl. Sultan Agung arah Jatinegara (Flyover Manggarai)' },
  'Pasar Tanah Abang-C02': { lat: -6.1848, lon: 106.8139, desc: 'Kawasan Pasar Tanah Abang (Blok A / Jl. Fachrudin)' },
  'Jl. KH. Mas Mansyur-C02': { lat: -6.2095, lon: 106.8186, desc: 'Jl. KH. Mas Mansyur (Flyover Karet / Citywalk Sudirman)' },
  'Jl. Jati Baru Raya-C02': { lat: -6.1830, lon: 106.8140, desc: 'Jl. Jati Baru Raya (Stasiun Tanah Abang)' },
  'Simpang Jl Nurdin Raya C01': { lat: -6.1604, lon: 106.7937, desc: 'Simpang Jl. Dr. Nurdin Raya (Kawasan Grogol Petamburan)' },
  'Senayan 018': { lat: -6.2266, lon: 106.8080, desc: 'Jl. Asia Afrika (Senayan City / Plaza Senayan)' },
  'Senayan 001': { lat: -6.2215, lon: 106.8050, desc: 'Jl. Pintu Satu Senayan (Stadion GBK / FX Sudirman)' },
  'Bendungan Hilir 003': { lat: -6.2150, lon: 106.8179, desc: 'Jl. Bendungan Hilir (Pasar Benhil / Akses Sudirman)' },
  'Kebon Melati 010': { lat: -6.1975, lon: 106.8165, desc: 'Kawasan Waduk Kebon Melati (Waduk Melati / Jl. Teluk Betung)' },
};

/**
 * Sumber 1: Pemprov DKI Jakarta (JakCCTV / Balitower :7028)
 * Deduplikasi per lokasi unik (tidak menumpuk CCTV-01 & CCTV-02 di koordinat yang sama)
 * dan hanya mempertahankan kamera yang benar-benar merespons 200 image/*.
 */
async function scrapeJakCctv() {
  console.log('[Scraper] 1. Mengambil data CCTV publik Pemprov DKI (jakcctv.jakarta.go.id)...');
  const rawCameras = [];
  const seenIds = new Set();

  for (let page = 1; page <= 7; page++) {
    try {
      const res = await fetch(`https://jakcctv.jakarta.go.id/publik/data?page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const html = data.cards || '';

      const regex = /<iframe[^>]+src="([^"]+)"[\s\S]*?<div class="title">([^<]+)<\/div>[\s\S]*?<span class="badge">([^<]+)<\/span>/g;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const iframeSrc = match[1];
        const title = match[2].trim();
        const badge = match[3].trim();

        const streamMatch = iframeSrc.match(/https?:\/\/[^\/]+\/([^\/]+)\/embed\.html/);
        const streamName = streamMatch ? streamMatch[1] : null;
        if (!streamName) continue;

        const idSafe = streamName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const id = `jakcctv-${idSafe}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const ref = JAKCCTV_COORDS[title];
        if (!ref) continue; // Hindari fallback koordinat generik yang menumpuk di 1 titik

        rawCameras.push({
          id,
          name: `${title} (${badge})`,
          city: 'Jakarta',
          cityId: 'jakarta',
          provider: 'Pemprov DKI Jakarta (Balitower)',
          lat: ref.lat,
          lon: ref.lon,
          headingDeg: 180,
          pitchDeg: -20,
          fovDeg: 60,
          rangeM: 220,
          mountHeightM: 9,
          feedType: 'image',
          url: iframeSrc.replace('/embed.html', '/preview.jpg'),
          hlsUrl: iframeSrc.replace('/embed.html', '/index.m3u8'),
          embedUrl: iframeSrc,
          kategori: 'arteri',
          locationDesc: ref.desc,
          license: 'Sumber: JakCCTV Publik Pemprov DKI Jakarta',
        });
      }
    } catch (err) {
      console.warn(`[Scraper] Gagal mengambil halaman ${page} JakCCTV:`, err.message);
    }
  }

  // Ambil maksimal 1 kamera ONLINE per titik unik (radius 80m)
  const selected = [];
  for (const cam of rawCameras) {
    if (isTooClose(cam, selected, MIN_DEDUP_METERS)) continue;
    const ok = await probeSnapshotLive(cam.url);
    if (ok) {
      selected.push(cam);
    }
  }

  console.log(`[Scraper] JakCCTV: ${selected.length} kamera unik online (dari ${rawCameras.length} kandidat).`);
  return selected;
}

/**
 * Sumber 2: Sipantau DPUPR Kota Tangerang (Pos Duga Air & Banjir)
 * Menggunakan https://api.dpuprkotang.info/nuxt/posduga + detail koordinat presisi.
 */
async function scrapeSipantauTangerang(existingList) {
  console.log('[Scraper] 2. Mengambil data CCTV hidrologi/banjir Sipantau DPUPR Kota Tangerang...');
  const selected = [];

  try {
    const res = await fetch('https://api.dpuprkotang.info/nuxt/posduga', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const lokasiList = payload?.data?.lokasi || [];

    for (const loc of lokasiList) {
      const foto = loc?.sensor_record_latest?.foto;
      if (!foto || !loc?.id) continue;

      try {
        const dr = await fetch(`https://api.dpuprkotang.info/nuxt/posduga/${loc.id}`, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        if (!dr.ok) continue;
        const dd = await dr.json();
        const detail = dd?.data?.lokasi || {};
        const lat = Number(detail.lat);
        const lon = Number(detail.long);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lat < -6.45 || lat > -6.05 || lon < 106.55 || lon > 107.05) continue;

        const slug = String(loc.nama || loc.id)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

        const cam = {
          id: `sipantau-${slug}`,
          name: `Pos Pantau ${loc.nama}`,
          city: 'Tangerang',
          cityId: 'jakarta',
          provider: 'DPUPR Kota Tangerang (Sipantau)',
          lat,
          lon,
          headingDeg: 180,
          pitchDeg: -20,
          fovDeg: 65,
          rangeM: 220,
          mountHeightM: 7,
          feedType: 'image',
          url: foto,
          embedUrl: detail.cctv_hls || undefined,
          kategori: 'banjir',
          locationDesc: `Pos Duga Air & CCTV Banjir ${loc.nama} (Kota Tangerang)`,
          license: 'Sumber: Sipantau DPUPR Kota Tangerang (sipantau.dpuprkotang.info)',
        };

        if (isTooClose(cam, existingList, MIN_DEDUP_METERS) || isTooClose(cam, selected, MIN_DEDUP_METERS)) {
          continue;
        }

        const ok = await probeSnapshotLive(cam.url);
        if (ok) {
          selected.push(cam);
        }
      } catch {
        // Lanjut ke lokasi berikutnya
      }
    }
  } catch (err) {
    console.warn('[Scraper] Gagal mengambil data Sipantau Tangerang:', err.message);
  }

  console.log(`[Scraper] Sipantau Tangerang: ${selected.length} kamera unik online.`);
  return selected;
}

/**
 * Sumber 3: Dishub Kota Depok (dishub.depok.go.id/cctv)
 * Menggunakan var dataCCTV + HLS live stream https://dishub.depok.go.id/vi/<ipku>.m3u8
 */
async function scrapeDishubDepok(existingList) {
  console.log('[Scraper] 3. Mengambil data CCTV Dishub Kota Depok (dishub.depok.go.id/cctv)...');
  const selected = [];

  try {
    const res = await fetch('https://dishub.depok.go.id/cctv', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const match = html.match(/var\s+dataCCTV\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) throw new Error('dataCCTV array not found');

    const rawList = JSON.parse(match[1]);
    for (const item of rawList) {
      if (Number(item.exists) !== 1 || !item.ip) continue;
      const lat = Number(String(item.latitude || '').trim());
      const lon = Number(String(item.longitude || '').trim());
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < -6.55 || lat > -6.05 || lon < 106.55 || lon > 107.05) continue;

      const ipClean = String(item.ip).replace(/\./g, '');
      const hlsUrl = `https://dishub.depok.go.id/vi/${ipClean}.m3u8`;
      const nama = String(item.nama_cctv || `CCTV Depok ${ipClean}`).trim();
      const slug = nama.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

      const cam = {
        id: `depok-${slug}-${ipClean}`,
        name: nama,
        city: 'Depok',
        cityId: 'jakarta',
        provider: 'Dishub Kota Depok',
        lat,
        lon,
        headingDeg: 180,
        pitchDeg: -20,
        fovDeg: 60,
        rangeM: 220,
        mountHeightM: 8,
        feedType: 'hls',
        url: '',
        hlsUrl,
        kategori: 'jalan',
        locationDesc: `${nama} (ATCS Dishub Kota Depok)`,
        license: 'Sumber: Dishub Kota Depok (dishub.depok.go.id/cctv)',
      };

      if (isTooClose(cam, existingList, MIN_DEDUP_METERS) || isTooClose(cam, selected, MIN_DEDUP_METERS)) {
        continue;
      }

      // Probe HLS playlist live
      try {
        const hr = await fetch(hlsUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        const ct = (hr.headers.get('content-type') || '').toLowerCase();
        await hr.body?.cancel().catch(() => {});
        if (hr.ok && (ct.includes('mpegurl') || ct.includes('m3u8'))) {
          selected.push(cam);
        }
      } catch {
        // skip unresponsive stream
      }
    }
  } catch (err) {
    console.warn('[Scraper] Gagal mengambil data Dishub Depok:', err.message);
  }

  console.log(`[Scraper] Dishub Depok: ${selected.length} kamera unik online (HLS).`);
  return selected;
}

/**
 * Geocode nama jalan/persimpangan untuk kota tertentu (Bekasi / Bogor) via ArcGIS World Geocoder.
 */
async function geocodeCityPoint(query, { city, minLat, maxLat, minLon, maxLon }) {
  const clean = String(query || '')
    .replace(/^CCTV[-_\s]*/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(?:arah|simpang|perempatan|depan|jpo|sp)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;

  const q = `${clean}, ${city}, Jawa Barat, Indonesia`;
  try {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates`
      + `?SingleLine=${encodeURIComponent(q)}&countryCode=IDN&maxLocations=3&f=json`
      + `&searchExtent=${minLon},${minLat},${maxLon},${maxLat}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    const cand = (d.candidates || []).find((c) => {
      const y = Number(c?.location?.y), x = Number(c?.location?.x);
      return Number.isFinite(y) && Number.isFinite(x) && y >= minLat && y <= maxLat && x >= minLon && x <= maxLon && Number(c.score) >= 70;
    });
    if (!cand) return null;
    return { lat: Number(cand.location.y), lon: Number(cand.location.x) };
  } catch {
    return null;
  }
}

async function probeHlsLive(hlsUrl, timeoutMs = 5500) {
  try {
    const hr = await fetch(hlsUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!hr.ok) {
      await hr.body?.cancel().catch(() => {});
      return false;
    }
    const ct = (hr.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('mpegurl') || ct.includes('m3u8')) {
      await hr.body?.cancel().catch(() => {});
      return true;
    }
    const text = await hr.text().catch(() => '');
    return text.includes('#EXTM3U');
  } catch {
    return false;
  }
}

/**
 * Sumber 4: Pemkot Bekasi (bekasikota.go.id/api/cctv)
 */
async function scrapeBekasiKota(existingList) {
  console.log('[Scraper] 4. Mengambil data CCTV Pemkot Bekasi (bekasikota.go.id/api/cctv)...');
  const selected = [];
  const bounds = { city: 'Kota Bekasi', minLat: -6.42, maxLat: -6.14, minLon: 106.90, maxLon: 107.08 };

  try {
    const r = await fetch('https://bekasikota.go.id/api/cctv', {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const payload = await r.json();
    const list = payload?.data || [];

    for (const item of list) {
      const title = String(item.title || item.name || '').trim();
      const streamPath = String(item.stream || '').trim();
      if (!title || !streamPath) continue;

      const hlsUrl = streamPath.startsWith('http') ? streamPath : `https://bekasikota.go.id${streamPath}`;
      const coords = await geocodeCityPoint(title, bounds);
      if (!coords) continue;

      const slug = String(item.name || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const cam = {
        id: `bekasi-${slug}`,
        name: title,
        city: 'Bekasi',
        cityId: 'jakarta',
        provider: 'Pemkot Bekasi (ATCS)',
        lat: coords.lat,
        lon: coords.lon,
        headingDeg: 180,
        pitchDeg: -20,
        fovDeg: 60,
        rangeM: 220,
        mountHeightM: 8,
        feedType: 'hls',
        url: '',
        hlsUrl,
        kategori: 'jalan',
        locationDesc: `${title} (ATCS Pemerintah Kota Bekasi)`,
        license: 'Sumber: Pemkot Bekasi (bekasikota.go.id/cctv)',
      };

      if (isTooClose(cam, existingList, MIN_DEDUP_METERS) || isTooClose(cam, selected, MIN_DEDUP_METERS)) {
        continue;
      }

      if (await probeHlsLive(hlsUrl)) {
        selected.push(cam);
      }
    }
  } catch (err) {
    console.warn('[Scraper] Gagal mengambil data Pemkot Bekasi:', err.message);
  }

  console.log(`[Scraper] Pemkot Bekasi: ${selected.length} kamera unik online (HLS).`);
  return selected;
}

/**
 * Sumber 5: Bina Marga Non-Tol (binamarga.pu.go.id/cctv-non-tol)
 */
async function scrapeBinaMargaNonTol(existingList) {
  console.log('[Scraper] 5. Mengambil data CCTV Bina Marga Non-Tol (binamarga.pu.go.id/cctv-non-tol)...');
  const selected = [];

  try {
    const html = await (await fetch('https://binamarga.pu.go.id/cctv-non-tol', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })).text();
    const match = html.match(/var\s+cctvLocations\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) throw new Error('cctvLocations not found');

    const rawList = Function(`"use strict"; return (${match[1]});`)();
    const jabo = rawList.filter((c) => {
      const lat = Number(c.lat), lon = Number(c.lng);
      return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -6.65 && lat <= -6.0 && lon >= 106.55 && lon <= 107.15;
    });

    for (const item of jabo) {
      try {
        const playerHtml = await (await fetch(item.url, {
          signal: AbortSignal.timeout(7000),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })).text();
        const m3u8Match = playerHtml.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
        if (!m3u8Match) continue;
        const hlsUrl = m3u8Match[0];

        const cleanName = String(item.info || 'Bina Marga CCTV').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const cam = {
          id: `bm-nontol-${slug}`,
          name: cleanName,
          city: /bekasi/i.test(cleanName) ? 'Bekasi' : /tang/i.test(cleanName) ? 'Tangerang' : 'Jabodetabek',
          cityId: 'jakarta',
          provider: 'Ditjen Bina Marga PU (Non-Tol)',
          lat: Number(item.lat),
          lon: Number(item.lng),
          headingDeg: 180,
          pitchDeg: -20,
          fovDeg: 60,
          rangeM: 250,
          mountHeightM: 9,
          feedType: 'hls',
          url: '',
          hlsUrl,
          kategori: 'jalan',
          locationDesc: `${cleanName} (CCTV Jalan Nasional Bina Marga)`,
          license: 'Sumber: Ditjen Bina Marga Kementerian PU (binamarga.pu.go.id)',
        };

        if (isTooClose(cam, existingList, MIN_DEDUP_METERS) || isTooClose(cam, selected, MIN_DEDUP_METERS)) {
          continue;
        }
        if (await probeHlsLive(hlsUrl)) {
          selected.push(cam);
        }
      } catch {
        // skip
      }
    }
  } catch (err) {
    console.warn('[Scraper] Gagal mengambil data Bina Marga Non-Tol:', err.message);
  }

  console.log(`[Scraper] Bina Marga Non-Tol: ${selected.length} kamera unik online (HLS).`);
  return selected;
}

/**
 * Sumber 6: Bogor Single Window (bsw.kotabogor.go.id/cctv)
 */
async function scrapeBogorBsw(existingList) {
  console.log('[Scraper] 6. Mengambil data CCTV Kota Bogor (bsw.kotabogor.go.id/cctv)...');
  const selected = [];
  const bounds = { city: 'Kota Bogor', minLat: -6.68, maxLat: -6.52, minLon: 106.73, maxLon: 106.86 };

  try {
    const html = await (await fetch('https://bsw.kotabogor.go.id/cctv', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })).text();

    const regex = /<a[^>]+href="(https:\/\/bsw\.kotabogor\.go\.id\/cctv\/(\d+)\/detail)"[^>]*>([^<]+)<\/a>/gi;
    const entries = [];
    const seenIds = new Set();
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (seenIds.has(m[2])) continue;
      seenIds.add(m[2]);
      entries.push({ detailUrl: m[1], numId: m[2], name: m[3].trim() });
    }

    // Proses batch kecil agar cepat tanpa membebani server
    for (let i = 0; i < entries.length; i += 6) {
      const batch = entries.slice(i, i + 6);
      const results = await Promise.all(batch.map(async (ent) => {
        try {
          const dt = await (await fetch(ent.detailUrl, {
            signal: AbortSignal.timeout(7000),
            headers: { 'User-Agent': 'Mozilla/5.0' },
          })).text();
          const m3u8Match = dt.match(/https:\/\/restreamer[^"'\s<>]+\.m3u8/i);
          if (!m3u8Match) return null;
          const hlsUrl = m3u8Match[0];

          const [coords, isLive] = await Promise.all([
            geocodeCityPoint(ent.name, bounds),
            probeHlsLive(hlsUrl),
          ]);
          if (!coords || !isLive) return null;

          const slug = ent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          return {
            id: `bogor-${slug}-${ent.numId}`,
            name: ent.name.replace(/^CCTV-/i, ''),
            city: 'Bogor',
            cityId: 'jakarta',
            provider: 'Pemkot Bogor (BSW)',
            lat: coords.lat,
            lon: coords.lon,
            headingDeg: 180,
            pitchDeg: -20,
            fovDeg: 60,
            rangeM: 220,
            mountHeightM: 8,
            feedType: 'hls',
            url: '',
            hlsUrl,
            kategori: 'jalan',
            locationDesc: `${ent.name} (BSW Pemerintah Kota Bogor)`,
            license: 'Sumber: Bogor Single Window (bsw.kotabogor.go.id/cctv)',
          };
        } catch {
          return null;
        }
      }));

      for (const cam of results) {
        if (!cam) continue;
        if (isTooClose(cam, existingList, MIN_DEDUP_METERS) || isTooClose(cam, selected, MIN_DEDUP_METERS)) {
          continue;
        }
        selected.push(cam);
      }
    }
  } catch (err) {
    console.warn('[Scraper] Gagal mengambil data BSW Kota Bogor:', err.message);
  }

  console.log(`[Scraper] BSW Kota Bogor: ${selected.length} kamera unik online (HLS).`);
  return selected;
}

/**
 * Sumber 7: Bina Marga CCTV Tol (binamarga.pu.go.id/contents/cctv_tol)
 * Digabungkan dengan koordinat presisi dari BPJT (bpjt.pu.go.id/cctv/) & backup lokal.
 */
async function scrapeBinaMargaTol(existingList) {
  console.log('[Scraper] 7. Mengambil data CCTV Jalan Tol Bina Marga & BPJT...');
  const JABO_RUAS = [
    '6-tol-dalam-kota-kelapa-gading-pulo-gebang',
    'akses-tanjung-priok',
    'bekasi-cawang-kampung-melayu',
    'borr-sentul-barat-simpang-yasmin',
    'cawang-tj-priok-ancol-timur-jembatan-tigapluit',
    'cibitung-cilincing',
    'cimanggis-cibitung',
    'cinere-jagorawi',
    'dalam-kota',
    'depok-antasari',
    'jakarta-bogor-ciawi',
    'jakarta-cikampek',
    'jakarta-tangerang',
    'jalan-layang-mbz',
    'jorr-2-kunciran-cengkareng',
    'jorr-2-serpong-cinere',
    'jorr-2-serpong-kunciran',
    'jorr-e-bambu-apus-rorotan',
    'jorr-s',
    'jorr-w1',
    'jorr-w2s-pondok-ranji-ulujami-pondok-pinang',
    'jorr-w2u-ulujami-kembangan',
    'pondok-aren-serpong',
    'sedyatmo',
    'serpong-cinere',
  ];
  const HEALTHY_HOSTS = new Set([
    'jmlive.jasamarga.com',
    'pub2.hk-opt.com',
    'streaming-cct.co.id',
    'camera.jtd.co.id',
    'cctv.citramarga.com',
  ]);

  // 1. Muat koordinat GPS resmi dari BPJT allStreams (cocokkan via streamhls, UUID, atau nama_km)
  const bpjtByHls = new Map();
  const bpjtByUuid = new Map();
  const bpjtByKm = new Map();
  const extractUuid = (u) => String(u || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() || '';
  const normKm = (s) => String(s || '').toLowerCase().replace(/\|.*$/, '').replace(/[^a-z0-9+]+/g, ' ').trim();

  try {
    const bpjtHtml = await (await fetch('https://bpjt.pu.go.id/cctv/', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })).text();
    const m = bpjtHtml.match(/const\s+allStreams\s*=\s*(\{[\s\S]*?\});/);
    if (m) {
      const obj = JSON.parse(m[1]);
      for (const c of Object.values(obj).flat()) {
        const lat = Number(c.lat), lon = Number(c.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lat < -6.68 || lat > -6.0 || lon < 106.50 || lon > 107.18) continue;
        const pt = { lat, lon, ruas: c.nama_ruas, km: c.nama_km };
        if (c.streamhls) {
          bpjtByHls.set(String(c.streamhls).trim(), pt);
          const uuid = extractUuid(c.streamhls);
          if (uuid) bpjtByUuid.set(uuid, pt);
        }
        const kmKey = normKm(c.nama_km);
        if (kmKey && !bpjtByKm.has(kmKey)) bpjtByKm.set(kmKey, pt);
      }
    }
    console.log(`[Scraper]   BPJT koordinat Jabodetabek dimuat: ${bpjtByHls.size} titik.`);
  } catch (e) {
    console.warn('[Scraper]   Gagal memuat koordinat BPJT:', e.message);
  }

  async function fetchRuasHtml(slug) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://binamarga.pu.go.id/contents/cctv_tol/?id_ruas=${slug}`, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Connection: 'close' },
        });
        if (r.ok) return await r.text();
      } catch { /* retry */ }
      await new Promise((res) => setTimeout(res, 250));
    }
    return '';
  }

  const rawEntries = [];
  const seenUrls = new Set();
  const cardRegex = /<source\s+src=["'](https?:\/\/[^"']+\.m3u8[^"']*)["'][^>]*>[\s\S]{0,1200}?<h5[^>]*>([\s\S]*?)<\/h5>/gi;

  for (const slug of JABO_RUAS) {
    const html = await fetchRuasHtml(slug);
    if (!html) continue;
    const ruasLabel = slug
      .replace(/^6-tol-/, 'Tol ')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    let m;
    while ((m = cardRegex.exec(html)) !== null) {
      const hlsUrl = m[1].trim();
      const km = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (seenUrls.has(hlsUrl)) continue;
      let host;
      try { host = new URL(hlsUrl).host.toLowerCase(); } catch { continue; }
      if (!HEALTHY_HOSTS.has(host)) continue;
      seenUrls.add(hlsUrl);
      rawEntries.push({ slug, ruas: ruasLabel, km, hlsUrl, host });
    }
  }

  console.log(`[Scraper]   Kandidat stream tol dari Bina Marga: ${rawEntries.length} kamera.`);

  const selected = [];
  for (let i = 0; i < rawEntries.length; i += 8) {
    const batch = rawEntries.slice(i, i + 8);
    const resolved = await Promise.all(batch.map(async (ent) => {
      const uuid = extractUuid(ent.hlsUrl);
      const kmKey = normKm(ent.km);
      const coords =
        bpjtByHls.get(ent.hlsUrl) ||
        (uuid ? bpjtByUuid.get(uuid) : null) ||
        (kmKey ? bpjtByKm.get(kmKey) : null) ||
        null;
      if (!coords) return null;

      const isLive = await probeHlsLive(ent.hlsUrl);
      if (!isLive) return null;

      const slugId = `${ent.slug}-${ent.km}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const providerMap = {
        'jmlive.jasamarga.com': 'Jasa Marga / Bina Marga Tol',
        'pub2.hk-opt.com': 'Hutama Karya Tol JORR S',
        'streaming-cct.co.id': 'PT Cimanggis Cibitung Tollways',
        'camera.jtd.co.id': 'PT Jakarta Tollroad Development',
        'cctv.citramarga.com': 'PT CMNP Tol Wiyoto Wiyono',
      };

      return {
        id: `tol-${slugId}`,
        name: `${ent.ruas} · ${ent.km}`,
        city: /bekasi|cikampek|cibitung/i.test(ent.ruas) ? 'Bekasi' : /bogor|ciawi|borr/i.test(ent.ruas) ? 'Bogor' : /tangerang|serpong|kunciran/i.test(ent.ruas) ? 'Tangerang' : /depok|cinere|antasari/i.test(ent.ruas) ? 'Depok' : 'Jakarta',
        cityId: 'jakarta',
        provider: providerMap[ent.host] || 'Ditjen Bina Marga Tol (PU)',
        lat: coords.lat,
        lon: coords.lon,
        headingDeg: 180,
        pitchDeg: -20,
        fovDeg: 60,
        rangeM: 250,
        mountHeightM: 9,
        feedType: 'hls',
        url: '',
        hlsUrl: ent.hlsUrl,
        kategori: 'tol',
        locationDesc: `Tol ${ent.ruas} (${ent.km})`,
        license: 'Sumber: Ditjen Bina Marga & BPJT Kementerian PU',
      };
    }));

    for (const cam of resolved) {
      if (!cam) continue;
      if (isTooClose(cam, existingList, MIN_DEDUP_METERS) || isTooClose(cam, selected, MIN_DEDUP_METERS)) {
        continue;
      }
      selected.push(cam);
    }
  }

  console.log(`[Scraper] Bina Marga Tol: ${selected.length} kamera unik online (HLS).`);
  return selected;
}

/**
 * Sumber 8: CCTV Nusantara (Direduksi & Hanya yang Benar-Benar Online)
 * Dibatasi maksimal NUSANTARA_MAX_CAMERAS titik yang tersebar merata (min 900m)
 * agar tidak memicu Cloudflare rate-limit / ECONNRESET saat health sweep.
 */
async function scrapeCctvNusantaraReduced(existingList) {
  console.log(`[Scraper] 3. Mengambil & mereduksi CCTV Nusantara (target maks ${NUSANTARA_MAX_CAMERAS} titik unik)...`);
  const candidates = [];

  try {
    const res = await fetch('https://cctvnusantara.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const regex = /\\"id\\":\\"([^\\"]+)\\",\\"kota\\":\\"([^\\"]+)\\",\\"nama\\":\\"([^\\"]+)\\",\\"lokasi\\":\\"([^\\"]+)\\",\\"lat\\":(-?\d+(?:\.\d+)?),\\"lng\\":(-?\d+(?:\.\d+)?)(?:,\\"tipe\\":\\"([^\\"]+)\\"|)(?:,\\"sumber\\":\\"([^\\"]+)\\"|)(?:,\\"kategori\\":\\"([^\\"]+)\\"|)/g;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const id = match[1];
      const kota = match[2];
      const nama = match[3];
      const lokasi = match[4];
      const lat = Number(match[5]);
      const lon = Number(match[6]);
      const sumber = match[8] || 'CCTV Nusantara';
      const kategori = match[9] || 'jalan';

      if (lat < -6.45 || lat > -6.05 || lon < 106.65 || lon > 107.05) continue;
      if (kategori === 'pengadilan' || nama.includes('PA.') || nama.includes('PN.') || nama.includes('RUANG SIDANG')) continue;

      const cityName =
        kota === 'jakarta' ? 'Jakarta' :
        kota === 'depok' ? 'Depok' :
        kota === 'bekasi' ? 'Bekasi' :
        kota === 'bogor' || kota === 'kabbogor' ? 'Bogor' :
        kota === 'tangerang' || kota === 'tangsel' ? 'Tangerang' :
        'Jabodetabek';

      candidates.push({
        id: `nusantara-${id}`,
        name: nama,
        city: cityName,
        cityId: 'jakarta',
        provider: sumber,
        lat,
        lon,
        headingDeg: 180,
        pitchDeg: -20,
        fovDeg: 60,
        rangeM: 250,
        mountHeightM: 8,
        feedType: 'image',
        url: `https://cctvnusantara.com/api/thumbnail?id=${id}`,
        kategori: kategori === 'tol' ? 'tol' : 'jalan',
        locationDesc: lokasi,
        license: `Sumber: ${sumber} via CCTV Nusantara`,
      });
    }
  } catch (err) {
    console.warn('[Scraper] Gagal mengambil HTML CCTV Nusantara:', err.message);
  }

  // Fallback: gunakan kandidat nusantara-* dari backup katalog lokal jika HTML utama berubah/terproteksi
  if (candidates.length === 0) {
    const fallbackPath = fs.existsSync(BACKUP_PATH) ? BACKUP_PATH : CATALOG_PATH;
    if (fs.existsSync(fallbackPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
        const list = Array.isArray(raw) ? raw : (raw.cameras || []);
        for (const c of list) {
          if (String(c.id || '').startsWith('nusantara-') && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))) {
            candidates.push({ ...c, lat: Number(c.lat), lon: Number(c.lon) });
          }
        }
        console.log(`[Scraper] Memuat ${candidates.length} kandidat CCTV Nusantara dari backup lokal.`);
      } catch (e) {
        console.warn('[Scraper] Gagal membaca backup lokal:', e.message);
      }
    }
  }

  // Prioritaskan titik dekat Monas/Jakarta Pusat terlebih dahulu agar cakupan pusat kota lengkap,
  // lalu sebar secara spasial dengan jarak minimum NUSANTARA_SPACING_METERS
  const nearMonas = candidates
    .filter((c) => haversineM(c.lat, c.lon, MONAS_COORD.lat, MONAS_COORD.lon) <= 950)
    .sort((a, b) => haversineM(a.lat, a.lon, MONAS_COORD.lat, MONAS_COORD.lon) - haversineM(b.lat, b.lon, MONAS_COORD.lat, MONAS_COORD.lon));

  const others = candidates.filter((c) => haversineM(c.lat, c.lon, MONAS_COORD.lat, MONAS_COORD.lon) > 950);

  // Pilih kandidat yang tersebar merata (tanpa menumpuk di satu titik)
  const spatiallyPicked = [];
  for (const cam of nearMonas) {
    if (isTooClose(cam, existingList, MIN_DEDUP_METERS)) continue;
    if (isTooClose(cam, spatiallyPicked, 200)) continue;
    spatiallyPicked.push(cam);
    if (spatiallyPicked.length >= 2) break;
  }

  for (const cam of others) {
    if (isTooClose(cam, existingList, 150)) continue;
    if (isTooClose(cam, spatiallyPicked, NUSANTARA_SPACING_METERS)) continue;
    spatiallyPicked.push(cam);
    if (spatiallyPicked.length >= NUSANTARA_MAX_CAMERAS * 3) break;
  }

  // Verifikasi perlahan (1 per 1 dengan jeda 280ms) supaya tidak kena flag Cloudflare saat scraping
  const verified = [];
  for (const cam of spatiallyPicked) {
    if (verified.length >= NUSANTARA_MAX_CAMERAS) break;
    const ok = await probeSnapshotLive(cam.url, 5500);
    if (ok) {
      verified.push(cam);
    }
    await new Promise((r) => setTimeout(r, 280));
  }

  console.log(`[Scraper] CCTV Nusantara: ${verified.length} kamera terverifikasi online (dari ${candidates.length} total mentah).`);
  return verified;
}

async function main() {
  console.log('=== MEMULAI SCRAPING & DIVERSIFIKASI KATALOG CCTV JAKSAFE ===');

  const jakCctvList = await scrapeJakCctv();
  const sipantauList = await scrapeSipantauTangerang(jakCctvList);
  const depokList = await scrapeDishubDepok([...jakCctvList, ...sipantauList]);
  const bekasiList = await scrapeBekasiKota([...jakCctvList, ...sipantauList, ...depokList]);
  const bmList = await scrapeBinaMargaNonTol([...jakCctvList, ...sipantauList, ...depokList, ...bekasiList]);
  const bogorList = await scrapeBogorBsw([...jakCctvList, ...sipantauList, ...depokList, ...bekasiList, ...bmList]);
  const bmTolList = await scrapeBinaMargaTol([...jakCctvList, ...sipantauList, ...depokList, ...bekasiList, ...bmList, ...bogorList]);
  const nusantaraList = await scrapeCctvNusantaraReduced([
    ...jakCctvList, ...sipantauList, ...depokList, ...bekasiList, ...bmList, ...bogorList, ...bmTolList,
  ]);

  // Final dedup pass: pastikan 100% bebas ID ganda dan bebas duplikat koordinat (< 80m)
  const finalCatalog = [];
  const seenIds = new Set();
  for (const cam of [
    ...jakCctvList, ...sipantauList, ...depokList, ...bekasiList, ...bmList, ...bogorList, ...bmTolList, ...nusantaraList,
  ]) {
    if (seenIds.has(cam.id)) continue;
    if (isTooClose(cam, finalCatalog, MIN_DEDUP_METERS)) continue;
    seenIds.add(cam.id);
    finalCatalog.push(cam);
  }

  // Pastikan minimal ada 1 titik referensi Monas (< 950m) untuk cakupan pusat kota
  const hasMonas = finalCatalog.some((c) => haversineM(c.lat, c.lon, MONAS_COORD.lat, MONAS_COORD.lon) <= 950);
  if (!hasMonas && fs.existsSync(BACKUP_PATH)) {
    try {
      const bak = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
      const balaiKota = bak.find((c) => c.id === 'nusantara-dki-balai-kota');
      if (balaiKota && !seenIds.has(balaiKota.id)) {
        seenIds.add(balaiKota.id);
        finalCatalog.push(balaiKota);
      }
    } catch { /* ignore */ }
  }

  console.log(`\n[Hasil] Total kamera unik terverifikasi: ${finalCatalog.length} kamera.`);

  const byHost = {};
  const byProvider = {};
  for (const c of finalCatalog) {
    byProvider[c.provider] = (byProvider[c.provider] || 0) + 1;
    try {
      const h = new URL(c.url).host;
      byHost[h] = (byHost[h] || 0) + 1;
    } catch { /* ignore */ }
  }

  console.log('\n[Distribusi Host]:');
  for (const [host, count] of Object.entries(byHost).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${host}: ${count} kamera`);
  }

  console.log('\n[Rekapitulasi Provider]:');
  for (const [prov, count] of Object.entries(byProvider).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${prov}: ${count} kamera`);
  }

  if (fs.existsSync(CATALOG_PATH) && !fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(CATALOG_PATH, BACKUP_PATH);
    console.log(`\n[Backup] Katalog lama dicadangkan ke: ${BACKUP_PATH}`);
  }

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(finalCatalog, null, 2), 'utf8');
  console.log(`[Simpan] Berhasil menulis ${finalCatalog.length} kamera ke: ${CATALOG_PATH}`);
  console.log('=== SELESAI ===');
}

main().catch(console.error);
