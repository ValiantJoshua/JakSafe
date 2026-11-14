import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getTripHistoryByUser,
  createTripHistory,
  deleteTripHistory,
  clearTripHistoryByUser,
} from '../db/storageService.js';

const router = Router();

// Semua endpoint riwayat perjalanan memerlukan autentikasi
router.use(requireAuth);

// GET /api/routes/history -> ambil daftar riwayat perjalanan pengguna (terbaru lebih dulu)
router.get('/', async (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 30;
  try {
    const history = await getTripHistoryByUser(req.user.id, { limit });
    res.json({
      ok: true,
      count: history.length,
      history,
    });
  } catch (err) {
    console.error('[routes/history] Error fetching trip history:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal mengambil riwayat perjalanan',
    });
  }
});

// POST /api/routes/history -> catat entri riwayat perjalanan baru
router.post('/', async (req, res) => {
  const {
    origin,
    destination,
    score,
    distanceM,
    durationS,
    profile,
    summary,
    source,
  } = req.body || {};

  if (!origin?.name || !destination?.name) {
    return res.status(400).json({
      ok: false,
      error: 'Data titik asal (origin) dan tujuan (destination) wajib diisi',
    });
  }

  try {
    const entry = await createTripHistory({
      userId: req.user.id,
      origin,
      destination,
      score,
      distanceM,
      durationS,
      profile,
      summary,
      source,
    });

    res.status(201).json({
      ok: true,
      message: 'Riwayat perjalanan tercatat',
      entry,
    });
  } catch (err) {
    console.error('[routes/history] Error creating trip history:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal menyimpan riwayat perjalanan',
    });
  }
});

// DELETE /api/routes/history -> bersihkan seluruh riwayat perjalanan milik pengguna saat ini
router.delete('/', async (req, res) => {
  try {
    const deletedCount = await clearTripHistoryByUser(req.user.id);
    res.json({
      ok: true,
      deletedCount,
      message: 'Seluruh riwayat perjalanan berhasil dibersihkan',
    });
  } catch (err) {
    console.error('[routes/history] Error clearing trip history:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal membersihkan riwayat perjalanan',
    });
  }
});

// DELETE /api/routes/history/:id -> hapus satu entri riwayat perjalanan
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteTripHistory(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: 'Entri riwayat perjalanan tidak ditemukan atau bukan milik Anda',
      });
    }
    res.json({
      ok: true,
      message: 'Entri riwayat perjalanan berhasil dihapus',
    });
  } catch (err) {
    console.error('[routes/history] Error deleting trip history entry:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal menghapus entri riwayat perjalanan',
    });
  }
});

export default router;

