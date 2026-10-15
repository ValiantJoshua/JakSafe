// Tool 3: get_cctv_snapshot — fetch the current frame of the nearest CCTV camera.
// Returns base64 image + metadata, ready to be passed to Tool 4 (analyze_image).

import { findNearest, publicView } from '../../services/cctvCatalog.js';
import { fetchFrame } from '../../services/cctvFrame.js';

export const getCctvSnapshotDeclaration = {
  name: 'get_cctv_snapshot',
  description:
    'Fetch the current CCTV snapshot of the camera nearest to a point (e.g. a flood-prone spot on the route). '
    + 'Returns the image (base64) and camera metadata. If no camera is near the point, returns ok=false — '
    + 'then treat road condition as unknown, do not guess. Call on-demand only; never poll.',
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
export async function getCctvSnapshot({ lat, lon, radius_m: radiusM = 500 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, error: 'lat and lon are required numbers' };
  }
  const candidates = findNearest(lat, lon, {
    radiusM: Math.min(Math.max(radiusM, 50), 5000),
    limit: 3,
  });
  if (!candidates.length) {
    return { ok: false, error: 'no camera within radius', cameraFound: false };
  }

  const errors = [];
  for (const { camera, distanceM } of candidates) {
    try {
      const { buffer, contentType, fetchedAt } = await fetchFrame(camera);
      return {
        ok: true,
        camera: { ...publicView(camera), distanceM },
        image: { mimeType: contentType, base64: buffer.toString('base64'), bytes: buffer.length },
        fetchedAt,
      };
    } catch (e) {
      errors.push({ cameraId: camera.id, error: e.message });
    }
  }
  return { ok: false, error: 'all nearby cameras failed', cameraFound: true, attempts: errors };
}
