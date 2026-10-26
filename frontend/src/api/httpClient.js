/*
   Satu pintu untuk semua permintaan HTTP ke backend JakSafe.

   Tidak ada modul lain yang boleh memanggil fetch secara langsung. Alasannya
   ada empat dan semuanya terasa saat sesi demo.

   1. Bentuk galat backend seragam. Semua endpoint backend membalas
      { ok: false, error: "pesan" } ketika gagal, lihat misalnya
      backend/src/routes/route.js. Modul ini yang mengubahnya menjadi
      pengecualian JavaScript, jadi pemanggil cukup memakai try catch biasa.

   2. Batas waktu selalu ada. fetch bawaan peramban tidak punya batas waktu.
      Tanpa penjagaan ini, satu permintaan yang menggantung membuat tombol
      Cari Rute Aman berputar selamanya tanpa pesan apa pun.

   3. Permintaan bisa dibatalkan. Kalau pengguna menekan Batalkan atau
      mencari rute baru sebelum yang lama selesai, permintaan sebelumnya
      harus benar benar berhenti supaya hasil lama tidak menimpa hasil baru.

   4. Lama tiap panggilan tercatat. Angka ini dipakai kartu "Cara JakSafe
      mengambil keputusan" untuk menampilkan jejak proses yang sebenarnya,
      bukan angka karangan.
*/

import { API_BASE } from '../config/constants.js';

/**
 * Galat yang berasal dari lapisan jaringan atau dari backend.
 * Membawa kode status HTTP dan jalur yang gagal supaya pengendali tampilan
 * bisa membedakan "backend mati" dari "backend menjawab tetapi menolak".
 */
export class ApiError extends Error {
  /**
   * @param {string} pesan
   * @param {object} [opsi]
   * @param {number} [opsi.status]   kode status HTTP, 0 kalau tidak sampai ke server
   * @param {string} [opsi.jalur]    jalur yang diminta
   * @param {string} [opsi.sebab]    penggolongan singkat, lihat SEBAB di bawah
   */
  constructor(pesan, { status = 0, jalur = '', sebab = 'lainnya' } = {}) {
    super(pesan);
    this.name = 'ApiError';
    this.status = status;
    this.jalur = jalur;
    this.sebab = sebab;
  }
}

/**
 * Penggolongan sebab kegagalan.
 * Dipakai tampilan untuk memilih kalimat yang tepat. Membedakan "backend
 * belum dijalankan" dari "endpoint belum dibuat" penting sekali di proyek
 * ini karena POST /api/navigate memang belum ada di backend.
 */
export const SEBAB = {
  TIDAK_TERHUBUNG: 'tidak-terhubung',  // backend tidak menjawab sama sekali
  BELUM_ADA: 'belum-ada',              // 404 atau 501, endpoint belum tersedia
  WAKTU_HABIS: 'waktu-habis',          // melewati batas waktu
  DIBATALKAN: 'dibatalkan',            // dibatalkan pengguna
  DITOLAK: 'ditolak',                  // 4xx selain 404
  SERVER: 'server',                    // 5xx
  LAINNYA: 'lainnya',
};

/**
 * Catatan satu panggilan, dikumpulkan untuk jejak proses.
 * @typedef {object} JejakPanggilan
 * @property {string} jalur
 * @property {number} lamaMs
 * @property {boolean} berhasil
 * @property {number} status
 * @property {string} [pesan]
 */

/** Penampung jejak panggilan untuk satu kali pencarian rute. */
let jejakAktif = null;

/** Mulai mengumpulkan jejak. Dipanggil sebelum satu alur pencarian berjalan. */
export function mulaiJejak() {
  jejakAktif = [];
}

/**
 * Berhenti mengumpulkan dan mengembalikan jejak yang terkumpul.
 * @returns {JejakPanggilan[]}
 */
export function ambilJejak() {
  const hasil = jejakAktif || [];
  jejakAktif = null;
  return hasil;
}

/** Menyusun URL lengkap beserta parameter kueri, melewati nilai kosong. */
function susunUrl(jalur, kueri) {
  const url = new URL(`${API_BASE}${jalur}`, window.location.origin);
  for (const [kunci, nilai] of Object.entries(kueri || {})) {
    if (nilai === undefined || nilai === null || nilai === '') continue;
    url.searchParams.set(kunci, String(nilai));
  }
  // Dikembalikan sebagai jalur relatif supaya tetap lewat proxy dev server.
  return url.pathname + url.search;
}

/** Menentukan sebab kegagalan dari kode status HTTP. */
function sebabDariStatus(status) {
  if (status === 404 || status === 501) return SEBAB.BELUM_ADA;
  if (status >= 500) return SEBAB.SERVER;
  if (status >= 400) return SEBAB.DITOLAK;
  return SEBAB.LAINNYA;
}

/**
 * Permintaan dasar. Semua fungsi lain di lapisan API bermuara ke sini.
 *
 * @param {string} jalur                 jalur setelah API_BASE, contoh "/route"
 * @param {object} [opsi]
 * @param {'GET'|'POST'} [opsi.metode='GET']
 * @param {object} [opsi.kueri]          parameter kueri
 * @param {object} [opsi.badan]          badan permintaan untuk POST, dikirim sebagai JSON
 * @param {number} [opsi.timeoutMs=10000]
 * @param {AbortSignal} [opsi.signal]    sinyal pembatalan dari pemanggil
 * @param {'json'|'blob'|'text'} [opsi.bentuk='json'] bentuk balasan yang diharapkan
 * @returns {Promise<any>}
 * @throws {ApiError}
 */
