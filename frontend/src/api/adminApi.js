/*
   Lapisan API Dashboard Admin & Monitoring JakSafe.
   Seluruh panggilan membutuhkan token JWT pengguna dengan role "admin".
*/

import { minta } from './httpClient.js';

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function ambilDaftarCctvAdmin(
  token,
  { status = 'all', enabled = 'all', city = 'all', q = '', sort = 'status_offline_first', limit = 150, offset = 0 } = {}
) {
  const kueri = { status, enabled, city, sort, limit, offset };
  if (q && String(q).trim()) kueri.q = String(q).trim();
  return await minta('/admin/cctv', {
    kueri,
    headers: authHeaders(token),
    timeoutMs: 12_000,
  });
}

export async function picuSweepCctvAdmin(token, { wait = false } = {}) {
  return await minta('/admin/cctv/sweep', {
    metode: 'POST',
    badan: { wait: Boolean(wait) },
    headers: authHeaders(token),
    timeoutMs: wait ? 60_000 : 12_000,
  });
}

export async function ujiKameraCctvAdmin(token, id) {
  return await minta(`/admin/cctv/${encodeURIComponent(id)}/probe`, {
    metode: 'POST',
    badan: {},
    headers: authHeaders(token),
    timeoutMs: 15_000,
  });
}

export async function tambahKameraCctvAdmin(token, data) {
  return await minta('/admin/cctv', {
    metode: 'POST',
    badan: data || {},
    headers: authHeaders(token),
  });
}

export async function perbaruiKameraCctvAdmin(token, id, data) {
  return await minta(`/admin/cctv/${encodeURIComponent(id)}`, {
    metode: 'PUT',
    badan: data || {},
    headers: authHeaders(token),
  });
}

export async function ubahStatusAktifCctvAdmin(token, id, enabled) {
  return await minta(`/admin/cctv/${encodeURIComponent(id)}/toggle`, {
    metode: 'PATCH',
    badan: { enabled: Boolean(enabled) },
    headers: authHeaders(token),
  });
}

export async function hapusKameraCctvAdmin(token, id) {
  return await minta(`/admin/cctv/${encodeURIComponent(id)}`, {
    metode: 'DELETE',
    headers: authHeaders(token),
  });
}

export async function pulihkanKameraCctvAdmin(token, id) {
  return await minta(`/admin/cctv/${encodeURIComponent(id)}/restore`, {
    metode: 'POST',
    badan: {},
    headers: authHeaders(token),
  });
}

export async function ambilMonitoringOverviewAdmin(token) {
  return await minta('/admin/monitoring/overview', {
    headers: authHeaders(token),
    timeoutMs: 12_000,
  });
}

export async function ambilCacheStatsAdmin(token) {
  return await minta('/cache/stats', {
    headers: authHeaders(token),
    timeoutMs: 10_000,
  });
}

export async function ambilAuditLogAgenAdmin(
  token,
  { limit = 40, status = 'all', scoreLabel = 'all', fallbackOnly = false } = {}
) {
  const kueri = { limit, status, scoreLabel };
  if (fallbackOnly) kueri.fallbackOnly = 'true';
  return await minta('/admin/monitoring/logs', {
    kueri,
    headers: authHeaders(token),
    timeoutMs: 12_000,
  });
}

export async function bersihkanCacheAdmin(token, store = 'all') {
  return await minta('/admin/cache/clear', {
    metode: 'POST',
    badan: { store },
    headers: authHeaders(token),
  });
}
