import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getSavedRoutesByUser,
  createSavedRoute,
  deleteSavedRoute,
} from '../db/storageService.js';

const router = Router();

// Semua endpoint rute tersimpan memerlukan autentikasi
router.use(requireAuth);

// GET /api/routes/saved -> ambil daftar rute tersimpan milik pengguna yang sedang login
router.get('/', async (req, res) => {
  try {
    const list = await getSavedRoutesByUser(req.user.id);
    res.json({
      ok: true,
      count: list.length,
      routes: list,
    });
  } catch (err) {
    console.error('[routes/saved] Error fetching saved routes:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal mengambil daftar rute tersimpan',
    });
  }
});

// POST /api/routes/saved -> simpan rute baru ke database
router.post('/', async (req, res) => {
  const {
    title,
    origin,
    destination,
    score,
    distanceM,
    durationS,
    profile,
  } = req.body || {};

  if (!origin?.name || !destination?.name) {
    return res.status(400).json({
      ok: false,
      error: 'Data titik asal (origin) dan tujuan (destination) wajib diisi',
    });
  }

  try {
    const saved = await createSavedRoute({
      userId: req.user.id,
      title,
      origin,
      destination,
      score,
      distanceM,
      durationS,
      profile,
    });

    res.status(201).json({
      ok: true,
      message: 'Rute berhasil disimpan',
      route: saved,
    });
  } catch (err) {
    console.error('[routes/saved] Error saving route:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal menyimpan rute ke basis data',
    });
  }
});

// DELETE /api/routes/saved/:id -> hapus rute tersimpan
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteSavedRoute(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: 'Rute tersimpan tidak ditemukan atau bukan milik Anda',
      });
    }
    res.json({
      ok: true,
      message: 'Rute tersimpan berhasil dihapus',
    });
  } catch (err) {
    console.error('[routes/saved] Error deleting route:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal menghapus rute tersimpan',
    });
  }
});

export default router;

