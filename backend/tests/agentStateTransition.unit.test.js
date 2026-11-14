import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAqiResults } from '../src/agent/reactAgent.js';

/**
 * State Transition Test for JakSafe Navigation Workflow
 * Modeled after Eric J. Braude's Encounter State-Transition Sequence:
 * States:
 * [1. WAITING / IDLE] -> User enters origin and destination
 * [2. PREPARING / ROUTING] -> OSRM baseline driving path fetched
 * [3. ENGAGING / SENSING] -> TomTom flow + Open-Meteo AQI + CCTV Snapshot & Vision
 * [4. SCORING] -> Multi-Criteria route risk calculated
 * [5. REPORTING / COMPLETED] -> Final advice formatted and persisted to ExecutionLog
 */

class MockNavigationWorkflow {
  constructor() {
    this.state = 'WAITING'; // Initial state
    this.context = {
      origin: null,
      destination: null,
      route: null,
      traffic: null,
      aqi: null,
      cctv: null,
      score: null,
      report: null,
    };
  }

  // Event 1: User submits navigation request
  startRequest(origin, destination) {
    if (this.state !== 'WAITING') throw new Error(`Invalid transition from ${this.state}`);
    if (!origin || !destination) throw new Error('Origin and Destination are required');
    this.context.origin = origin;
    this.context.destination = destination;
    this.state = 'PREPARING';
  }

  // Event 2: OSRM calculates route geometry
  attachRoute(routeData) {
    if (this.state !== 'PREPARING') throw new Error(`Invalid transition from ${this.state}`);
    this.context.route = routeData;
    this.state = 'ENGAGING';
  }

  // Event 3: Sensor tools queried (TomTom, AQI, CCTV)
  attachSensors({ traffic, aqi, cctv }) {
    if (this.state !== 'ENGAGING') throw new Error(`Invalid transition from ${this.state}`);
    this.context.traffic = traffic;
    this.context.aqi = aqi;
    this.context.cctv = cctv;
    this.state = 'SCORING';
  }

  // Event 4: Route scorer computes combined score
  computeScore(scoreResult) {
    if (this.state !== 'SCORING') throw new Error(`Invalid transition from ${this.state}`);
    this.context.score = scoreResult;
    this.state = 'REPORTING';
  }

  // Event 5: Final report synthesized and log recorded
  complete(summary) {
    if (this.state !== 'REPORTING') throw new Error(`Invalid transition from ${this.state}`);
    this.context.report = summary;
    this.state = 'COMPLETED';
  }
}

describe('Unit Test: Navigation State-Transition Sequence (Braude Section 5)', () => {
  it('verifies complete lifecycle transitions: WAITING -> PREPARING -> ENGAGING -> SCORING -> REPORTING -> COMPLETED', () => {
    const workflow = new MockNavigationWorkflow();

    // Step 1: Initial State Invariant
    assert.equal(workflow.state, 'WAITING', 'Initial state must be WAITING');

    // Step 2: Trigger startRequest -> PREPARING
    workflow.startRequest({ lat: -6.1754, lon: 106.8272 }, { lat: -6.1950, lon: 106.8230 });
    assert.equal(workflow.state, 'PREPARING', 'Transitions to PREPARING upon user request');

    // Step 3: Trigger attachRoute -> ENGAGING
    workflow.attachRoute({ distanceM: 2200, durationS: 360, geometry: [[106.8272, -6.1754], [106.8230, -6.1950]] });
    assert.equal(workflow.state, 'ENGAGING', 'Transitions to ENGAGING once route is loaded');

    // Step 4: Trigger attachSensors -> SCORING
    workflow.attachSensors({
      traffic: { delayPercent: 12 },
      aqi: { pm2_5: 28 },
      cctv: { camera: 'cam-01', flood: false },
    });
    assert.equal(workflow.state, 'SCORING', 'Transitions to SCORING after telemetry collection');

    // Step 5: Trigger computeScore -> REPORTING
    workflow.computeScore({ totalScore: 18, label: 'AMAN' });
    assert.equal(workflow.state, 'REPORTING', 'Transitions to REPORTING after scoring');

    // Step 6: Trigger complete -> COMPLETED
    workflow.complete('Rute aman dilewati dengan lalu lintas lancar.');
    assert.equal(workflow.state, 'COMPLETED', 'Final state is COMPLETED');
    assert.equal(workflow.context.score.label, 'AMAN');
  });

  it('rejects illegal out-of-order state transitions (Illegal State Handling)', () => {
    const workflow = new MockNavigationWorkflow();
    // Cannot skip PREPARING to ENGAGING
    assert.throws(
      () => workflow.attachRoute({}),
      /Invalid transition from WAITING/,
      'Must reject illegal jump from WAITING directly to ENGAGING'
    );
  });

  it('preserves worst polluted coordinates in summarizeAqiResults for map marker rendering', () => {
    const summary = summarizeAqiResults([
      {
        lat: -6.1754,
        lon: 106.8272,
        time: '2026-11-14T10:00:00+07:00',
        values: { pm2_5: 18.4, us_aqi: 64 },
        usAqiCategory: { label: 'Moderate' },
      },
      {
        lat: -6.2088,
        lon: 106.8456,
        time: '2026-11-14T10:05:00+07:00',
        values: { pm2_5: 56.2, us_aqi: 151 },
        usAqiCategory: { label: 'Unhealthy' },
      },
    ]);

    assert.equal(summary.pm2_5, 56.2);
    assert.equal(summary.us_aqi, 151);
    assert.equal(summary.usAqiCategory, 'Unhealthy');
    assert.equal(summary.titikTerburuk.lat, -6.2088);
    assert.equal(summary.titikTerburuk.lon, 106.8456);
    assert.equal(summary.titikTerburuk.values.pm2_5, 56.2);
  });
});
