// Tool 2: get_aqi — air quality & atmosphere data for given coordinates.
// Gemini function-calling declaration + executor. The agent chooses extra metrics
// dynamically based on the user's request (e.g. UV for motorcyclists, ammonia near industry).

import { getAirQuality, METRIC_CATALOGUE } from '../../services/openMeteo.js';

const metricHelp = Object.entries(METRIC_CATALOGUE)
  .map(([k, v]) => `${k}: ${v}`)
  .join('; ');

export const getAqiDeclaration = {
  name: 'get_aqi',
  description:
    'Get current air quality and atmospheric data (Open-Meteo) for one or more points in Jakarta. '
    + 'pm2_5 and us_aqi are always returned. Request extra metrics ONLY when relevant to the user '
    + `(e.g. uv_index for riders/hot midday, ammonia near industrial areas). Known metrics — ${metricHelp}. `
    + 'Metrics listed under "unavailable" have no data for that location; say so instead of guessing.',
  parameters: {
    type: 'OBJECT',
    properties: {
      points: {
        type: 'ARRAY',
        description: 'Sample points along a route (1-12). Use route midpoints for long routes.',
        items: {
          type: 'OBJECT',
          properties: {
            lat: { type: 'NUMBER', description: 'Latitude' },
            lon: { type: 'NUMBER', description: 'Longitude' },
          },
          required: ['lat', 'lon'],
        },
      },
      extra_metrics: {
        type: 'ARRAY',
        description: 'Additional Open-Meteo variable names, e.g. ["uv_index", "nitrogen_dioxide"].',
        items: { type: 'STRING' },
      },
    },
    required: ['points'],
  },
};

/** Execute Tool 2. Returns data (or an error object) the model can reason over. */
export async function getAqi({ points, extra_metrics: extraMetrics } = {}) {
  try {
    const result = await getAirQuality({ points, metrics: extraMetrics });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
