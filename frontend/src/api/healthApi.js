/*
   Pemeriksaan kesehatan backend.

   Dipanggil sekali saat halaman dibuka, lalu diulang berkala. Gunanya
   supaya pengguna tahu lebih awal kalau backend belum dijalankan, bukan
   baru tahu setelah menekan tombol Cari Rute Aman dan menunggu sia sia.

   Endpoint yang dipakai, GET /api/health pada backend/src/server.js,
   balasannya { status, service, time }. Perhatikan endpoint ini satu
   satunya yang tidak memakai pembungkus { ok: true, ... }.
*/

import { minta } from './httpClient.js';
import { TIMEOUT_MS } from '../config/constants.js';

/**
 * @typedef {object} StatusBackend
 * @property {boolean} hidup   backend menjawab dengan benar
 * @property {string} [layanan] nama layanan yang dilaporkan backend
 * @property {string} [waktu]   penanda waktu server
 * @property {string} [pesan]   keterangan kalau tidak hidup
 */

/**
 * Memeriksa apakah backend hidup.
 * Fungsi ini sengaja tidak pernah melempar pengecualian. Kegagalan adalah
 * keadaan yang wajar di sini, bukan keadaan luar biasa, jadi hasilnya
 * dikembalikan sebagai objek biasa agar pemanggil tidak perlu try catch.
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<StatusBackend>}
 */
export async function cekKesehatan(signal) {
  try {
    const data = await minta('/health', { timeoutMs: TIMEOUT_MS.cepat, signal });
    return {
      hidup: data?.status === 'ok',
      layanan: data?.service,
      waktu: data?.time,
    };
  } catch (e) {
    return { hidup: false, pesan: e.message };
  }
}
