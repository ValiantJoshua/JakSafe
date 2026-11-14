import { Router } from 'express';
import {
  getActiveHazardAlerts,
  findAlertsAlongRoute,
} from '../services/hazardAlertService.js';

const router = Router();

// GET /api/alerts -> daftar area rawan banjir, hujan aktif, & temuan AI Vision Jakarta
router.get('/', async (req, res) => {
  const region = typeof req.query.region === 'string' ? req.query.region : '';
  const minSeverity = ['pantau', 'waspada', 'siaga'].includes(req.query.minSeverity)
    ? req.query.minSeverity
    : 'pantau';

  try {
    const result = await getActiveHazardAlerts({ region, minSeverity });
    res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error('[routes/alerts] Error fetching alerts:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal mengambil peringatan area rawan',
    });
  }
});

// POST /api/alerts/check-route -> periksa titik rawan di sepanjang geometri rute
router.post('/check-route', async (req, res) => {
  const { geometry, radiusM = 900, minSeverity = 'pantau' } = req.body || {};

  if (!Array.isArray(geometry) || geometry.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'geometry berupa array koordinat [[lon, lat], ...] wajib diisi',
    });
  }

  try {
    const matched = await findAlertsAlongRoute(geometry, { radiusM, minSeverity });
    res.json({
      ok: true,
      count: matched.length,
      alerts: matched,
    });
  } catch (err) {
    console.error('[routes/alerts] Error checking route hazards:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal memeriksa area rawan di sepanjang rute',
    });
  }
});

export default router;

