/**
 * @file build2_services.integration.test.js
 * @description Integration Test for Build 2: External Environmental & Spatial Services Subassembly
 *              (CCTV Spatial Catalog, Open-Meteo AQI normalizer, and TomTom Quota/Traffic Engine)
 * @reference Eric J. Braude (2001), Chapter 9: System Integration
 *            Prof. Dr. Ir. Riri Fitri Sari MM MSc - OOSE Lecture 11 (System Integration)
 *            ANSI/IEEE 829-1983 Section 3 & 4 (Integration Test Design & Test Cases)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, findNearest, publicView } from '../src/services/cctvCatalog.js';
import { normalizeMetrics, DEFAULT_METRICS, AirQualityError } from '../src/services/openMeteo.js';
import {
  lonLatToTile,
  isValidTileCoord,
  normalizeBudget,
  isOverBudget,
  utcDayKey,
} from '../src/services/tomtom.js';
import { calculateRouteScore } from '../src/scoring/routeScorer.js';

describe('Build 2 Integration: Environmental & Spatial Sensor Subassemblies', () => {

  describe('1. CCTV Spatial Proximity & Privacy Protection Pipeline', () => {
    it('integrates waypoint corridor lookup with strict privacy sanitization', () => {
      // Waypoints along Jalan Jenderal Sudirman corridor
      const waypoints = [
        { name: 'Bundaran HI', lat: -6.1950, lon: 106.8230 },
        { name: 'Dukuh Atas', lat: -6.2020, lon: 106.8225 },
        { name: 'Semanggi', lat: -6.2185, lon: 106.8170 },
      ];

      const corridorCameras = [];
      for (const pt of waypoints) {
        const nearest = findNearest(pt.lat, pt.lon, { radiusM: 800, limit: 2 });
        for (const item of nearest) {
          const sanitized = publicView(item.camera);
          corridorCameras.push({
            waypoint: pt.name,
            distanceM: item.distanceM,
            camera: sanitized,
          });
        }
      }

      // Assert at least 1 camera found in this busy Jakarta arterial corridor
      assert.ok(corridorCameras.length > 0, 'Harus mendeteksi kamera CCTV di sepanjang koridor Sudirman');

      // Crucial Class / Object Invariant: Privacy Protection across all integrated results
      for (const item of corridorCameras) {
        assert.equal(item.camera.url, undefined, 'URL RTSP/HLS privat tidak boleh bocor');
        assert.equal(item.camera.streamUrl, undefined, 'streamUrl privat tidak boleh bocor');
        assert.ok(item.camera.id, 'ID kamera publik harus ada');
        assert.ok(Number.isFinite(item.camera.lat), 'Latitude kamera harus numerik');
        assert.ok(Number.isFinite(item.camera.lon), 'Longitude kamera harus numerik');
      }
    });
  });

  describe('2. Open-Meteo Dynamic Metric Normalization & Integration', () => {
    it('normalizes custom and default environmental metrics safely', () => {
      const customMetrics = ['pm10', 'uv_index', 'nitrogen_dioxide'];
      const normalized = normalizeMetrics(customMetrics);

      // Verify baseline DEFAULT_METRICS (pm2_5, us_aqi) are always preserved
      assert.ok(normalized.includes('pm2_5'));
      assert.ok(normalized.includes('us_aqi'));
      assert.ok(normalized.includes('pm10'));
      assert.ok(normalized.includes('uv_index'));
      assert.ok(normalized.includes('nitrogen_dioxide'));

      // Verify idempotency and uniqueness
      const set = new Set(normalized);
      assert.equal(set.size, normalized.length);
    });

    it('rejects malformed or malicious metric names at subassembly boundary', () => {
      const maliciousInputs = [
        'pm2_5; DROP TABLE',
        '<script>alert(1)</script>',
        'metric_name_exceeding_forty_characters_limit_boundary_fail',
      ];

      for (const badInput of maliciousInputs) {
        assert.throws(
          () => normalizeMetrics(badInput),
          (err) => err instanceof AirQualityError
        );
      }
    });
  });

  describe('3. TomTom Spatial Math & Daily Quota Governor Integration', () => {
    it('integrates coordinate-to-tile transformation with budget constraints', () => {
      // Bundaran HI coordinate (-6.1950, 106.8230) at zoom level 14
      const zoom = 14;
      assert.ok(isValidTileCoord(zoom, 13054, 8472));

      const tileCoord = lonLatToTile(106.8230, -6.1950, zoom);
      assert.ok(isValidTileCoord(zoom, tileCoord.x, tileCoord.y));

      // Quota governor integration simulation
      const today = utcDayKey();
      let budget = normalizeBudget(null, today);
      assert.equal(budget.count, 0);
      assert.equal(isOverBudget(budget, 2400), false);

      // Simulate consuming budget close to boundary limit
      budget.count = 2399;
      assert.equal(isOverBudget(budget, 2400), false);

      budget.count = 2400; // Boundary limit
      assert.equal(isOverBudget(budget, 2400), true);

      // Verify degraded graceful mode: When over budget, system flags over-budget state
      const degradedFallback = isOverBudget(budget, 2400);
      assert.equal(degradedFallback, true);
    });
  });

  describe('4. Multi-Sensor Telemetry Fusion Pipeline', () => {
    it('fuses CCTV, Open-Meteo, and TomTom sensors into comprehensive route risk scoring', () => {
      // Integrated scenario: Severe rain & high pollution in Jakarta
      const fusedTelemetry = {
        durationS: 1800, // 30 mins
        aqiData: { pm2_5: 110, us_aqi: 180 }, // Open-Meteo sensor
        trafficData: { delayPercent: 50, roadClosure: false }, // TomTom sensor
        visualAnalysis: {
          genangan_air: true,
          tingkat_genangan: 'sedang',
          kondisi_jalan: 'padat',
          confidence: 0.88,
        }, // CCTV Gemini Vision sensor
      };

      const fusedResult = calculateRouteScore(fusedTelemetry);

      // Assert that all three sensors contribute to the final integrated risk
      assert.ok(fusedResult.breakdown.time.delayPercent === 50);
      assert.ok(fusedResult.breakdown.aqi.pm2_5 === 110);
      assert.ok(fusedResult.breakdown.condition.floodDetected === true);

      // Overall risk should reach at least CAUTION or AVOID due to rain and high PM2.5
      assert.ok(['HATI-HATI', 'HINDARI'].includes(fusedResult.label));
      assert.ok(fusedResult.totalScore >= 40);
    });

    it('tolerates single-sensor outage gracefully through defensive sensor fusion', () => {
      // Scenario: TomTom API is over budget and CCTV camera stream is unavailable
      const partialTelemetry = {
        durationS: 900,
        aqiData: { pm2_5: 18 }, // Only AQI succeeds
        trafficData: null,     // TomTom offline / fallback
        visualAnalysis: null,  // CCTV offline / fallback
      };

      const fallbackResult = calculateRouteScore(partialTelemetry);

      // Must calculate score without throwing error
      assert.ok(fallbackResult.totalScore >= 0 && fallbackResult.totalScore <= 100);
      assert.equal(fallbackResult.breakdown.time.trafficSource, 'OSRM Baseline');
      assert.equal(fallbackResult.breakdown.condition.traffic, 'normal');
    });
  });
});
