import { Router } from 'express';
import { loadCatalog, getCameraById, findNearest, publicView } from '../services/cctvCatalog.js';
import { fetchFrame, FrameError, assertPublicHttpUrl, fetchPublicUrl, readCapped } from '../services/cctvFrame.js';
import { parseCoords, RouteError } from '../services/osrm.js';
import { analyzeRoadImage, VisionError } from '../services/geminiVision.js';
import { cctvVisionCache } from '../services/cacheService.js';
import { recordVisionHazardObservation } from '../services/hazardAlertService.js';
import {
  attachHealth,
  getHealthSummary,
  recordCameraHealth,
} from '../services/cctvHealthService.js';

const router = Router();

// GET /api/cctv/health  -> aggregate online/offline/unknown camera status summary
router.get('/health', (_req, res) => {
  res.json({ ok: true, ...getHealthSummary() });
});

// GET /api/cctv/sources  -> all cameras (without source URLs)
router.get('/sources', (_req, res) => {
  const cameras = loadCatalog().map((c) => attachHealth(publicView(c)));
  res.json({ ok: true, count: cameras.length, summary: getHealthSummary(), cameras });
});

// GET /api/cctv/nearest?coords=lon,lat&radius=500&limit=3
router.get('/nearest', (req, res) => {
  try {
    const [[lon, lat]] = parseCoords(req.query.coords, 1);
    const radiusM = Math.min(Math.max(Number(req.query.radius) || 500, 50), 5000);
    const limit = Math.min(Math.max(Number(req.query.limit) || 3, 1), 10);
    const found = findNearest(lat, lon, { radiusM, limit })
      .map((x) => ({ ...attachHealth(publicView(x.camera)), distanceM: x.distanceM }));
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
  if (!camera.url) {
    return res.status(404).json({ ok: false, error: 'no snapshot available for HLS-only camera' });
  }
  const startedAt = Date.now();
  try {
    const { buffer, contentType, fetchedAt } = await fetchFrame(camera);
    recordCameraHealth(camera.id, {
      status: 'online',
      latencyMs: Date.now() - startedAt,
    });
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Frame-Fetched-At': fetchedAt,
    });
    res.send(buffer);
  } catch (e) {
    recordCameraHealth(camera.id, {
      status: 'offline',
      reason: e.message,
      latencyMs: Date.now() - startedAt,
    });
    if (e instanceof FrameError) return res.status(e.status).json({ ok: false, error: e.message });
    console.error('[cctv/frame]', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

/**
 * Rewrites relative paths in an HLS m3u8 playlist to route through the backend proxy.
 */
function rewriteM3u8(m3u8Text, baseUrl, camId) {
  const lines = m3u8Text.split(/\r?\n/);
  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    try {
      const resolved = new URL(trimmed, baseUrl).toString();
      const b64 = Buffer.from(resolved, 'utf8').toString('base64url');
      if (trimmed.includes('.m3u8')) {
        return `/api/cctv/stream/${encodeURIComponent(camId)}/playlist.m3u8?u=${b64}`;
      }
      return `/api/cctv/stream/${encodeURIComponent(camId)}/segment.ts?u=${b64}`;
    } catch {
      return line;
    }
  }).join('\n');
}

const MAX_PLAYLIST_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_SEGMENT_BYTES = 10 * 1024 * 1024; // 10 MB

// GET /api/cctv/stream/:id.m3u8 -> Master HLS Playlist proxy
router.get('/stream/:id.m3u8', async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ ok: false, error: 'camera not found' });
  if (!camera.hlsUrl) return res.status(404).json({ ok: false, error: 'no live stream available for this camera' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const camOrigin = new URL(camera.hlsUrl).origin;
    const { res: upstreamRes, finalUrl } = await fetchPublicUrl(camera.hlsUrl, {
      signal: controller.signal,
      allowedOrigin: camOrigin,
      headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)' },
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({ ok: false, error: `camera stream responded ${upstreamRes.status}` });
    }

    const buf = await readCapped(upstreamRes, MAX_PLAYLIST_BYTES);
    const text = buf.toString('utf8');
    const rewritten = rewriteM3u8(text, finalUrl, camera.id);
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
    res.send(rewritten);
  } catch (err) {
    console.warn(`[cctv/stream/${req.params.id}.m3u8]`, err.message);
    const status = err instanceof FrameError && err.status === 403 ? 403 : 502;
    res.status(status).json({ ok: false, error: 'failed to fetch live stream' });
  } finally {
    clearTimeout(timer);
  }
});

