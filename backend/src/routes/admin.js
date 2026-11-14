import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  loadCatalog,
  getCameraById,
  adminView,
  createCamera,
  updateCamera,
  setCameraEnabled,
  deleteCamera,
  restoreCamera,
  getCatalogOverrideStats,
  CatalogError,
} from '../services/cctvCatalog.js';
import {
  attachHealth,
  getHealthSummary,
  runHealthSweep,
  checkCameraEndpoint,
  recordCameraHealth,
} from '../services/cctvHealthService.js';
import { getTomTomAdminStats } from '../services/tomtom.js';
import {
  getAllCacheStats,
  getCacheAggregateSummary,
  clearCacheByName,
} from '../services/cacheService.js';
import {
  getExecutionLogsForAdmin,
  getExecutionStatsForAdmin,
} from '../db/mongoClient.js';

const STATUS_SORT_ORDER = { offline: 0, unknown: 1, online: 2 };

export function createAdminRouter({ getRateLimitStats = () => [] } = {}) {
  const router = Router();

  // Seluruh endpoint admin dilindungi otentikasi JWT + otorisasi role admin
  router.use(requireAuth, requireAdmin);

  // GET /api/admin/cctv -> daftar kamera lengkap (online/offline/nonaktif) + ringkasan kesehatan
  router.get('/cctv', (req, res) => {
    const allCameras = loadCatalog({ includeDisabled: true });
    const allWithHealth = allCameras.map((c) => attachHealth(adminView(c)));

    const cities = [...new Set(allCameras.map((c) => c.city).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), 'id')
    );

    const statusFilter = String(req.query.status || 'all').toLowerCase();
    const enabledFilter = String(req.query.enabled || 'all').toLowerCase();
    const cityFilter = String(req.query.city || 'all');
    const q = String(req.query.q || '').trim().toLowerCase();
    const sortBy = String(req.query.sort || 'status_offline_first').toLowerCase();

    let filtered = allWithHealth.filter((cam) => {
      if (statusFilter !== 'all' && cam.status !== statusFilter) return false;
      if (enabledFilter === 'true' && !cam.enabled) return false;
      if (enabledFilter === 'false' && cam.enabled) return false;
      if (cityFilter !== 'all' && (cam.city || '') !== cityFilter) return false;
      if (q) {
        const hay = `${cam.id} ${cam.name} ${cam.city || ''} ${cam.provider || ''} ${cam.statusReason || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    } else if (sortBy === 'latency_desc') {
      filtered.sort((a, b) => (b.latencyMs ?? -1) - (a.latencyMs ?? -1));
    } else if (sortBy === 'status_online_first') {
      filtered.sort((a, b) => {
        const oa = a.status === 'online' ? 0 : a.status === 'unknown' ? 1 : 2;
        const ob = b.status === 'online' ? 0 : b.status === 'unknown' ? 1 : 2;
        return oa !== ob ? oa - ob : a.name.localeCompare(b.name, 'id');
      });
    } else {
      // status_offline_first (bawaan: prioritaskan kamera bermasalah agar cepat terlihat)
      filtered.sort((a, b) => {
        const oa = STATUS_SORT_ORDER[a.status] ?? 1;
        const ob = STATUS_SORT_ORDER[b.status] ?? 1;
        return oa !== ob ? oa - ob : a.name.localeCompare(b.name, 'id');
      });
    }

    const limitParam = req.query.limit;
    const limit = limitParam === 'all'
      ? filtered.length || 1
      : Math.min(Math.max(1, Number(limitParam) || 100), 1000);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const items = filtered.slice(offset, offset + limit);

    res.json({
      ok: true,
      totalCatalog: allCameras.length,
      totalMatched: filtered.length,
      offset,
      limit,
      cities,
      summary: getHealthSummary(allCameras),
      catalogStats: getCatalogOverrideStats(),
      cameras: items,
    });
  });

  // POST /api/admin/cctv/sweep -> picu runHealthSweep() manual oleh admin
  router.post('/cctv/sweep', async (req, res) => {
    const wait = req.query.wait === '1' || req.body?.wait === true;
    const activeCameras = loadCatalog({ includeDisabled: false });

    try {
      const sweepTask = runHealthSweep({ cameras: activeCameras });
      if (wait) {
        const stats = await sweepTask;
        return res.json({
          ok: true,
          started: true,
          sweepInProgress: false,
          stats,
          summary: getHealthSummary(loadCatalog({ includeDisabled: true })),
        });
      }

      // Jalankan asinkron agar tidak timeout pada ratusan kamera; klien UI melakukan polling status
      sweepTask.catch((err) => console.warn('[admin/sweep] background sweep error:', err?.message || err));
      return res.status(202).json({
        ok: true,
        started: true,
        sweepInProgress: true,
        summary: getHealthSummary(loadCatalog({ includeDisabled: true })),
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err?.message || 'Gagal menjalankan pemeriksaan kesehatan CCTV.',
      });
    }
  });

  // POST /api/admin/cctv/:id/probe -> uji 1 kamera secara langsung & perbarui cache kesehatannya
  router.post('/cctv/:id/probe', async (req, res) => {
    const camera = getCameraById(req.params.id, { includeDisabled: true });
    if (!camera) {
      return res.status(404).json({ ok: false, error: 'Kamera tidak ditemukan.' });
    }

    try {
      const result = await checkCameraEndpoint(camera);
      recordCameraHealth(camera.id, {
        status: result.status,
        reason: result.reason,
        latencyMs: result.latencyMs,
      });
      return res.json({
        ok: true,
        probe: result,
        camera: attachHealth(adminView(camera)),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || 'Gagal menguji kamera.' });
    }
  });

  // POST /api/admin/cctv -> tambah kamera baru tanpa mengedit cctvCatalog.json
  router.post('/cctv', async (req, res) => {
    try {
      const created = await createCamera(req.body || {}, {
        updatedBy: req.user?.email || req.user?.id || null,
      });
      return res.status(201).json({
        ok: true,
        message: 'Kamera baru ditambahkan ke katalog.',
        camera: attachHealth(adminView(created)),
        catalogStats: getCatalogOverrideStats(),
      });
    } catch (err) {
      const status = err instanceof CatalogError ? err.status : 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || 'Gagal menambahkan kamera baru.',
      });
    }
  });

  // PUT /api/admin/cctv/:id -> perbarui metadata atau URL kamera (tersimpan di override store)
  router.put('/cctv/:id', async (req, res) => {
    try {
      const updated = await updateCamera(req.params.id, req.body || {}, {
        updatedBy: req.user?.email || req.user?.id || null,
      });
      return res.json({
        ok: true,
        message: 'Data kamera berhasil diperbarui.',
        camera: attachHealth(adminView(updated)),
        catalogStats: getCatalogOverrideStats(),
      });
    } catch (err) {
      const status = err instanceof CatalogError ? err.status : 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || 'Gagal memperbarui data kamera.',
      });
    }
  });

  // PATCH /api/admin/cctv/:id/toggle -> aktif/nonaktifkan kamera bermasalah secara instan
  router.patch('/cctv/:id/toggle', async (req, res) => {
    try {
      const existing = getCameraById(req.params.id, { includeDisabled: true });
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'Kamera tidak ditemukan di katalog.' });
      }
      const nextEnabled = req.body?.enabled !== undefined
        ? Boolean(req.body.enabled)
        : existing.enabled === false;
      const updated = await setCameraEnabled(req.params.id, nextEnabled, {
        updatedBy: req.user?.email || req.user?.id || null,
      });
      return res.json({
        ok: true,
        message: nextEnabled ? 'Kamera diaktifkan kembali.' : 'Kamera dinonaktifkan dari layanan publik.',
        camera: attachHealth(adminView(updated)),
        catalogStats: getCatalogOverrideStats(),
      });
    } catch (err) {
      const status = err instanceof CatalogError ? err.status : 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || 'Gagal mengubah status aktif kamera.',
      });
    }
  });

  // DELETE /api/admin/cctv/:id -> hapus kamera kustom atau sembunyikan kamera bawaan
  router.delete('/cctv/:id', async (req, res) => {
    try {
      const result = await deleteCamera(req.params.id, {
        updatedBy: req.user?.email || req.user?.id || null,
      });
      return res.json({
        ok: true,
        message: result.recoverable
          ? 'Kamera bawaan dihapus dari daftar aktif (dapat dipulihkan).'
          : 'Kamera kustom dihapus permanen.',
        ...result,
        catalogStats: getCatalogOverrideStats(),
      });
    } catch (err) {
      const status = err instanceof CatalogError ? err.status : 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || 'Gagal menghapus kamera.',
      });
    }
  });

  // POST /api/admin/cctv/:id/restore -> pulihkan kamera bawaan ke setelan cctvCatalog.json
  router.post('/cctv/:id/restore', async (req, res) => {
    try {
      const restored = await restoreCamera(req.params.id);
      return res.json({
        ok: true,
        message: 'Kamera bawaan dipulihkan ke konfigurasi standar.',
        camera: restored ? attachHealth(adminView(restored)) : null,
        catalogStats: getCatalogOverrideStats(),
      });
    } catch (err) {
      const status = err instanceof CatalogError ? err.status : 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || 'Gagal memulihkan kamera bawaan.',
      });
    }
  });

  // GET /api/admin/monitoring/overview -> ringkasan kuota TomTom, cache stats, rate limit & performa agen
  router.get('/monitoring/overview', async (_req, res) => {
    try {
      const [tomtom, execution] = await Promise.all([
        getTomTomAdminStats(),
        getExecutionStatsForAdmin(),
      ]);
      const cacheStores = getAllCacheStats();
      const cacheSummary = getCacheAggregateSummary();

      return res.json({
        ok: true,
        time: new Date().toISOString(),
        tomtom,
        cache: {
          summary: cacheSummary,
          stores: cacheStores,
        },
        execution,
        rateLimits: getRateLimitStats(),
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err?.message || 'Gagal memuat metrik monitoring sistem.',
      });
    }
  });

  // GET /api/admin/monitoring/logs -> daftar audit trail ExecutionLog
  router.get('/monitoring/logs', async (req, res) => {
    try {
      const data = await getExecutionLogsForAdmin({
        limit: req.query.limit,
        status: req.query.status || 'all',
        scoreLabel: req.query.scoreLabel || 'all',
        fallbackOnly: req.query.fallbackOnly === 'true' || req.query.fallbackOnly === '1',
      });
      return res.json({ ok: true, ...data });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err?.message || 'Gagal memuat audit trail ExecutionLog.',
      });
    }
  });

  // POST /api/admin/cache/clear -> bersihkan cache tertentu atau semua cache LRU
  router.post('/cache/clear', (req, res) => {
    const store = String(req.body?.store || 'all');
    const result = clearCacheByName(store);
    if (result.cleared.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nama store cache tidak dikenal.' });
    }
    return res.json({
      ok: true,
      message: store === 'all' ? 'Seluruh cache berhasil dibersihkan.' : `Cache ${store} dibersihkan.`,
      ...result,
      cache: getAllCacheStats(),
      summary: getCacheAggregateSummary(),
    });
  });

  return router;
}
