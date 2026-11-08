// Tool 5: get_traffic — multi-segment real-time traffic speed and delay from TomTom.
// Gemini function-calling declaration + executor.

import { getFlowSegment, sampleRouteTraffic } from '../../services/tomtom.js';

export const getTrafficDeclaration = {
  name: 'get_traffic',
  description:
    'Get real-time traffic flow speed, congestion delay percentage, and road closure status '
    + 'from TomTom across one or multiple points along a route corridor in Jakarta. '
    + 'Provide either `points` (array of {lat, lon} along the route for multi-segment sampling) '
    + 'or a single `lat` and `lon`.',
  parameters: {
    type: 'OBJECT',
    properties: {
      lat: { type: 'NUMBER', description: 'Latitude of a single point (if points array is not used)' },
      lon: { type: 'NUMBER', description: 'Longitude of a single point (if points array is not used)' },
      points: {
        type: 'ARRAY',
        description: 'Array of 2-4 coordinate points along the route corridor for multi-segment traffic sampling',
        items: {
          type: 'OBJECT',
          properties: {
            lat: { type: 'NUMBER', description: 'Latitude' },
            lon: { type: 'NUMBER', description: 'Longitude' },
          },
          required: ['lat', 'lon'],
        },
      },
    },
  },
};

/**
 * Execute get_traffic tool.
 * Supports multi-segment sampling via `points` or `geometry`, or single-point via `lat` & `lon`.
 * Returns aggregated speed, delayPercent, maxDelayPercent, roadClosure, worstSegment, and segments.
 */
export async function getTraffic({ lat, lon, points, geometry, distanceM } = {}) {
  try {
    if ((Array.isArray(points) && points.length > 0) || (Array.isArray(geometry) && geometry.length > 0)) {
      const agg = await sampleRouteTraffic({ points, geometry, distanceM });
      return { ok: true, ...agg };
    }

    const numLat = Number(lat);
    const numLon = Number(lon);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLon)) {
      return { ok: false, error: 'Provide either points/geometry array or numeric lat and lon' };
    }

    const data = await getFlowSegment(numLat, numLon);
    return {
      ok: true,
      lat: numLat,
      lon: numLon,
      ...data,
      avgDelayPercent: data.delayPercent,
      maxDelayPercent: data.delayPercent,
      sampleCount: 1,
      worstSegment: {
        lat: numLat,
        lon: numLon,
        ratio: 0.5,
        delayPercent: data.delayPercent,
        currentSpeedKmH: data.currentSpeedKmH,
        roadClosure: data.roadClosure,
      },
      segments: [{ lat: numLat, lon: numLon, ratio: 0.5, ...data }],
    };
  } catch (err) {
    return { ok: false, error: err.message || 'failed_to_fetch_traffic' };
  }
}
