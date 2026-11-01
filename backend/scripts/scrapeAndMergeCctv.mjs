import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../src/data/cctvCatalog.json');
const BACKUP_PATH = path.resolve(__dirname, '../src/data/cctvCatalog.backup.json');

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
 * Scrape kamera publik Pemprov DKI Jakarta (JakCCTV / Balitower)
 */
async function scrapeJakCctv() {
  console.log('[Scraper] Mengambil data CCTV publik Pemprov DKI (jakcctv.jakarta.go.id)...');
  const cameras = [];

  for (let page = 1; page <= 7; page++) {
    try {
      const res = await fetch(`https://jakcctv.jakarta.go.id/publik/data?page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
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

        const previewJpg = iframeSrc.replace('/embed.html', '/preview.jpg');
        const hlsUrl = iframeSrc.replace('/embed.html', '/index.m3u8');

        const ref = JAKCCTV_COORDS[title] || { lat: -6.2088, lon: 106.8456, desc: title };
        const idSafe = streamName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        cameras.push({
          id: `jakcctv-${idSafe}`,
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
          url: previewJpg,
          hlsUrl,
          embedUrl: iframeSrc,
          kategori: 'arteri',
          locationDesc: ref.desc,
          license: 'Sumber: JakCCTV Publik Pemprov DKI Jakarta'
        });
      }
    } catch (err) {
      console.warn(`[Scraper] Gagal mengambil halaman ${page} JakCCTV:`, err.message);
    }
  }

  console.log(`[Scraper] Berhasil mengambil ${cameras.length} kamera dari JakCCTV.`);
  return cameras;
}

/**
 * Scrape kamera Jabodetabek dari CCTV Nusantara
 */
async function scrapeCctvNusantara() {
  console.log('[Scraper] Mengambil data CCTV Nusantara (cctvnusantara.com)...');
  const cameras = [];

  try {
    const res = await fetch('https://cctvnusantara.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
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
      const tipe = match[7] || 'image';
      const sumber = match[8] || 'CCTV Nusantara';
      const kategori = match[9] || 'jalan';

      // Saring hanya kawasan Jabodetabek (Jakarta, Bogor, Depok, Tangerang, Bekasi, dan Jalan Tol Jabodetabek)
      if (lat < -6.45 || lat > -6.05 || lon < 106.65 || lon > 107.05) continue;

      // Saring kategori pengadilan/ruang sidang (hanya fokus jalan raya, tol, dan ruang publik)
      if (kategori === 'pengadilan' || nama.includes('PA.') || nama.includes('PN.') || nama.includes('RUANG SIDANG')) continue;

      const cityName = kota === 'jakarta' ? 'Jakarta' : kota === 'depok' ? 'Depok' : kota === 'bekasi' ? 'Bekasi' : kota === 'bogor' || kota === 'kabbogor' ? 'Bogor' : kota === 'tangerang' || kota === 'tangsel' ? 'Tangerang' : 'Jabodetabek';

      cameras.push({
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
        license: `Sumber: ${sumber} via CCTV Nusantara`
      });
    }
  } catch (err) {
    console.warn('[Scraper] Gagal mengambil data CCTV Nusantara:', err.message);
  }

  console.log(`[Scraper] Berhasil mengambil ${cameras.length} kamera jalan/tol Jabodetabek dari CCTV Nusantara.`);
  return cameras;
}

async function main() {
  console.log('=== MEMULAI SCRAPING & UPDATE KATALOG CCTV JAKSAFE ===');

  // 1. Ambil data dari kedua sumber
  const jakCctvList = await scrapeJakCctv();
  const nusantaraList = await scrapeCctvNusantara();

  // 2. Gabungkan dan deduplikasi berdasarkan ID unik & koordinat
  const combined = new Map();

  // Prioritas 1: JakCCTV (Pemprov DKI Jakarta - real-time live Balitower)
  for (const cam of jakCctvList) {
    combined.set(cam.id, cam);
  }

  // Prioritas 2: CCTV Nusantara (Bina Marga PU, Jasa Marga, Tol DKI, Dishub Depok, dll.)
  for (const cam of nusantaraList) {
    if (!combined.has(cam.id)) {
      combined.set(cam.id, cam);
    }
  }

  const finalCatalog = Array.from(combined.values());
  console.log(`\n[Hasil] Total kamera terkumpul: ${finalCatalog.length} kamera.`);

  // Rekapitulasi per Provider
  const byProvider = {};
  for (const c of finalCatalog) {
    byProvider[c.provider] = (byProvider[c.provider] || 0) + 1;
  }
  console.log('\n[Rekapitulasi Provider]:');
  for (const [prov, count] of Object.entries(byProvider).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${prov}: ${count} kamera`);
  }

  // 3. Backup katalog lama
  if (fs.existsSync(CATALOG_PATH)) {
    fs.copyFileSync(CATALOG_PATH, BACKUP_PATH);
    console.log(`\n[Backup] Katalog lama dicadangkan ke: ${BACKUP_PATH}`);
  }

  // 4. Simpan ke cctvCatalog.json
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(finalCatalog, null, 2), 'utf8');
  console.log(`[Simpan] Berhasil menulis ${finalCatalog.length} kamera ke: ${CATALOG_PATH}`);
  console.log('=== SELESAI ===');
}

main().catch(console.error);

