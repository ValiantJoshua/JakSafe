// Tool 3: get_cctv_snapshot — fetch the current frame of the nearest CCTV camera.
// Returns base64 image + metadata, ready to be passed to Tool 4 (analyze_image).

import { findNearest, publicView } from '../../services/cctvCatalog.js';
import { fetchFrame } from '../../services/cctvFrame.js';
import {
  attachHealth,
  getCameraHealth,
  recordCameraHealth,
  sortCandidatesByHealth,
} from '../../services/cctvHealthService.js';

export const getCctvSnapshotDeclaration = {
  name: 'get_cctv_snapshot',
  description:
    'Fetch the current CCTV snapshot of the camera nearest to a point (e.g. a flood-prone spot on the route). '
    + 'Automatically skips known-offline cameras and prioritizes healthy online cameras. '
    + 'Returns the image (base64) and camera metadata. If no online camera is available near the point, returns ok=false — '
    + 'then treat road condition as unknown immediately without retrying the same point. Call on-demand only; never poll.',
  parameters: {
    type: 'OBJECT',
    properties: {
      lat: { type: 'NUMBER', description: 'Latitude of the point of interest' },
      lon: { type: 'NUMBER', description: 'Longitude of the point of interest' },
      radius_m: {
        type: 'NUMBER',
        description: 'Search radius in meters (default 500, max 5000)',
      },
    },
    required: ['lat', 'lon'],
  },
};

/**
 * Execute Tool 3. Tries up to 3 nearest cameras until one returns a valid frame.
 * Never throws — returns { ok:false, error } so the agent can reason about it.
 */
export async function getCctvSnapshot(
  { lat, lon, radius_m: radiusM = 500 } = {},
  { fetchFrameFn = fetchFrame } = {}
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, error: 'lat and lon are required numbers' };
  }
  const rawCandidates = findNearest(lat, lon, {
    radiusM: Math.min(Math.max(radiusM, 50), 5000),
    limit: 8,
  });
  if (!rawCandidates.length) {
    return { ok: false, error: 'no camera within radius', cameraFound: false };
  }

  // Skip cameras already marked offline so the agent never wastes 10-30s on dead endpoints
  const nonOffline = rawCandidates.filter(
    ({ camera }) => getCameraHealth(camera.id).status !== 'offline'
  );
  const skippedOfflineCount = rawCandidates.length - nonOffline.length;
  if (!nonOffline.length) {
    return {
      ok: false,
      error: 'all nearby cameras are currently offline',
      cameraFound: true,
      skippedOfflineCount,
      attempts: [],
    };
  }

  // Prioritize known-online cameras first, then unknown
  const candidates = sortCandidatesByHealth(nonOffline).slice(0, 3);

  const errors = [];
  for (const { camera, distanceM } of candidates) {
    const startedAt = Date.now();
    try {
      const { buffer, contentType, fetchedAt } = await fetchFrameFn(camera);
      recordCameraHealth(camera.id, {
        status: 'online',
        latencyMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        camera: { ...attachHealth(publicView(camera)), distanceM },
        image: { mimeType: contentType, base64: buffer.toString('base64'), bytes: buffer.length },
        fetchedAt,
      };
    } catch (e) {
      recordCameraHealth(camera.id, {
        status: 'offline',
        reason: e.message,
        latencyMs: Date.now() - startedAt,
      });
      errors.push({ cameraId: camera.id, error: e.message });
    }
  }
  return {
    ok: false,
    error: 'all nearby cameras failed',
    cameraFound: true,
    skippedOfflineCount,
    attempts: errors,
  };
}
