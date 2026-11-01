/*
   Bantuan perhitungan geografis.

   Seluruh urusan urutan koordinat dipusatkan di berkas ini. Alasannya,
   backend JakSafe memakai urutan bujur lalu lintang pada hampir semua
   endpoint, sedangkan manusia dan sebagian besar kode tampilan terbiasa
   membaca lintang dulu. Kalau pembalikan urutan ini tersebar di banyak
   berkas, satu kesalahan ketik saja sudah cukup untuk membuat rute
   Jakarta melompat ke Samudra Hindia dan susah dilacak.
*/

/**
 * Mengubah daftar titik menjadi parameter coords yang diminta backend.
 *
 * Bentuk yang dihasilkan "lon,lat;lon,lat" sesuai parseCoords pada
 * backend/src/services/osrm.js. Fungsi parseCoords itu dipakai ulang oleh
 * endpoint /api/route, /api/aqi, /api/cctv/nearest, dan /api/tomtom/segment,
 * jadi satu bentuk ini berlaku untuk semuanya.
 *
 * Pembulatan enam angka di belakang koma dipilih karena setara dengan
 * ketelitian sekitar sepuluh sentimeter, jauh lebih dari cukup untuk
 * navigasi jalan, sekaligus memendekkan URL dan memperbesar peluang
 * permintaan yang sama kena cache di backend.
 *
 * @param {{lat:number, lon:number}[]} titik
 * @returns {string}
 */
export function toCoordParam(titik) {
  return titik
    .map(({ lat, lon }) => `${Number(lon).toFixed(6)},${Number(lat).toFixed(6)}`)
    .join(';');
}

/**
 * Mengubah satu koordinat bentuk backend, yaitu [lon, lat], menjadi objek
 * { lat, lon } yang dipakai di dalam frontend.
 *
 * Geometri rute dari /api/route datang sebagai array [lon, lat], jadi
 * fungsi ini yang dipakai setiap kali geometri itu perlu dibaca.
 *
 * @param {number[]} pasangan
 * @returns {{lat:number, lon:number}}
 */
export function fromBackendPair([lon, lat]) {
  return { lat, lon };
}

/**
 * Jarak dua titik di permukaan bumi dalam meter, rumus haversine.
 *
 * Sengaja memakai rumus yang sama dengan distanceM pada
 * backend/src/services/cctvCatalog.js supaya jarak kamera yang dihitung
 * di frontend tidak berbeda dengan yang dihitung backend. Jari jari bumi
 * yang dipakai sama, 6371000 meter.
 *
 * @returns {number} jarak dalam meter
 */
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Mengambil beberapa titik contoh yang tersebar merata di sepanjang rute.
 *
 * Geometri OSRM bisa berisi ribuan titik, sedangkan /api/aqi hanya
 * menerima paling banyak dua belas titik. Mengambil titik secara acak
 * berisiko menumpuk di satu ruas, jadi di sini jaraknya dibagi rata
 * berdasarkan indeks. Titik awal dan titik akhir selalu ikut supaya kedua
 * ujung perjalanan pasti terwakili.
 *
 * @param {number[][]} geometry  geometri dari backend, tiap unsur [lon, lat]
 * @param {number} jumlah        banyak titik yang diinginkan, minimal 2
 * @returns {{lat:number, lon:number}[]}
 */
export function sampleAlongRoute(geometry, jumlah) {
  if (!Array.isArray(geometry) || geometry.length === 0) return [];
  if (geometry.length <= jumlah) return geometry.map(fromBackendPair);

  const n = Math.max(2, jumlah);
  const langkah = (geometry.length - 1) / (n - 1);
  const hasil = [];
  for (let i = 0; i < n; i += 1) {
    hasil.push(fromBackendPair(geometry[Math.round(i * langkah)]));
  }
  return hasil;
}

/**
 * Titik tengah sebuah rute berdasarkan indeks geometri.
 *
 * Dipakai sebagai titik tebakan pertama saat mencari kamera CCTV terdekat,
 * karena bagian tengah rute biasanya ruas yang paling menentukan dan paling
 * jarang berada tepat di depan rumah atau kantor pengguna.
 *
 * @param {number[][]} geometry
 * @returns {{lat:number, lon:number}|null}
 */
export function midpointOf(geometry) {
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  return fromBackendPair(geometry[Math.floor(geometry.length / 2)]);
}

/**
 * Kotak pembatas sebuah geometri rute.
 * Belum dipakai tampilan saat ini, disiapkan untuk tahap peta 3D agar
 * kamera bisa langsung diarahkan ke seluruh rute.
 *
 * @param {number[][]} geometry
 * @returns {{minLat:number, minLon:number, maxLat:number, maxLon:number}|null}
 */
export function boundsOf(geometry) {
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  let minLat = Infinity; let minLon = Infinity;
  let maxLat = -Infinity; let maxLon = -Infinity;
  for (const [lon, lat] of geometry) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, minLon, maxLat, maxLon };
}
