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
 * Mengambil konfigurasi publik Google Sign-In (enabled + clientId) dari backend.
 */
export async function ambilKonfigurasiGoogle() {
  return await minta('/auth/google/config');
}

/**
 * Masuk atau daftar akun menggunakan Google ID Token atau OAuth2 Access Token.
 * @param {{ credential?: string, accessToken?: string, isHealthSensitive?: boolean }} payload
 */
export async function masukDenganGoogle({ credential, accessToken, isHealthSensitive = false }) {
  return await minta('/auth/google', {
    metode: 'POST',
    badan: { credential, accessToken, isHealthSensitive },
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
 * Mencabut sesi token aktif di server saat pengguna keluar (logout).
 * @param {string} token
 */
export async function keluarPengguna(token) {
  return await minta('/auth/logout', {
    metode: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Memperbarui profil pengguna (nama, status sensitif kesehatan, atau preferensi peringatan).
 * @param {string} token
 * @param {{ name?: string, isHealthSensitive?: boolean, conditions?: string[], alertPreferences?: object }} payload
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

/**
 * Mengambil riwayat perjalanan pengguna dari backend.
 * @param {string} token
 * @param {number} [limit=30]
 */
export async function ambilRiwayatPerjalanan(token, limit = 30) {
  const res = await minta('/routes/history', {
    kueri: { limit },
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.history || [];
}

/**
 * Mencatat perjalanan ke riwayat pengguna di backend.
 * @param {string} token
 * @param {object} riwayatPayload
 */
export async function catatRiwayatPerjalanan(token, riwayatPayload) {
  return await minta('/routes/history', {
    metode: 'POST',
    badan: riwayatPayload,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Menghapus satu entri riwayat perjalanan.
 * @param {string} token
 * @param {string} historyId
 */
export async function hapusRiwayat(token, historyId) {
  return await minta(`/routes/history/${encodeURIComponent(historyId)}`, {
    metode: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Mengosongkan seluruh riwayat perjalanan milik pengguna saat ini.
 * @param {string} token
 */
export async function kosongkanRiwayat(token) {
  return await minta('/routes/history', {
    metode: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

