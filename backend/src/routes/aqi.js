import { Router } from 'express';
import { getAirQuality, AirQualityError } from '../services/openMeteo.js';
import { parseCoords, RouteError } from '../services/osrm.js';

const router = Router();

// GET /api/aqi?coords=lon,lat[;lon,lat...]&metrics=uv_index,ammonia
// `metrics` is optional and DYNAMIC — pm2_5 and us_aqi are always included.
// Coordinates use the same lon,lat order as /api/route.
router.get('/', async (req, res) => {
  try {
    const points = parseCoords(req.query.coords, 1).map(([lon, lat]) => ({ lat, lon }));
    const result = await getAirQuality({ points, metrics: req.query.metrics });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof AirQualityError || e instanceof RouteError) {
      return res.status(e.status).json({ ok: false, error: e.message });
    }
    console.error('[aqi]', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

export default router;
