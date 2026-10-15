// Tool 5 (Bonus/Auxiliary): get_traffic — real-time traffic speed and delay from TomTom.
// Gemini function-calling declaration + executor.

import { getFlowSegment } from '../../services/tomtom.js';

export const getTrafficDeclaration = {
  name: 'get_traffic',
  description:
    'Get real-time traffic flow speed, congestion delay percentage, and road closure status '
    + 'from TomTom for a specific point in Jakarta. Use this to verify traffic congestion on candidate routes.',
  parameters: {
    type: 'OBJECT',
    properties: {
      lat: { type: 'NUMBER', description: 'Latitude of the point' },
      lon: { type: 'NUMBER', description: 'Longitude of the point' },
    },
    required: ['lat', 'lon'],
  },
};

/**
 * Execute get_traffic tool.
 * Returns speed, delayPercent, and roadClosure or an error object.
 */
export async function getTraffic({ lat, lon } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, error: 'lat and lon are required numbers' };
  }
  try {
    const data = await getFlowSegment(lat, lon);
    return { ok: true, lat, lon, ...data };
  } catch (err) {
    return { ok: false, error: err.message || 'failed_to_fetch_traffic' };
  }
}