// GET /api/cctv/stream/:id/playlist.m3u8 -> Sub-Playlist HLS proxy
router.get('/stream/:id/playlist.m3u8', async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ ok: false, error: 'camera not found' });
  if (!camera.hlsUrl) return res.status(404).json({ ok: false, error: 'no live stream available for this camera' });

  const rawUrl = req.query.u;
  if (!rawUrl || typeof rawUrl !== 'string') return res.status(400).json({ ok: false, error: 'missing u param' });

  let targetUrl;
  let camOrigin;
  try {
    targetUrl = Buffer.from(rawUrl, 'base64url').toString('utf8');
    const u = await assertPublicHttpUrl(targetUrl);
    camOrigin = new URL(camera.hlsUrl).origin;
    if (u.origin !== camOrigin) {
      return res.status(403).json({ ok: false, error: 'forbidden stream host' });
    }
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid stream url' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const { res: upstreamRes, finalUrl } = await fetchPublicUrl(targetUrl, {
      signal: controller.signal,
      allowedOrigin: camOrigin,
      headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)' },
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({ ok: false, error: `sub-playlist responded ${upstreamRes.status}` });
    }

    const buf = await readCapped(upstreamRes, MAX_PLAYLIST_BYTES);
    const text = buf.toString('utf8');
    const rewritten = rewriteM3u8(text, finalUrl, camera.id);
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
    res.send(rewritten);
  } catch (err) {
    const status = err instanceof FrameError && err.status === 403 ? 403 : 502;
    res.status(status).json({ ok: false, error: 'failed to fetch sub-playlist' });
  } finally {
    clearTimeout(timer);
  }
});

// GET /api/cctv/stream/:id/segment.ts -> Video chunk proxy
router.get('/stream/:id/segment.ts', async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ ok: false, error: 'camera not found' });
  if (!camera.hlsUrl) return res.status(404).json({ ok: false, error: 'no live stream available for this camera' });

  const rawUrl = req.query.u;
  if (!rawUrl || typeof rawUrl !== 'string') return res.status(400).json({ ok: false, error: 'missing u param' });

  let targetUrl;
  let camOrigin;
  try {
    targetUrl = Buffer.from(rawUrl, 'base64url').toString('utf8');
    const u = await assertPublicHttpUrl(targetUrl);
    camOrigin = new URL(camera.hlsUrl).origin;
    if (u.origin !== camOrigin) {
      return res.status(403).json({ ok: false, error: 'forbidden stream host' });
    }
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid stream url' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const { res: upstreamRes } = await fetchPublicUrl(targetUrl, {
      signal: controller.signal,
      allowedOrigin: camOrigin,
      headers: { 'User-Agent': 'jaksafe-backend/dev (academic project)' },
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send();
    }

    const buf = await readCapped(upstreamRes, MAX_SEGMENT_BYTES);
    res.set({
      'Content-Type': 'video/MP2T',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    });
    res.send(buf);
  } catch (err) {
    const status = err instanceof FrameError && err.status === 403 ? 403 : 502;
    res.status(status).send();
  } finally {
    clearTimeout(timer);
  }
});

// GET /api/cctv/analyze/:id -> fetch the camera's current frame and run Gemini Vision on it.
// Uses shared cctvVisionCache (TTL 90s) so frontend interactions and ReAct agent share results.
router.get('/analyze/:id', async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) return res.status(404).json({ ok: false, error: 'camera not found' });

  const cacheKey = `cctv:${camera.id}`;
  const hit = cctvVisionCache.get(cacheKey);
  if (hit) {
    return res.json({ ok: true, cached: true, ...hit });
  }

  const startedAt = Date.now();
  try {
    const { buffer, contentType, fetchedAt } = await fetchFrame(camera);
    recordCameraHealth(camera.id, {
      status: 'online',
      latencyMs: Date.now() - startedAt,
    });
    const analysis = await analyzeRoadImage({
      base64: buffer.toString('base64'),
      mimeType: contentType,
      context: camera.name,
      cacheKey: `img:${camera.id}`,
    });
    recordVisionHazardObservation({
      cameraId: camera.id,
      cameraName: camera.name,
      lat: camera.lat,
      lon: camera.lon,
      analysis,
      observedAt: fetchedAt,
    });
    const payload = { camera: attachHealth(publicView(camera)), fetchedAt, analysis };
    cctvVisionCache.set(cacheKey, payload);
    res.json({ ok: true, cached: false, ...payload });
  } catch (e) {
    if (e instanceof FrameError) {
      recordCameraHealth(camera.id, {
        status: 'offline',
        reason: e.message,
        latencyMs: Date.now() - startedAt,
      });
    }
    if (e instanceof FrameError || e instanceof VisionError) {
      return res.status(e.status).json({ ok: false, error: e.message });
    }
    console.error('[cctv/analyze]', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

export default router;
