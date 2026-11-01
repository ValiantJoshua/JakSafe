import { Router } from 'express';
import { loadCatalog, getCameraById, findNearest, publicView } from '../services/cctvCatalog.js';
import { fetchFrame, FrameError } from '../services/cctvFrame.js';
import { parseCoords, RouteError } from '../services/osrm.js';
import { analyzeRoadImage, VisionError } from '../services/geminiVision.js';

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

// GET /api/cctv/analyze/:id -> fetch the camera's current frame and run Gemini Vision on it.
// Cached 60s per camera so repeated testing does not burn Gemini quota.
const analysisCache = new Map();
const ANALYSIS_TTL_MS = 60_000;

router.get('/analyze/:id', async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ ok: false, error: 'camera not found' });

  const hit = analysisCache.get(camera.id);
  if (hit && Date.now() - hit.at <= ANALYSIS_TTL_MS) {
    return res.json({ ok: true, cached: true, ...hit.payload });
  }

  try {
    const { buffer, contentType, fetchedAt } = await fetchFrame(camera);
    const analysis = await analyzeRoadImage({
      base64: buffer.toString('base64'),
      mimeType: contentType,
      context: camera.name,
    });
    const payload = { camera: publicView(camera), fetchedAt, analysis };
    analysisCache.set(camera.id, { at: Date.now(), payload });
    if (analysisCache.size > 100) analysisCache.delete(analysisCache.keys().next().value);
    res.json({ ok: true, cached: false, ...payload });
  } catch (e) {
    if (e instanceof FrameError || e instanceof VisionError) {
      return res.status(e.status).json({ ok: false, error: e.message });
    }
    console.error('[cctv/analyze]', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

export default router;
