import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAllCaches,
  cctvHealthCache,
  getAllCacheStats,
} from '../src/services/cacheService.js';
import {
  attachHealth,
  checkCameraEndpoint,
  getCameraHealth,
  getHealthSummary,
  recordCameraHealth,
  runHealthSweep,
  sortCandidatesByHealth,
} from '../src/services/cctvHealthService.js';
import { CctvStatus } from '../src/db/models/CctvStatus.js';
import { findNearest } from '../src/services/cctvCatalog.js';
import { getCctvSnapshot } from '../src/agent/tools/getCctvSnapshot.js';

function makeMockResponse({ status = 200, headers = {}, body = new Uint8Array([1, 2, 3]) } = {}) {
  const hdrs = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: hdrs,
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: body };
          },
          async cancel() {},
        };
      },
      async cancel() {},
    },
    async arrayBuffer() {
      return body.buffer;
    },
  };
}

describe('Unit Test: Hybrid CCTV Health Checker Service', () => {
  beforeEach(() => {
    clearAllCaches();
  });

  it('registers cctvHealthCache with capacity >= 1000 in global cache stats', () => {
    const stats = getAllCacheStats();
    assert.ok(stats.cctvHealth, 'cctvHealth stats must be registered');
    assert.ok(stats.cctvHealth.max >= 1000, 'cctvHealth max capacity should hold all catalog cameras');
  });

  it('records and reads camera health passively without requiring MongoDB', () => {
    assert.equal(getCameraHealth('cam-none').status, 'unknown');

    recordCameraHealth('cam-1', { status: 'online', latencyMs: 42, syncDb: false });
    const h = getCameraHealth('cam-1');
    assert.equal(h.status, 'online');
    assert.equal(h.latencyMs, 42);
    assert.ok(h.checkedAt);

    const attached = attachHealth({ id: 'cam-1', name: 'Test Cam' });
    assert.equal(attached.status, 'online');
    assert.equal(attached.url, undefined);
  });

  it('checkCameraEndpoint marks HTTP HEAD image/jpeg 200 as online', async () => {
    const fetchImpl = async () =>
      makeMockResponse({ status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '2048' } });

    const res = await checkCameraEndpoint(
      { id: 'c1', url: 'https://8.8.8.8/cam1.jpg' },
      { fetchImpl, timeoutMs: 2000 }
    );
    assert.equal(res.status, 'online');
    assert.equal(res.reason, null);
  });

  it('checkCameraEndpoint falls back from HEAD 405 to GET and verifies non-empty body', async () => {
    const methods = [];
    const fetchImpl = async (_url, opts) => {
      methods.push(opts.method);
      if (opts.method === 'HEAD') {
        return makeMockResponse({ status: 405 });
      }
      return makeMockResponse({ status: 200, headers: { 'content-type': 'image/jpeg' } });
    };

    const res = await checkCameraEndpoint(
      { id: 'c2', url: 'https://8.8.8.8/cam2.jpg' },
      { fetchImpl, timeoutMs: 2000 }
    );
    assert.deepEqual(methods, ['HEAD', 'GET']);
    assert.equal(res.status, 'online');
  });

  it('checkCameraEndpoint rejects image/svg+xml offline placeholders', async () => {
    const fetchImpl = async () =>
      makeMockResponse({ status: 200, headers: { 'content-type': 'image/svg+xml' } });

    const res = await checkCameraEndpoint(
      { id: 'c3', url: 'https://8.8.8.8/offline.svg' },
      { fetchImpl, timeoutMs: 2000 }
    );
    assert.equal(res.status, 'offline');
    assert.match(res.reason, /svg offline/i);
  });

  it('checkCameraEndpoint blocks private/SSRF targets without issuing fetch', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return makeMockResponse({ status: 200 });
    };

    const res = await checkCameraEndpoint(
      { id: 'c4', url: 'http://127.0.0.1/secret.jpg' },
      { fetchImpl, timeoutMs: 2000 }
    );
    assert.equal(called, false);
    assert.equal(res.status, 'offline');
  });

  it('runHealthSweep populates cctvHealthCache and computes summary counts', async () => {
    const cameras = [
      { id: 'cam-a', url: 'https://8.8.8.8/a.jpg' },
      { id: 'cam-b', url: 'https://8.8.8.8/b.jpg' },
      { id: 'cam-c', url: 'https://8.8.8.8/c.jpg' },
    ];
    const fetchImpl = async (url) => {
      if (url.endsWith('/b.jpg')) {
        return makeMockResponse({ status: 503 });
      }
      return makeMockResponse({ status: 200, headers: { 'content-type': 'image/jpeg' } });
    };

    const stats = await runHealthSweep({
      cameras,
      concurrency: 2,
      persistDb: false,
      fetchImpl,
    });

    assert.equal(stats.total, 3);
    assert.equal(stats.online, 2);
    assert.equal(stats.offline, 1);
    assert.equal(cctvHealthCache.size(), 3);

    const summary = getHealthSummary(cameras);
    assert.equal(summary.online, 2);
    assert.equal(summary.offline, 1);
    assert.equal(summary.unknown, 0);
  });

  it('sortCandidatesByHealth prioritizes online > unknown > offline while preserving distance order', () => {
    recordCameraHealth('near-offline', { status: 'offline', syncDb: false });
    recordCameraHealth('far-online', { status: 'online', syncDb: false });

    const ordered = sortCandidatesByHealth([
      { camera: { id: 'near-offline' }, distanceM: 50 },
      { camera: { id: 'mid-unknown' }, distanceM: 120 },
      { camera: { id: 'far-online' }, distanceM: 250 },
    ]);

    assert.deepEqual(
      ordered.map((c) => c.camera.id),
      ['far-online', 'mid-unknown', 'near-offline']
    );
  });

  it('defines a MongoDB TTL index on CctvStatus.expiresAt', () => {
    const indexes = CctvStatus.schema.indexes();
    const ttlIndex = indexes.find(([fields]) => fields.expiresAt === 1);
    assert.ok(ttlIndex, 'CctvStatus schema must define an index on expiresAt');
    assert.equal(ttlIndex[1].expireAfterSeconds, 0);
  });

  it('checkCameraEndpoint auto-retries once on transient 503 before succeeding', async () => {
    let attempts = 0;
    const fetchImpl = async (_url, opts) => {
      attempts += 1;
      if (opts.method === 'HEAD' || attempts === 2) {
        return makeMockResponse({ status: 503 });
      }
      return makeMockResponse({ status: 200, headers: { 'content-type': 'image/jpeg' } });
    };

    const res = await checkCameraEndpoint(
      { id: 'c-retry', url: 'https://8.8.8.8/coldstart.jpg' },
      { fetchImpl, timeoutMs: 2000, retryDelayMs: 0 }
    );
    assert.equal(attempts, 3); // HEAD (503) -> GET #1 (503) -> GET retry #2 (200)
    assert.equal(res.status, 'online');
  });

  it('getCctvSnapshot skips known-offline cameras immediately without calling fetchFrame', async () => {
    const monasLat = -6.1754;
    const monasLon = 106.8272;
    const nearby = findNearest(monasLat, monasLon, { radiusM: 1500, limit: 8 });
    assert.ok(nearby.length > 0, 'Expected cameras near Monas in catalog');

    for (const item of nearby) {
      recordCameraHealth(item.camera.id, { status: 'offline', reason: 'HTTP 503', syncDb: false });
    }

    let fetchCalled = 0;
    const res = await getCctvSnapshot(
      { lat: monasLat, lon: monasLon, radius_m: 1500 },
      {
        fetchFrameFn: async () => {
          fetchCalled += 1;
          throw new Error('should not fetch offline camera');
        },
      }
    );

    assert.equal(fetchCalled, 0);
    assert.equal(res.ok, false);
    assert.equal(res.skippedOfflineCount, nearby.length);
  });
});

