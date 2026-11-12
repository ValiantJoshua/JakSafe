/*
   Lapisan API Autentikasi Pengguna & Rute Tersimpan (Backend JakSafe Opsi A).
*/

import { minta } from './httpClient.js';

/**
 * Masuk akun pengguna dengan email dan kata sandi.
 * @param {{ email: string, password: string }} kredensial
 */
export async function masukPengguna({ email, password }) {
  return await minta('/auth/login', {
    metode: 'POST',
    badan: { email, password },
  });
}

/**
 * Pendaftaran akun baru.
 * @param {{ email: string, password: string, name?: string, isHealthSensitive?: boolean, conditions?: string[] }} data
 */
export async function daftarPengguna(data) {
  return await minta('/auth/register', {
    metode: 'POST',
    badan: data,
  });
}

/**
 * Mengambil profil pengguna saat ini berdasarkan token JWT.
 * @param {string} token
 */
export async function ambilProfilSaya(token) {
  return await minta('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Memperbarui profil pengguna (nama atau status sensitif kesehatan).
 * @param {string} token
 * @param {{ name?: string, isHealthSensitive?: boolean, conditions?: string[] }} payload
 */
export async function perbaruiProfil(token, payload) {
  return await minta('/auth/profile', {
    metode: 'PUT',
    badan: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Mengambil seluruh rute tersimpan milik pengguna yang sedang login.
 * @param {string} token
 */
export async function ambilSemuaRuteTersimpan(token) {
  const res = await minta('/routes/saved', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.routes || [];
}

/**
 * Menyimpan rute baru ke basis data backend.
 * @param {string} token
 * @param {object} rutePayload
 */
export async function simpanRute(token, rutePayload) {
  return await minta('/routes/saved', {
    metode: 'POST',
    badan: rutePayload,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Menghapus rute tersimpan dari basis data backend.
 * @param {string} token
 * @param {string} ruteId
 */
export async function hapusRute(token, ruteId) {
  return await minta(`/routes/saved/${encodeURIComponent(ruteId)}`, {
    metode: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

