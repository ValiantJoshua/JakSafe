/**
 * @file build1_routingScorer.integration.test.js
 * @description Integration Test for Build 1: Core Routing & Multi-Criteria Risk Scorer Subassembly
 * @reference Eric J. Braude (2001), Chapter 9: System Integration
 *            Prof. Dr. Ir. Riri Fitri Sari MM MSc - OOSE Lecture 11 (System Integration)
 *            ANSI/IEEE 829-1983 Section 3 & 4 (Integration Test Design & Test Cases)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoords, extractRouteSteps, RouteError } from '../src/services/osrm.js';
import { calculateRouteScore, getScoreCategory } from '../src/scoring/routeScorer.js';

describe('Build 1 Integration: OSRM Routing & RouteScorer Subassembly', () => {

  describe('1. Subassembly Data Pipeline (Coordinates -> Routing Geometry -> Risk Engine)', () => {
    it('integrates coordinate parsing with multi-criteria route scoring', () => {
      // Input from user: Monas (-6.1754, 106.8272) ke Bundaran HI (-6.1950, 106.8230)
      const rawCoords = '106.8272,-6.1754;106.8230,-6.1950';
      const parsed = parseCoords(rawCoords);

      assert.equal(parsed.length, 2);
      assert.deepEqual(parsed[0], [106.8272, -6.1754]);
      assert.deepEqual(parsed[1], [106.8230, -6.1950]);

      // Simulated OSRM route subassembly output
      const simulatedRoute = {
        distanceM: 3200,
        durationS: 900, // 15 minutes
        geometry: [
          [106.8272, -6.1754],
          [106.8250, -6.1850],
          [106.8230, -6.1950],
        ],
      };

      // Environmental sensor telemetry
      const aqiData = { pm2_5: 35 };
      const trafficData = { delayPercent: 10, roadClosure: false };
      const visualAnalysis = {
        genangan_air: false,
        kondisi_jalan: 'lancar',
        confidence: 0.85,
      };

      // Integrated subassembly call
      const scoreResult = calculateRouteScore({
        durationS: simulatedRoute.durationS,
        trafficData,
        aqiData,
        visualAnalysis,
      });

      // Verify subassembly integration contract
      assert.equal(typeof scoreResult.totalScore, 'number');
      assert.ok(scoreResult.totalScore >= 0 && scoreResult.totalScore <= 100);
      assert.ok(['AMAN', 'HATI-HATI', 'HINDARI'].includes(scoreResult.label));
      assert.ok(scoreResult.breakdown !== undefined);
      assert.equal(typeof scoreResult.breakdown.time.score, 'number');
      assert.equal(typeof scoreResult.breakdown.aqi.score, 'number');
      assert.equal(typeof scoreResult.breakdown.condition.score, 'number');
      assert.equal(scoreResult.breakdown.time.trafficSource, 'TomTom Live');
    });
  });

  describe('2. Multi-Route Alternatives Comparison Subassembly', () => {
    it('ranks multiple integrated routes correctly by multi-criteria safety', () => {
      // 3 alternative routes between same origin and destination
      const routeA_Fastest_Flooded = {
        name: 'Rute A (Via Thamrin - Tergenang)',
        distanceM: 3000,
        durationS: 600, // 10 menit (sangat cepat)
      };
      const envA = {
        aqiData: { pm2_5: 45 },
        visualAnalysis: { genangan_air: true, tingkat_genangan: 'tinggi', confidence: 0.9 },
        trafficData: { delayPercent: 85, roadClosure: true }, // Jalan ditutup karena banjir
      };

      const routeB_Longer_Safe = {
        name: 'Rute B (Via Kebon Sirih - Bersih & Kering)',
        distanceM: 4500,
        durationS: 1200, // 20 menit (lebih lama)
      };
      const envB = {
        aqiData: { pm2_5: 15 }, // Bersih
        visualAnalysis: { genangan_air: false, kondisi_jalan: 'lancar', confidence: 0.9 },
        trafficData: { delayPercent: 0, roadClosure: false },
      };

      const routeC_Moderate_Congested = {
        name: 'Rute C (Via Sabang - Padat)',
        distanceM: 3800,
        durationS: 1800, // 30 menit
      };
      const envC = {
        aqiData: { pm2_5: 55 },
        visualAnalysis: { genangan_air: false, kondisi_jalan: 'padat', confidence: 0.8 },
        trafficData: { delayPercent: 60, roadClosure: false },
      };

      const scoredA = {
        ...routeA_Fastest_Flooded,
        result: calculateRouteScore({ durationS: routeA_Fastest_Flooded.durationS, ...envA }),
      };
      const scoredB = {
        ...routeB_Longer_Safe,
        result: calculateRouteScore({ durationS: routeB_Longer_Safe.durationS, ...envB }),
      };
      const scoredC = {
        ...routeC_Moderate_Congested,
        result: calculateRouteScore({ durationS: routeC_Moderate_Congested.durationS, ...envC }),
      };

      // Subassembly integration decision: rank by lowest risk score (0 = paling aman)
      const rankedRoutes = [scoredA, scoredB, scoredC].sort((a, b) => a.result.totalScore - b.result.totalScore);

      // Verify: Rute B harus paling aman (skor terendah), Rute A harus paling berisiko tinggi
      assert.equal(rankedRoutes[0].name, 'Rute B (Via Kebon Sirih - Bersih & Kering)');
      assert.equal(rankedRoutes[2].name, 'Rute A (Via Thamrin - Tergenang)');
      assert.ok(rankedRoutes[0].result.totalScore < rankedRoutes[2].result.totalScore);
    });
  });

  describe('3. Subassembly Boundary & Error Propagation', () => {
    it('propagates RouteError across subassembly boundaries on invalid coordinate strings', () => {
      assert.throws(
        () => parseCoords('invalid-coord;106.82, -6.17'),
        (err) => err instanceof RouteError && err.status === 400
      );

      assert.throws(
        () => parseCoords('106.82,-6.17'), // Hanya 1 koordinat padahal butuh minimal 2
        (err) => err instanceof RouteError && err.status === 400
      );
    });

    it('safely handles missing telemetry attributes with defensive fallback defaults', () => {
      const bareRoute = { durationS: 1200 };

      const scoreResult = calculateRouteScore({ durationS: bareRoute.durationS });
      assert.ok(scoreResult.totalScore >= 0 && scoreResult.totalScore <= 100);
      assert.equal(scoreResult.breakdown.aqi.score, 50); // Fallback netral
      assert.equal(scoreResult.breakdown.condition.score, 20); // Default neutral condition
    });
  });

  describe('4. Regression Verification (Braude Section 8)', () => {
    it('verifies that integrated scoring preserves unit invariants across all combinations', () => {
      const testCases = [
        { durationS: 250, aqiData: { pm2_5: 5 }, visualAnalysis: { genangan_air: false, kondisi_jalan: 'lancar' }, expectedLabel: 'AMAN' },
        { durationS: 2400, aqiData: { pm2_5: 85 }, visualAnalysis: { genangan_air: false, kondisi_jalan: 'padat' }, expectedLabel: 'HATI-HATI' },
        { durationS: 5000, aqiData: { pm2_5: 200 }, trafficData: { roadClosure: true }, expectedLabel: 'HINDARI' },
      ];

      for (const tc of testCases) {
        const res = calculateRouteScore({
          durationS: tc.durationS,
          aqiData: tc.aqiData,
          visualAnalysis: tc.visualAnalysis,
          trafficData: tc.trafficData,
        });
        assert.equal(res.label, tc.expectedLabel);
        assert.equal(res.label, getScoreCategory(res.totalScore).label);
      }
    });
  });

  describe('5. Turn-by-Turn Maneuver Step Extraction (extractRouteSteps)', () => {
    it('translates OSRM legs.steps into Indonesian instructions and merges consecutive straight steps on the same street', () => {
      const mockOsrmRoute = {
        legs: [
          {
            steps: [
              {
                name: 'Jl. Medan Merdeka Selatan',
                distance: 350,
                duration: 45,
                maneuver: { type: 'depart', modifier: 'right', location: [106.8272, -6.1805] },
              },
              {
                name: 'Jl. M.H. Thamrin',
                distance: 600,
                duration: 75,
                maneuver: { type: 'turn', modifier: 'left', location: [106.8230, -6.1812] },
              },
              {
                name: 'Jl. Jenderal Sudirman',
                distance: 400,
                duration: 50,
                maneuver: { type: 'new name', modifier: 'straight', location: [106.8229, -6.1920] },
              },
              {
                name: 'Jl. Jenderal Sudirman',
                distance: 850,
                duration: 95,
                maneuver: { type: 'continue', modifier: 'straight', location: [106.8225, -6.1960] },
              },
              {
                name: 'Jl. Jenderal Sudirman',
                distance: 180,
                duration: 28,
                maneuver: { type: 'roundabout', modifier: 'right', exit: 2, location: [106.8230, -6.1950] },
              },
              {
                name: 'Bundaran HI',
                distance: 0,
                duration: 0,
                maneuver: { type: 'arrive', modifier: 'left', location: [106.8230, -6.1950] },
              },
            ],
          },
        ],
      };

      const steps = extractRouteSteps(mockOsrmRoute);

      // Step 3 and Step 4 (both straight on Jl. Jenderal Sudirman) should be merged into 1 step (400 + 850 = 1250m)
      assert.equal(steps.length, 5);
      assert.equal(steps[0].directionKey, 'depart');
      assert.match(steps[0].instruction, /Mulai perjalanan di Jl\. Medan Merdeka Selatan/);
      assert.equal(steps[1].directionKey, 'left');
      assert.match(steps[1].instruction, /Belok kiri ke Jl\. M\.H\. Thamrin/);
      assert.equal(steps[2].directionKey, 'straight');
      assert.equal(steps[2].distanceM, 1250);
      assert.equal(steps[2].durationS, 145);
      assert.equal(steps[3].directionKey, 'roundabout');
      assert.match(steps[3].instruction, /jalan keluar ke-2/);
      assert.equal(steps[4].directionKey, 'arrive');
      assert.match(steps[4].instruction, /Tiba di tujuan/);
    });
  });
});
