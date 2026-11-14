import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { createApp } from '../src/app.js';
import { requireAdmin } from '../src/middleware/auth.js';
import { createRateLimiter } from '../src/middleware/rateLimit.js';
import { bootstrapAdminFromEnv } from '../src/services/authService.js';
import { loadCatalog, findNearest, publicView, adminView } from '../src/services/cctvCatalog.js';
import { resetCatalogOverridesCache } from '../src/db/cctvCatalogStore.js';
import { getTomTomAdminStats } from '../src/services/tomtom.js';
import { appendLocalExecutionLog } from '../src/db/executionLogStore.js';
import { routeGeometryCache, clearAllCaches } from '../src/services/cacheService.js';

function requestJson(baseUrl, pathname, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (payload !== null) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      url,
      { method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

describe('Admin System, CCTV Management, Telemetry & Security Hardening', () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const tempUserPath = path.join(os.tmpdir(), `jaksafe-admin-users-${stamp}.json`);
  const tempOverridesPath = path.join(os.tmpdir(), `jaksafe-admin-cctv-${stamp}.json`);
  const tempExecLogPath = path.join(os.tmpdir(), `jaksafe-admin-logs-${stamp}.json`);

  const envSnapshot = {
    JAKSAFE_LOCAL_STORAGE_PATH: process.env.JAKSAFE_LOCAL_STORAGE_PATH,
    JAKSAFE_CCTV_OVERRIDES_PATH: process.env.JAKSAFE_CCTV_OVERRIDES_PATH,
    JAKSAFE_EXECUTION_LOG_PATH: process.env.JAKSAFE_EXECUTION_LOG_PATH,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  };

  let server;
  let baseUrl;
  let normalToken;
  let adminToken;
  const adminEmail = `admin.test.${stamp}@jaksafe.id`;
  const adminPassword = 'AdminSecretPassword#2026';

  before(async () => {
    process.env.JAKSAFE_LOCAL_STORAGE_PATH = tempUserPath;
    process.env.JAKSAFE_CCTV_OVERRIDES_PATH = tempOverridesPath;
    process.env.JAKSAFE_EXECUTION_LOG_PATH = tempExecLogPath;
    process.env.ADMIN_EMAIL = adminEmail;
    process.env.ADMIN_PASSWORD = adminPassword;
    delete process.env.ADMIN_EMAILS;

    resetCatalogOverridesCache();
    clearAllCaches();
    await bootstrapAdminFromEnv();

    const app = createApp({
      rateLimit: {
        apiMax: 120,
        authMax: 5,
        adminMax: 120,
        heavyMax: 30,
        tileMax: 200,
      },
    });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Daftarkan 1 user biasa yang mencoba self-escalation role: 'admin'
    const regRes = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        email: `warga.${stamp}@jaksafe.id`,
        password: 'UserPassword123',
        name: 'Warga Sipil',
        role: 'admin',
      },
    });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.body?.user?.role, 'user', 'Registrasi publik tidak boleh self-escalate menjadi admin');
    normalToken = regRes.body.token;

    // Login sebagai admin yang di-bootstrap dari env
    const loginRes = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body?.user?.role, 'admin');
    adminToken = loginRes.body.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetCatalogOverridesCache();

    for (const p of [tempUserPath, tempOverridesPath, tempExecLogPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // Abaikan error hapus file sementara
      }
    }
  });

  describe('1. Role Admin, Escalation Prevention & Endpoint Hardening', () => {
    it('requireAdmin middleware rejects unauthenticated (401), user (403), and allows admin', () => {
      const makeRes = () => {
        const out = { statusCode: 200, payload: null };
        return {
          status(code) {
            out.statusCode = code;
            return this;
          },
          json(obj) {
            out.payload = obj;
            return this;
          },
          out,
        };
      };

      const res401 = makeRes();
      let called = false;
      requireAdmin({}, res401, () => { called = true; });
      assert.equal(called, false);
      assert.equal(res401.out.statusCode, 401);

      const res403 = makeRes();
      requireAdmin({ user: { id: 'u1', role: 'user' } }, res403, () => { called = true; });
      assert.equal(called, false);
      assert.equal(res403.out.statusCode, 403);

      const res200 = makeRes();
      requireAdmin({ user: { id: 'a1', role: 'admin' } }, res200, () => { called = true; });
      assert.equal(called, true);
    });

    it('PUT /api/auth/profile cannot escalate user role to admin', async () => {
      const res = await requestJson(baseUrl, '/api/auth/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${normalToken}` },
        body: { name: 'Warga Terverifikasi', role: 'admin' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body?.user?.name, 'Warga Terverifikasi');
      assert.equal(res.body?.user?.role, 'user');
    });

    it('GET /api/health omits cache telemetry & GET /api/cache/stats is strictly admin-only', async () => {
      const healthRes = await requestJson(baseUrl, '/api/health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.body?.status, 'ok');
      assert.equal(healthRes.body?.cache, undefined);

      const unauthCache = await requestJson(baseUrl, '/api/cache/stats');
      assert.equal(unauthCache.status, 401);

      const userCache = await requestJson(baseUrl, '/api/cache/stats', {
        headers: { Authorization: `Bearer ${normalToken}` },
      });
      assert.equal(userCache.status, 403);

      const adminCache = await requestJson(baseUrl, '/api/cache/stats', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminCache.status, 200);
      assert.equal(adminCache.body?.ok, true);
      assert.ok(adminCache.body?.cache?.cctvHealth);
      assert.ok(adminCache.body?.summary?.overallHitRate);
    });
  });

  describe('2. Rate Limiting Middleware & HTTP 429 Enforcement', () => {
    it('createRateLimiter emits RateLimit-* headers, Retry-After on 429, and supports reset/stats', () => {
      const limiter = createRateLimiter({ name: 'unit_rl', windowMs: 30_000, max: 2 });
      try {
        const invoke = (ip) => {
          const headers = {};
          let status = 200;
          let jsonBody = null;
          let nextCalled = false;
          const req = { ip, headers: {} };
          const res = {
            setHeader(k, v) { headers[k] = v; },
            status(c) { status = c; return this; },
            json(b) { jsonBody = b; return this; },
          };
          limiter(req, res, () => { nextCalled = true; });
          return { status, headers, jsonBody, nextCalled };
        };

        const r1 = invoke('10.20.30.40');
        assert.equal(r1.nextCalled, true);
        assert.equal(r1.headers['RateLimit-Limit'], '2');
        assert.equal(r1.headers['RateLimit-Remaining'], '1');

        const r2 = invoke('10.20.30.40');
        assert.equal(r2.nextCalled, true);
        assert.equal(r2.headers['RateLimit-Remaining'], '0');

        const r3 = invoke('10.20.30.40');
        assert.equal(r3.nextCalled, false);
        assert.equal(r3.status, 429);
        assert.ok(Number(r3.headers['Retry-After']) >= 1);
        assert.equal(r3.jsonBody?.limiter, 'unit_rl');

        const stats = limiter.getStats();
        assert.equal(stats.allowed, 2);
        assert.equal(stats.blocked, 1);

        limiter.reset();
        const afterReset = invoke('10.20.30.40');
        assert.equal(afterReset.nextCalled, true);
      } finally {
        limiter.stop();
      }
    });

    it('authLimiter returns HTTP 429 after authMax attempts on /api/auth/login', async () => {
      // authMax=5 di before(), sudah terpakai 1x saat login admin di before() -> sisa 4 permintaan
      let triggered429 = null;
      for (let i = 0; i < 6; i += 1) {
        const r = await requestJson(baseUrl, '/api/auth/login', {
          method: 'POST',
          headers: { 'X-Forwarded-For': '203.0.113.77' },
          body: { email: 'nobody@jaksafe.id', password: 'wrong' },
        });
        if (r.status === 429) {
          triggered429 = r;
          break;
        }
      }
      assert.ok(triggered429, 'Seharusnya menerima status 429 ketika batas auth terlampaui');
      assert.equal(triggered429.body?.limiter, 'auth_sensitive');
      assert.ok(Number(triggered429.headers['retry-after']) >= 1);
    });
  });

  describe('3. Admin CCTV CRUD, Disable/Restore, SSRF Guard, Probe & Sweep', () => {
    const customId = `test-cam-${Date.now()}`;

    it('rejects non-admin access on /api/admin/cctv and blocks private SSRF camera URLs', async () => {
      const denied = await requestJson(baseUrl, '/api/admin/cctv', {
        headers: { Authorization: `Bearer ${normalToken}` },
      });
      assert.equal(denied.status, 403);

      const ssrfCreate = await requestJson(baseUrl, '/api/admin/cctv', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          id: 'ssrf-invalid',
          name: 'Localhost Trap',
          url: 'http://127.0.0.1:8080/secret.jpg',
          lat: -6.2,
          lon: 106.8,
        },
      });
      assert.equal(ssrfCreate.status, 400);
    });

    it('creates, updates, disables (hiding from public catalog & findNearest), probes, sweeps & deletes custom camera', async () => {
      // Tambah kamera kustom di koordinat unik tengah Jakarta Selatan (-6.2801, 106.8201)
      const createRes = await requestJson(baseUrl, '/api/admin/cctv', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          id: customId,
          name: 'Simpang Uji Admin',
          city: 'Jakarta Selatan',
          provider: 'Dinas Uji',
          url: 'https://example.org/cctv/test-frame.jpg',
          lat: -6.2801,
          lon: 106.8201,
          headingDeg: 90,
          fovDeg: 70,
          rangeM: 120,
        },
      });
      assert.equal(createRes.status, 201);
      assert.equal(createRes.body?.camera?.id, customId);
      assert.equal(createRes.body?.camera?.url, 'https://example.org/cctv/test-frame.jpg');
      assert.equal(createRes.body?.camera?.enabled, true);

      // Pastikan publicView TIDAK membocorkan URL, sedangkan adminView menyertakannya
      const loadedActive = loadCatalog({ includeDisabled: false }).find((c) => c.id === customId);
      assert.ok(loadedActive);
      assert.equal(publicView(loadedActive).url, undefined);
      assert.equal(adminView(loadedActive).url, 'https://example.org/cctv/test-frame.jpg');

      // Cek GET /api/cctv/sources menyertakan kamera aktif
      const publicSourcesBefore = await requestJson(baseUrl, '/api/cctv/sources');
      assert.equal(publicSourcesBefore.status, 200);
      assert.ok(JSON.stringify(publicSourcesBefore.body).includes(customId));

      // Edit metadata kamera via PUT
      const putRes = await requestJson(baseUrl, `/api/admin/cctv/${customId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'Simpang Uji Admin (Edited)', city: 'Jakarta Selatan' },
      });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.body?.camera?.name, 'Simpang Uji Admin (Edited)');

      // Probe 1 kamera secara deterministik menggunakan mock fetch
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => ({
          ok: true,
          status: 200,
          headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
          arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]).buffer,
        });
        const probeOk = await requestJson(baseUrl, `/api/admin/cctv/${customId}/probe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(probeOk.status, 200);
        assert.equal(probeOk.body?.probe?.status, 'online');
        assert.ok(Number.isFinite(probeOk.body?.camera?.latencyMs));

        // Probe offline -> simpan alasan error
        globalThis.fetch = async () => ({
          ok: false,
          status: 503,
          headers: { get: () => null },
        });
        const probeFail = await requestJson(baseUrl, `/api/admin/cctv/${customId}/probe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(probeFail.status, 200);
        assert.equal(probeFail.body?.probe?.status, 'offline');
        assert.match(probeFail.body?.camera?.statusReason || '', /503/);
      } finally {
        globalThis.fetch = origFetch;
      }

      // Nonaktifkan kamera bermasalah
      const toggleOff = await requestJson(baseUrl, `/api/admin/cctv/${customId}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { enabled: false },
      });
      assert.equal(toggleOff.status, 200);
      assert.equal(toggleOff.body?.camera?.enabled, false);

      // Kamera nonaktif harus menghilang dari API publik & findNearest default
      const publicSourcesAfter = await requestJson(baseUrl, '/api/cctv/sources');
      assert.equal(JSON.stringify(publicSourcesAfter.body).includes(customId), false);
      const nearestActive = findNearest(-6.2801, 106.8201, { radiusM: 200 });
      assert.equal(nearestActive.some((x) => x.camera.id === customId), false);
      const nearestWithDisabled = findNearest(-6.2801, 106.8201, { radiusM: 200, includeDisabled: true });
      assert.equal(nearestWithDisabled.some((x) => x.camera.id === customId), true);

      // Hapus kamera kustom
      const delRes = await requestJson(baseUrl, `/api/admin/cctv/${customId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body?.deleted, true);
      assert.equal(delRes.body?.recoverable, false);
    });

    it('restores a modified/disabled base camera via POST /api/admin/cctv/:id/restore & triggers sweep', async () => {
      const baseCameras = loadCatalog({ includeDisabled: true }).filter((c) => !c.isCustom);
      assert.ok(baseCameras.length > 0, 'Harus memiliki kamera katalog dasar');
      const target = baseCameras[0];

      const offRes = await requestJson(baseUrl, `/api/admin/cctv/${encodeURIComponent(target.id)}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { enabled: false },
      });
      assert.equal(offRes.status, 200);
      assert.equal(offRes.body?.camera?.enabled, false);

      const restoreRes = await requestJson(baseUrl, `/api/admin/cctv/${encodeURIComponent(target.id)}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(restoreRes.status, 200);
      assert.equal(restoreRes.body?.camera?.enabled, true);

      // Trigger sweep dengan mock fetch agar deterministik dan tidak memicu trafik jaringan luar saat uji
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => ({
          ok: true,
          status: 200,
          headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
          arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1]).buffer,
        });
        const sweepRes = await requestJson(baseUrl, '/api/admin/cctv/sweep', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { wait: true },
        });
        assert.equal(sweepRes.status, 200);
        assert.equal(sweepRes.body?.started, true);
        assert.equal(sweepRes.body?.sweepInProgress, false);
        assert.ok(sweepRes.body?.summary?.total >= 1);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('4. Monitoring Overview, TomTom Quota, Cache Clear & ExecutionLog Audit Trail', () => {
    it('tracks ExecutionLog stats, fallback rate, score distribution & clears cache via admin endpoints', async () => {
      // Seed log lokal terisolasi (termasuk fallback Gemini & bermacam label skor)
      appendLocalExecutionLog({
        requestId: 'req-test-aman',
        origin: { label: 'Monas', lat: -6.1754, lon: 106.8272 },
        destination: { label: 'Bundaran HI', lat: -6.195, lon: 106.823 },
        profile: 'car',
        route: { distanceM: 3200, durationS: 480, summary: 'Jl. M.H. Thamrin' },
        score: { totalScore: 18, label: 'AMAN', color: 'green' },
        modelTelemetry: {
          primaryModel: 'gemini-3-flash-preview',
          modelUsed: 'gemini-3-flash-preview',
          fallbackOccurred: false,
          usedSummaryFallback: false,
        },
        reasoning: [{ step: 1, action: 'analyze_route', thought: 'Lancar', durationMs: 320 }],
        totalDurationMs: 650,
        status: 'success',
      });

      appendLocalExecutionLog({
        requestId: 'req-test-fallback-hindari',
        origin: { label: 'Kemang', lat: -6.2607, lon: 106.8135 },
        destination: { label: 'Grogol', lat: -6.167, lon: 106.79 },
        profile: 'motor',
        route: { distanceM: 12400, durationS: 1900, summary: 'Jl. Gatot Subroto' },
        score: { totalScore: 84, label: 'HINDARI', color: 'red' },
        modelTelemetry: {
          primaryModel: 'gemini-3-flash-preview',
          modelUsed: 'gemini-2.5-flash',
          fallbackOccurred: true,
          usedSummaryFallback: false,
        },
        reasoning: [{ step: 1, action: 'analyze_cctv', thought: 'Genangan tinggi', durationMs: 950 }],
        totalDurationMs: 2400,
        status: 'success',
      });

      routeGeometryCache.set('test-key', { ok: true });

      const overviewRes = await requestJson(baseUrl, '/api/admin/monitoring/overview', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(overviewRes.status, 200);
      assert.equal(overviewRes.body?.ok, true);

      const { tomtom, cache, execution, rateLimits } = overviewRes.body;
      assert.equal(Array.isArray(tomtom.dailyHistory), true);
      assert.equal(tomtom.dailyHistory.length, 7);
      assert.ok(Number.isFinite(tomtom.budgetLimit));
      assert.ok(cache.stores.routeGeometry.size >= 1);
      assert.equal(execution.totalExecutions, 2);
      assert.equal(execution.fallbackCount, 1);
      assert.equal(execution.fallbackRatePercent, 50);
      assert.equal(execution.scoreDistribution.AMAN, 1);
      assert.equal(execution.scoreDistribution.HINDARI, 1);
      assert.ok(execution.avgDurationMs > 0);
      assert.ok(execution.p95DurationMs >= execution.avgDurationMs);
      assert.equal(Array.isArray(rateLimits), true);
      assert.ok(rateLimits.some((r) => r.name === 'admin_api'));

      // Filter audit log hanya fallback Gemini
      const logsRes = await requestJson(baseUrl, '/api/admin/monitoring/logs?fallbackOnly=true', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(logsRes.status, 200);
      assert.equal(logsRes.body?.logs?.length, 1);
      assert.equal(logsRes.body.logs[0].requestId, 'req-test-fallback-hindari');

      // Bersihkan store routeGeometry via admin endpoint
      const clearRes = await requestJson(baseUrl, '/api/admin/cache/clear', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { store: 'routeGeometry' },
      });
      assert.equal(clearRes.status, 200);
      assert.deepEqual(clearRes.body?.cleared, ['routeGeometry']);
      assert.equal(clearRes.body?.cache?.routeGeometry?.size, 0);

      // Verifikasi langsung getTomTomAdminStats helper
      const directStats = await getTomTomAdminStats();
      assert.equal(directStats.dailyHistory.length, 7);
    });
  });
});
