/*
   Lapisan API Peringatan Area Rawan Banjir & Hambatan Koridor (Backend JakSafe).
*/

import { minta } from './httpClient.js';

/**
 * Mengambil daftar area rawan banjir/genangan Jakarta yang aktif saat ini.
 * @param {{ region?: string, minSeverity?: 'pantau'|'waspada'|'siaga', signal?: AbortSignal }} [opsi]
 */
export async function ambilPeringatanArea({ region = '', minSeverity = 'pantau', signal } = {}) {
  const kueri = { minSeverity };
  if (region && region !== 'semua') kueri.region = region;
  return await minta('/alerts', { kueri, signal });
}

/**
 * Memeriksa apakah geometri rute melewati atau berdekatan dengan titik area rawan aktif.
 * @param {{ geometry: number[][], radiusM?: number, minSeverity?: 'pantau'|'waspada'|'siaga', signal?: AbortSignal }} opsi
 */
export async function cekPeringatanRute({ geometry, radiusM = 900, minSeverity = 'pantau', signal }) {
  if (!Array.isArray(geometry) || geometry.length === 0) {
    return { ok: true, count: 0, alerts: [] };
  }
  return await minta('/alerts/check-route', {
    metode: 'POST',
    badan: { geometry, radiusM, minSeverity },
    signal,
  });
}

