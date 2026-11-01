// Tool 1: get_route — OSRM routing service for Jakarta.
// Gemini function-calling declaration + executor.
// Fetches road geometry, baseline duration, and distance.

import { getRoutes, RouteError } from '../../services/osrm.js';

export const getRouteDeclaration = {
  name: 'get_route',
  description:
    'Get road routing options between origin and destination coordinates in Jakarta using OSRM. '
    + 'Returns distance in meters, duration in seconds, and coordinate geometry. '
    + 'Set alternatives=true to get alternative paths for multi-criteria comparison.',
  parameters: {
    type: 'OBJECT',
    properties: {
      origin: {
        type: 'OBJECT',
        description: 'Start coordinate',
        properties: {
          lat: { type: 'NUMBER', description: 'Latitude' },
          lon: { type: 'NUMBER', description: 'Longitude' },
        },
        required: ['lat', 'lon'],
      },
      destination: {
        type: 'OBJECT',
        description: 'End coordinate',
        properties: {
          lat: { type: 'NUMBER', description: 'Latitude' },
          lon: { type: 'NUMBER', description: 'Longitude' },
        },
        required: ['lat', 'lon'],
      },
      profile: {
        type: 'STRING',
        description: 'Travel profile: car (default), bike, or foot',
        enum: ['car', 'bike', 'foot'],
      },
      alternatives: {
        type: 'BOOLEAN',
        description: 'Whether to return alternative routes (default true for evaluation)',
      },
    },
    required: ['origin', 'destination'],
  },
};

/**
 * Execute Tool 1. Never throws — returns { ok: false, error } on failure so the agent can reason.
 */
export async function getRoute({
  origin,
  destination,
  profile = 'car',
  alternatives = true,
} = {}) {
  if (!origin?.lat || !origin?.lon || !destination?.lat || !destination?.lon) {
    return { ok: false, error: 'origin and destination with lat and lon are required' };
  }

  try {
    const coords = [
      [Number(origin.lon), Number(origin.lat)],
      [Number(destination.lon), Number(destination.lat)],
    ];
    const result = await getRoutes({
      profile,
      coords,
      alternatives: Boolean(alternatives),
    });

    return {
      ok: true,
      profile: result.profile,
      routes: result.routes,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'failed_to_fetch_routes',
    };
  }
}

