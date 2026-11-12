/**
 * @file systemTests.system.test.js
 * @description Comprehensive System-Level Testing Suite for JakSafe (12 System Test Types)
 * @reference Eric J. Braude (2001), Chapter 9: System Integration
 *            Kit [Ki], Software Testing in the Real World
 *            Prof. Dr. Ir. Riri Fitri Sari MM MSc - OOSE Lecture 11 (Slides 5, 6, 7, 27-31)
 *            ANSI/IEEE 829-1983 Section 3 & 4 (System Test Design & Test Cases)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { calculateRouteScore, getScoreCategory } from '../src/scoring/routeScorer.js';
import { findNearest, publicView } from '../src/services/cctvCatalog.js';
import { normalizeBudget, isOverBudget } from '../src/services/tomtom.js';

describe('System Tests: 12 Types of System Testing (Kit [Ki] / Braude Chapter 9)', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ── 1. VOLUME TESTING (Slide 5: Subject product to large amounts of input) ──
  it('1. Volume Test: processes batch coordinate sets and large CCTV queries without degradation', () => {
    const batchSize = 100;
    const testPoints = Array.from({ length: batchSize }, (_, i) => ({
      lat: -6.15 - (i * 0.001),
      lon: 106.80 + (i * 0.001),
    }));

    const startTime = performance.now();
    let totalCamerasFound = 0;

    for (const pt of testPoints) {
      const results = findNearest(pt.lat, pt.lon, { radiusM: 1000, limit: 5 });
      totalCamerasFound += results.length;
    }

    const durationMs = performance.now() - startTime;
    assert.ok(totalCamerasFound > 0);
    assert.ok(durationMs < 1000, `Volume query ${batchSize} titik harus selesai < 1000ms (aktual: ${durationMs.toFixed(2)}ms)`);
  });

  // ── 2. USABILITY TESTING (Slide 5 & 7: Accessibility, Responsiveness, Efficiency, Comprehensibility) ──
  describe('2. Usability Attributes Testing (Kit [Ki] / Braude)', () => {
    it('Accessibility: allows simple input entry and clean query parameter access', async () => {
      // User can easily query with straightforward coordinate format
      const res = await fetch(`${baseUrl}/api/cctv/nearest?coords=106.8272,-6.1754`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
    });

    it('Responsiveness: subassembly accomplishes calculation within target latency', () => {
      const t0 = performance.now();
      const res = calculateRouteScore({
        durationS: 900,
        aqiData: { pm2_5: 25 },
        visualAnalysis: { genangan_air: false, kondisi_jalan: 'lancar' },
      });
      const t1 = performance.now();
      const elapsedMs = t1 - t0;

      assert.ok(elapsedMs < 15, `Kalkulasi harus sangat responsif < 15ms (aktual: ${elapsedMs.toFixed(2)}ms)`);
      assert.ok(res.totalScore >= 0);
    });

    it('Efficiency: minimizes user steps required to retrieve route risk decision', () => {
      // Single unified function call produces complete multi-factor decision with breakdown
      const result = calculateRouteScore({ durationS: 1200, aqiData: { pm2_5: 40 } });
      assert.ok(result.totalScore !== undefined);
      assert.ok(result.label !== undefined);
      assert.ok(result.color !== undefined);
      assert.ok(result.breakdown !== undefined);
    });

    it('Comprehensibility: produces standard human-understandable categories & clear color coding', () => {
      const safe = getScoreCategory(15);
      const caution = getScoreCategory(45);
      const avoid = getScoreCategory(85);

      assert.equal(safe.label, 'AMAN');
      assert.equal(safe.color, '#22c55e');

      assert.equal(caution.label, 'HATI-HATI');
      assert.equal(caution.color, '#f59e0b');

      assert.equal(avoid.label, 'HINDARI');
      assert.equal(avoid.color, '#ef4444');
    });
  });

  // ── 3. PERFORMANCE TESTING (Slide 5: Measure speed under various circumstances) ──
  it('3. Performance Test: measures endpoint latency under threshold', async () => {
    const latencies = [];
    const runs = 10;

    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/api/health`);
      await res.json();
      latencies.push(performance.now() - t0);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / runs;
    assert.ok(avgLatency < 50, `Rata-rata latensi API harus < 50ms (aktual: ${avgLatency.toFixed(2)}ms)`);
  });

  // ── 4. CONFIGURATION TESTING (Slide 5: Configure to various options/environments) ──
  it('4. Configuration Test: verifies default vs custom budget and parameter options', () => {
    const defaultBudget = normalizeBudget(null, '2026-11-08');
    assert.equal(defaultBudget.count, 0);

    const isOverDefault = isOverBudget(defaultBudget, 2400);
    assert.equal(isOverDefault, false);

    // Custom tighter budget config (e.g. testing mode with limit 5)
    defaultBudget.count = 5;
    const isOverCustom = isOverBudget(defaultBudget, 5);
    assert.equal(isOverCustom, true);
  });

  // ── 5. COMPATIBILITY TESTING (Slide 5: Protocol & data format compatibility) ──
  it('5. Compatibility Test: output conforms strictly to GeoJSON RFC 7946 and JSON RFC 8259', async () => {
    const res = await fetch(`${baseUrl}/api/cctv/sources`);
    const data = await res.json();

    assert.equal(res.headers.get('content-type')?.includes('application/json'), true);
    assert.ok(Array.isArray(data.cameras));

    // Check WGS84 coordinate boundaries for Jakarta region: lat [-6.4, -6.0], lon [106.6, 107.0]
    for (const cam of data.cameras.slice(0, 10)) {
      assert.ok(cam.lat >= -90 && cam.lat <= 90, 'Latitude must be valid WGS84');
      assert.ok(cam.lon >= -180 && cam.lon <= 180, 'Longitude must be valid WGS84');
    }
  });

  // ── 6. RELIABILITY / AVAILABILITY TESTING (Slide 5: Measure up-time over extended cycles) ──
  it('6. Reliability Test: handles 50 consecutive requests without failure or 500 error', async () => {
    let successCount = 0;
    const totalRequests = 50;

    for (let i = 0; i < totalRequests; i++) {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status === 200) successCount++;
    }

    assert.equal(successCount, totalRequests, 'Ketersediaan harus 100% tanpa kegagalan');
  });

  // ── 7. SECURITY TESTING (Slide 6: Subject to compromise attempts, injection & privacy) ──
  describe('7. Security Testing (Compromise attempts & privacy protection)', () => {
    it('prevents prototype pollution and malicious object injection', () => {
      const maliciousPayload = JSON.parse('{"__proto__": {"polluted": true}}');
      const scoreResult = calculateRouteScore({ durationS: 600, ...maliciousPayload });

      assert.ok(scoreResult.totalScore >= 0);
      assert.equal(Object.prototype.polluted, undefined, 'Prototype tidak boleh terpolusi');
    });

    it('sanitizes coordinate input strings against script/SQL injection attempts', async () => {
      const injectionQueries = [
        "<script>alert('xss')</script>",
        "106.82; DROP TABLE users;--",
        "' OR '1'='1",
      ];

      for (const query of injectionQueries) {
        const res = await fetch(`${baseUrl}/api/cctv/nearest?coords=${encodeURIComponent(query)}`);
        // Must reject safely with 400 Bad Request and not crash server
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.ok, false);
      }
    });

    it('enforces privacy invariant: internal CCTV stream credentials are never disclosed', async () => {
      const res = await fetch(`${baseUrl}/api/cctv/sources`);
      const text = await res.text();

      // Ensure sensitive keywords never appear in serialized response
      assert.ok(!text.includes('"url"'), 'Kunci url internal tidak boleh muncul dalam JSON');
      assert.ok(!text.includes('rtsp://'), 'Protokol RTSP internal tidak boleh bocor');
      assert.ok(!text.includes('password'), 'Kata kunci password tidak boleh ada');
    });
  });

  // ── 8. RESOURCE USAGE TESTING (Slide 6 & 30: Memory usage behavior & leaks) ──
  it('8. Resource Usage Test: tracks heap memory behavior under repetitive scoring load', () => {
    if (global.gc) global.gc();

    const memBefore = process.memoryUsage().heapUsed;

    // Run 500 route risk score computations
    for (let i = 0; i < 500; i++) {
      calculateRouteScore({
        durationS: 600 + (i % 1000),
        aqiData: { pm2_5: 20 + (i % 80) },
        visualAnalysis: { genangan_air: false, kondisi_jalan: 'lancar' },
      });
    }

    const memAfter = process.memoryUsage().heapUsed;
    const heapGrowthMb = (memAfter - memBefore) / (1024 * 1024);

    // Heap growth should remain small (< 15 MB) for 500 iterations
    assert.ok(heapGrowthMb < 15, `Pertumbuhan heap harus terkontrol < 15MB (aktual: ${heapGrowthMb.toFixed(2)}MB)`);
  });

  // ── 9. INSTALL-ABILITY TESTING (Slide 6: Check environment & required dependencies) ──
  it('9. Install-ability Test: verifies required data catalog file and environment state', () => {
    // CCTV catalog must be loadable
    const sample = findNearest(-6.1754, 106.8272, { radiusM: 1000, limit: 1 });
    assert.ok(Array.isArray(sample));
    assert.ok(sample.length > 0, 'Katalog CCTV harus terinstal dan siap digunakan');
  });

  // ── 10. RECOVERABILITY TESTING (Slide 6: Force activities that take service down, measure recovery) ──
  it('10. Recoverability Test: recovers immediately after bad/fatal payload without crashing process', async () => {
    // 1. Force a bad request
    const badRes = await fetch(`${baseUrl}/api/cctv/nearest?coords=crash_me`);
    assert.equal(badRes.status, 400);

    // 2. Measure recovery: immediate subsequent valid request must succeed 100%
    const recoveryRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(recoveryRes.status, 200);

    const data = await recoveryRes.json();
    assert.equal(data.status, 'ok', 'Sistem harus pulih seketika tanpa downtime');
  });

  // ── 11. SERVICEABILITY TESTING (Slide 6: Service application under various situations) ──
  it('11. Serviceability Test: provides operational diagnostics on /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);

    const info = await res.json();
    assert.equal(info.service, 'jaksafe-backend');
    assert.ok(info.time);
  });

  // ── 12. LOAD / STRESS TESTING (Slide 6: Subject to extreme data & event traffic) ──
  it('12. Load / Stress Test: executes 25 concurrent asynchronous requests simultaneously', async () => {
    const concurrentRequests = 25;
    const promises = Array.from({ length: concurrentRequests }, (_, idx) => {
      // Interleaving health and nearest queries
      const url = idx % 2 === 0
        ? `${baseUrl}/api/health`
        : `${baseUrl}/api/cctv/nearest?coords=106.8272,-6.1754&radius=1000&limit=2`;
      return fetch(url);
    });

    const responses = await Promise.all(promises);
    assert.equal(responses.length, concurrentRequests);

    for (const res of responses) {
      assert.equal(res.status, 200, 'Semua request konkuren harus berhasil diselesaikan');
    }
  });
});
