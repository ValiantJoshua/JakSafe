import { Router } from 'express';
import { getRoutes, parseCoords, RouteError } from '../services/osrm.js';

const router = Router();

// GET /api/route?profile=car|bike|foot&coords=lon,lat;lon,lat[;...]&alternatives=true
router.get('/', async (req, res) => {
  try {
    const coords = parseCoords(req.query.coords);
    const profile = req.query.profile || 'car';
    const alternatives = req.query.alternatives === 'true';
    const result = await getRoutes({ profile, coords, alternatives });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof RouteError) {
      return res.status(e.status).json({ ok: false, error: e.message });
    }
    console.error('[route]', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

export default router;
