/*
   Pembungkus endpoint rute.

   Endpoint backend
     GET /api/route?profile=car|bike|foot&coords=lon,lat;lon,lat&alternatives=true

   Balasan backend
     {
       ok: true,
       profile: "car",
       routes: [ { distanceM, durationS, geometry: [[lon,lat], ...] }, ... ]
     }

   Catatan yang perlu diingat saat tanya jawab.
   Backend memakai OSRM publik milik FOSSGIS tanpa kunci API, dan hasilnya
   disimpan sepuluh menit di memori backend. Jadi kalau rute yang sama
   dicari dua kali berturut turut, yang kedua terasa jauh lebih cepat.
   Itu bukan karena frontend menyimpan apa pun, frontend memang tidak
   menyimpan hasil rute sama sekali.
*/

import { minta } from './httpClient.js';
import { TIMEOUT_MS } from '../config/constants.js';
import { toCoordParam } from '../utils/geo.js';

/**
 * @typedef {object} RuteMentah
 * @property {number} distanceM  jarak dalam meter
 * @property {number} durationS  perkiraan waktu tempuh dasar dalam detik
 * @property {number[][]} geometry  daftar titik [lon, lat]
 */

/**
 * Mengambil satu atau beberapa pilihan rute.
 *
 * @param {object} opsi
 * @param {{lat:number, lon:number}} opsi.asal
 * @param {{lat:number, lon:number}} opsi.tujuan
 * @param {'car'|'bike'|'foot'} [opsi.profil='car']
 * @param {boolean} [opsi.alternatif=true]  minta rute pilihan lain supaya
 *        penilaian berbagai kriteria punya pembanding
 * @param {AbortSignal} [opsi.signal]
 * @returns {Promise<{profile:string, routes:RuteMentah[]}>}
 */
export async function ambilRute({ asal, tujuan, profil = 'car', alternatif = true, signal }) {
  const data = await minta('/route', {
    kueri: {
      profile: profil,
      coords: toCoordParam([asal, tujuan]),
      alternatives: alternatif ? 'true' : 'false',
    },
    timeoutMs: TIMEOUT_MS.rute,
    signal,
  });

  return {
    profile: data.profile,
    routes: Array.isArray(data.routes) ? data.routes : [],
  };
}