export async function minta(jalur, {
  metode = 'GET',
  kueri,
  badan,
  timeoutMs = 10_000,
  signal,
  bentuk = 'json',
} = {}) {
  const url = susunUrl(jalur, kueri);
  const mulai = performance.now();

  // Dua sumber pembatalan digabung. Satu dari batas waktu, satu dari
  // pemanggil. AbortSignal.any dipakai bila tersedia, kalau tidak dipakai
  // cara manual supaya tetap jalan di peramban yang sedikit lebih lama.
  const pengendaliWaktu = new AbortController();
  const penghitung = setTimeout(() => pengendaliWaktu.abort(new Error('timeout')), timeoutMs);
  let sinyalGabungan = pengendaliWaktu.signal;
  if (signal) {
    sinyalGabungan = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([pengendaliWaktu.signal, signal])
      : pengendaliWaktu.signal;
    if (typeof AbortSignal.any !== 'function') {
      signal.addEventListener('abort', () => pengendaliWaktu.abort(), { once: true });
    }
  }

  const catat = (berhasil, status, pesan) => {
    if (!jejakAktif) return;
    jejakAktif.push({
      jalur: url,
      lamaMs: performance.now() - mulai,
      berhasil,
      status,
      pesan,
    });
  };

  let tanggapan;
  try {
    tanggapan = await fetch(url, {
      method: metode,
      signal: sinyalGabungan,
      headers: badan ? { 'Content-Type': 'application/json' } : undefined,
      body: badan ? JSON.stringify(badan) : undefined,
    });
  } catch (e) {
    clearTimeout(penghitung);
    // Pembatalan oleh pengguna dibedakan dari batas waktu, karena yang
    // pertama tidak perlu memunculkan pesan galat apa pun di layar.
    const dibatalkanPengguna = signal?.aborted;
    const sebab = dibatalkanPengguna ? SEBAB.DIBATALKAN
      : pengendaliWaktu.signal.aborted ? SEBAB.WAKTU_HABIS
        : SEBAB.TIDAK_TERHUBUNG;
    const pesan = sebab === SEBAB.WAKTU_HABIS
      ? 'Permintaan melewati batas waktu.'
      : sebab === SEBAB.DIBATALKAN
        ? 'Permintaan dibatalkan.'
        : 'Backend JakSafe tidak dapat dihubungi.';
    catat(false, 0, pesan);
    throw new ApiError(pesan, { status: 0, jalur: url, sebab });
  }
  clearTimeout(penghitung);

  if (!tanggapan.ok) {
    // Backend selalu membalas galat dalam bentuk JSON { ok:false, error },
    // lihat berkas di backend/src/routes. Jenis isi balasan karena itu
    // bisa dipakai untuk membedakan dua hal yang kelihatannya sama.
    const jenisIsi = tanggapan.headers.get('content-type') || '';
    const dariBackend = jenisIsi.includes('application/json');

    // Perlakuan khusus untuk 5xx yang isinya bukan JSON. Saat backend mati,
    // dev server Vite tidak bisa meneruskan permintaan dan ia sendiri yang
    // menjawab 500 dengan badan kosong bertipe text/plain. Kalau itu
    // dibaca apa adanya, pengguna akan melihat pesan "galat server" yang
    // menyesatkan, padahal masalahnya backend belum dijalankan. Karena
    // itu keadaan ini digolongkan sebagai tidak terhubung.
    if (tanggapan.status >= 500 && !dariBackend) {
      const pesanProxy = 'Backend JakSafe tidak dapat dihubungi.';
      catat(false, tanggapan.status, pesanProxy);
      throw new ApiError(pesanProxy, {
        status: tanggapan.status,
        jalur: url,
        sebab: SEBAB.TIDAK_TERHUBUNG,
      });
    }

    let pesan = `Permintaan gagal dengan status ${tanggapan.status}.`;
    if (dariBackend) {
      try {
        const isi = await tanggapan.json();
        if (isi?.error) pesan = String(isi.error);
      } catch {
        /* balasan menyebut JSON tetapi isinya rusak, pesan bawaan dipakai */
      }
    }
    catat(false, tanggapan.status, pesan);
    throw new ApiError(pesan, {
      status: tanggapan.status,
      jalur: url,
      sebab: sebabDariStatus(tanggapan.status),
    });
  }

  catat(true, tanggapan.status);

  if (bentuk === 'blob') return tanggapan.blob();
  if (bentuk === 'text') return tanggapan.text();
  return tanggapan.json();
}

/**
 * Membangun URL penuh untuk sumber daya yang dipakai langsung oleh elemen
 * HTML, misalnya atribut src pada tag img.
 *
 * Gambar CCTV sengaja tidak diunduh lewat fetch lalu diubah menjadi blob.
 * Dibiarkan diambil langsung oleh tag img supaya peramban yang mengurus
 * pemuatan bertahap, pembatalan saat elemen dilepas, dan penanganan galat
 * lewat peristiwa onerror.
 *
 * @param {string} jalur
 * @param {object} [kueri]
 * @returns {string}
 */
export function urlSumberDaya(jalur, kueri) {
  return susunUrl(jalur, kueri);
}
