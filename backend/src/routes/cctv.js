import { Router } from 'express';
import { loadCatalog, getCameraById, findNearest, publicView } from '../services/cctvCatalog.js';
import { fetchFrame, FrameError } from '../services/cctvFrame.js';
import { parseCoords, RouteError } from '../services/osrm.js';

const router = Router();

// GET /api/cctv/sources  -> all cameras (without source URLs)
router.get('/sources', (_req, res) => {
  const cameras = loadCatalog().map(publicView);
  res.json({ ok: true, count: cameras.length, cameras });
});

// GET /api/cctv/nearest?coords=lon,lat&radius=500&limit=3
router.get('/nearest', (req, res) => {
  try {
    const [[lon, lat]] = parseCoords(req.query.coords, 1);
    const radiusM = Math.min(Math.max(Number(req.query.radius) || 500, 50), 5000);
    const limit = Math.min(Math.max(Number(req.query.limit) || 3, 1), 10);
    const found = findNearest(lat, lon, { radiusM, limit })
      .map((x) => ({ ...publicView(x.camera), distanceM: x.distanceM }));
    res.json({ ok: true, count: found.length, cameras: found });
  } catch (e) {
    if (e instanceof RouteError) return res.status(e.status).json({ ok: false, error: e.message });
    console.error('[cctv/nearest]', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// GET /api/cctv/frame/:id  -> the camera's current frame as an image
router.get('/frame/:id', async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ ok: false, error: 'camera not found' });
  try {
    const { buffer, contentType, fetchedAt } = await fetchFrame(camera);
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Frame-Fetched-At': fetchedAt,
    });
    res.send(buffer);
  } catch (e) {
    if (e instanceof FrameError) return res.status(e.status).json({ ok: false, error: e.message });
    console.error('[cctv/frame]', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

export default router;
