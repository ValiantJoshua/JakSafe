import { Router } from 'express';
import { runNavigationAgent } from '../agent/reactAgent.js';

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

  const validProfiles = ['car', 'bike', 'foot'];
  const sanitizedProfile = validProfiles.includes(profile) ? profile : 'car';

  try {
    const result = await runNavigationAgent({
      origin: { lat: Number(origin.lat), lon: Number(origin.lon) },
      destination: { lat: Number(destination.lat), lon: Number(destination.lon) },
      profile: sanitizedProfile,
      preferences: {
        healthSensitive: Boolean(preferences.healthSensitive),
      },
    });

    res.json(result);
  } catch (err) {
    console.error('[navigate] Agent execution error:', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Gagal menjalankan navigasi cerdas',
    });
  }
});

export default router;

