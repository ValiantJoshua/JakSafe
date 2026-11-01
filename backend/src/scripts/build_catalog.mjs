import fs from 'node:fs';

const combined = fs.readFileSync('temp_combined.txt', 'utf8');
const regex = /\{"id":\s*"[^"]+",\s*"kota":\s*"jakarta"[\s\S]*?\}(?=,\{"id"|\])/g;
const matches = combined.match(regex) || [];
const parsed = matches.map(m => JSON.parse(m));

async function findRealJpegs() {
  console.log(`Scanning all ${parsed.length} cameras for actual JPEG frames...`);
  const jpegs = [];

  for (const item of parsed) {
    const thumbUrl = `https://cctvnusantara.com/api/thumbnail?id=${item.id}`;
    try {
      const res = await fetch(thumbUrl, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && ctype.includes('image/jpeg')) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 5000) {
          console.log(`[REAL JPEG ${jpegs.length + 1}] ${item.nama} | ${item.lokasi} | ${buf.byteLength} bytes`);
          jpegs.push({
            id: item.id,
            name: item.nama,
            city: 'Jakarta',
            cityId: 'jakarta',
            provider: item.sumber || 'cctvnusantara.com',
            lat: item.lat,
            lon: item.lng,
            headingDeg: 180,
            pitchDeg: -20,
            fovDeg: 60,
            rangeM: 250,
            mountHeightM: 8,
            feedType: 'image',
            url: thumbUrl,
            kategori: item.kategori,
            locationDesc: item.lokasi,
            license: `Sumber: ${item.sumber || 'cctvnusantara.com'}`
          });
        }
      }
    } catch (e) {
      // ignore
    }
  }

  console.log(`\nFound ${jpegs.length} REAL JPEG cameras!`);
  fs.writeFileSync('JakSafe/backend/src/data/cctvCatalog.json', JSON.stringify(jpegs, null, 2));
  console.log('Saved to JakSafe/backend/src/data/cctvCatalog.json!');
}

findRealJpegs().catch(console.error);

