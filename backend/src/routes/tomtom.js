import { Router } from 'express';
import {
  getFlowTile,
  getFlowSegment,
  sampleRouteTraffic,
  getCurrentBudget,
  getDailyBudgetLimit,
} from '../services/tomtom.js';
import { parseCoords, RouteError } from '../services/osrm.js';

const router = Router();

// GET /api/tomtom/status
// Reports whether an API key is configured and the remaining budget.
// Used by the frontend traffic layer to determine whether to run in Live or Simulated mode.
router.get('/status', async (_req, res) => {
  try {
    const hasKey = Boolean(process.env.TOMTOM_API_KEY);
    const budget = await getCurrentBudget();
    res.json({
      hasKey,
      dailyCount: budget.count,
      budget: getDailyBudgetLimit(),
      date: budget.date,
    });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_get_status' });
  }
});

// GET /api/tomtom/flow/:z/:x/:y.pbf
// Serves Mapbox Vector Tile (.pbf) flow tiles for CesiumJS live traffic coloring.
router.get('/flow/:z/:x/:y.pbf', async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);

  try {
    const { buf, cacheStatus } = await getFlowTile(z, x, y);
    res.set({
      'Content-Type': 'application/x-protobuf',
      'Cache-Control': 'no-store',
      'x-tomtom-cache': cacheStatus,
    });
    res.send(buf);
  } catch (err) {
    const msg = err?.message || '';
    if (msg === 'invalid_tile') return res.status(400).json({ error: 'invalid_tile' });
    if (msg === 'no_key') return res.status(503).json({ error: 'no_key' });
    if (msg === 'budget_exceeded') return res.status(429).json({ error: 'budget_exceeded' });
    if (msg === 'upstream_error') return res.status(502).json({ error: 'upstream_error' });
    console.error('[tomtom-tile]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/tomtom/segment?point=lat,lon (or coords=lon,lat[;lon2,lat2;...])
// Returns real-time speed, free-flow speed, and delay percentage for a single coordinate or multi-segment corridor.
router.get('/segment', async (req, res) => {
  try {
    if (req.query.coords && String(req.query.coords).includes(';')) {
      const coords = parseCoords(req.query.coords, 2);
      const points = coords.map(([pLon, pLat]) => ({ lat: pLat, lon: pLon }));
      const data = await sampleRouteTraffic({ points });
      return res.json({ ok: true, lat: data.lat, lon: data.lon, data });
    }

    let lat, lon;
    if (req.query.point) {
      const parts = String(req.query.point).split(',');
      lat = Number(parts[0]);
      lon = Number(parts[1]);
    } else if (req.query.coords) {
      const [[pLon, pLat]] = parseCoords(req.query.coords, 1);
      lat = pLat;
      lon = pLon;
    } else {
      return res.status(400).json({ ok: false, error: 'point or coords parameter required' });
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ ok: false, error: 'invalid coordinate' });
    }

    const data = await getFlowSegment(lat, lon);
    res.json({ ok: true, lat, lon, data });
  } catch (err) {
    const msg = err?.message || '';
    if (msg === 'no_key') return res.status(503).json({ ok: false, error: 'no_key' });
    if (msg === 'budget_exceeded') return res.status(429).json({ ok: false, error: 'budget_exceeded' });
    if (err instanceof RouteError) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[tomtom-segment]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

export default router;
