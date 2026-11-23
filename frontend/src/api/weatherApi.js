import { minta } from './httpClient.js';

/**
 * Mengambil data cuaca terkini (Hybrid BMKG + Open-Meteo fallback) untuk koordinat peta.
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function ambilCuaca(lat, lon, { signal } = {}) {
  const qs = new URLSearchParams({
    lat: Number(lat).toFixed(4),
    lon: Number(lon).toFixed(4),
  });
  const res = await minta(`/weather?${qs.toString()}`, {
    signal,
    batasWaktuMs: 8000,
    catatJejak: false,
  });
  return res?.weather || null;
}
