import { Router } from 'express';
import { runNavigationAgent } from '../agent/reactAgent.js';
import { navigationCache } from '../services/cacheService.js';

const router = Router();

// POST /api/navigate -> Intelligent Multi-Criteria Route Navigation via ReAct Agent
router.post('/', async (req, res) => {
  const { origin, destination, profile = 'car', preferences = {} } = req.body || {};

  if (
    !origin ||
    !Number.isFinite(Number(origin.lat)) ||
    !Number.isFinite(Number(origin.lon)) ||
    !destination ||
    !Number.isFinite(Number(destination.lat)) ||
    !Number.isFinite(Number(destination.lon))
  ) {
    return res.status(400).json({
      ok: false,
      error: 'origin and destination with numeric lat and lon are required',
    });
  }

  const validProfiles = ['car', 'motor', 'bike', 'foot'];
  const sanitizedProfile = validProfiles.includes(profile) ? profile : 'car';
  const isHealthSensitive = Boolean(preferences.healthSensitive);

  const originLat = Number(origin.lat);
  const originLon = Number(origin.lon);
  const destLat = Number(destination.lat);
  const destLon = Number(destination.lon);
  const originLabel = String(origin.label || origin.name || origin.nama || '').trim().slice(0, 160) || null;
  const destLabel = String(destination.label || destination.name || destination.nama || '').trim().slice(0, 160) || null;

  const cacheKey = `nav:${sanitizedProfile}:${originLat.toFixed(4)},${originLon.toFixed(4)}->${destLat.toFixed(4)},${destLon.toFixed(4)}:hs=${isHealthSensitive}`;

  // Check short-lived navigation cache (90s TTL) unless explicitly forced to refresh
  const bypassCache = Boolean(req.query.refresh || req.body.refresh);
  if (!bypassCache) {
    const cached = navigationCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }
  }

  try {
    const result = await runNavigationAgent({
      origin: { lat: originLat, lon: originLon, label: originLabel },
      destination: { lat: destLat, lon: destLon, label: destLabel },
      profile: sanitizedProfile,
      preferences: {
        healthSensitive: isHealthSensitive,
      },
    });

    if (result && result.ok) {
      navigationCache.set(cacheKey, result);
    }

    res.json({ ...result, cached: false });
  } catch (err) {
    console.error('[navigate] Agent execution error:', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Gagal menjalankan navigasi cerdas',
    });
  }
});

export default router;

