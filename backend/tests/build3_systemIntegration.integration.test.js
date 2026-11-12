/**
 * @file build3_systemIntegration.integration.test.js
 * @description Integration Test for Build 3: Express HTTP Assembly & Routing Layer Integration
 * @reference Eric J. Braude (2001), Chapter 9: System Integration
 *            Prof. Dr. Ir. Riri Fitri Sari MM MSc - OOSE Lecture 11 (System Integration)
 *            ANSI/IEEE 829-1983 Section 3 & 4 (Integration Test Design & Test Cases)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import {
  deconstructIndonesianAddress,
  resolveAccurateProvince,
  composeDetailedIndonesianLocation,
} from '../src/services/addressParser.js';

describe('Build 3 Integration: Express HTTP Application & Endpoints Assembly', () => {
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

  describe('1. Service Diagnostic Endpoint (Health Check & Serviceability)', () => {
    it('GET /api/health returns HTTP 200 and valid service metadata', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.service, 'jaksafe-backend');
      assert.ok(Date.parse(data.time) > 0, 'Timestamp harus berupa ISO valid');
    });

    it('verifies standard CORS and Content-Type HTTP headers', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.ok(res.headers.get('content-type')?.includes('application/json'));
    });
  });

  describe('2. Spatial CCTV Integration Endpoints', () => {
    it('GET /api/cctv/sources returns sanitized public catalog', async () => {
      const res = await fetch(`${baseUrl}/api/cctv/sources`);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(Number.isInteger(data.count) && data.count > 0);
      assert.ok(Array.isArray(data.cameras));

      // Class Invariant: stream URL must never leak
      const sample = data.cameras[0];
      assert.equal(sample.url, undefined);
      assert.equal(sample.streamUrl, undefined);
    });

    it('GET /api/cctv/nearest finds cameras near Monas with distance sorting', async () => {
      // Monas coordinates: 106.8272, -6.1754
      const res = await fetch(`${baseUrl}/api/cctv/nearest?coords=106.8272,-6.1754&radius=2000&limit=3`);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(Array.isArray(data.cameras));
      assert.ok(data.cameras.length <= 3);

      if (data.cameras.length > 0) {
        assert.ok(Number.isFinite(data.cameras[0].distanceM));
        assert.ok(data.cameras[0].distanceM <= 2000);
      }
    });

    it('GET /api/cctv/nearest rejects malformed coordinates with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/cctv/nearest?coords=bad_coords`);
      assert.equal(res.status, 400);

      const data = await res.json();
      assert.equal(data.ok, false);
      assert.ok(data.error);
    });
  });

  describe('3. Dynamic Geocoding Endpoint Integration', () => {
    it('GET /api/geocode recognizes direct coordinate input instantly', async () => {
      const res = await fetch(`${baseUrl}/api/geocode?q=-6.1754,106.8272`);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(Array.isArray(data.places));
      assert.ok(data.places.length > 0);
      assert.equal(data.places[0].area, 'Koordinat Kustom');
    });

    it('GET /api/geocode rejects empty query with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/geocode?q=`);
      assert.equal(res.status, 400);

      const data = await res.json();
      assert.equal(data.ok, false);
      assert.ok(data.error.includes('Query q diperlukan'));
    });

    it('deconstructs granular Indonesian address (Perumahan, Blok/No, Kecamatan) and re-composes micro-units', () => {
      const parsed = deconstructIndonesianAddress('Perumahan Green Permata, Blok Olive 9, Pesanggrahan');
      assert.equal(parsed.estateOrComplex, 'Perumahan Green Permata');
      assert.equal(parsed.microUnit, 'Blok Olive 9');
      assert.ok(parsed.searchCandidates.some((c) => c.includes('Green Permata')));
      assert.ok(!parsed.searchCandidates[0].includes('Blok Olive 9'));

      const composed = composeDetailedIndonesianLocation(
        {
          name: 'Green Permata',
          road: 'Jl. Swadarma Raya',
          kelurahan: 'Ulujami',
          kecamatan: 'Pesanggrahan',
          city: 'Kota Jakarta Selatan',
          province: 'Banten', // Intentional OSM border error to verify province override
          lat: -6.2301,
          lon: 106.7602,
          sourceId: 'osm-test-1',
        },
        parsed
      );

      assert.equal(composed.province, 'DKI Jakarta');
      assert.ok(composed.nama.includes('Blok Olive 9'));
      assert.ok(composed.nama.includes('Jl. Swadarma Raya'));
      assert.ok(composed.area.includes('Ulujami'));
      assert.ok(composed.area.includes('Kec. Pesanggrahan'));
      assert.equal(resolveAccurateProvince('Banten', 'Jakarta Selatan', 'Pesanggrahan'), 'DKI Jakarta');
    });

    it('GET /api/geocode/reverse rejects out-of-bounds coordinates with HTTP 422', async () => {
      const res = await fetch(`${baseUrl}/api/geocode/reverse?lat=48.8566&lon=2.3522`);
      assert.equal(res.status, 422);
      const data = await res.json();
      assert.equal(data.ok, false);
    });
  });

  describe('4. Intelligent Navigation Request Boundary Validation', () => {
    it('POST /api/navigate validates request body and rejects missing coordinates with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.ok(data.error.includes('origin and destination'));
    });

    it('POST /api/navigate rejects non-numeric coordinate values', async () => {
      const res = await fetch(`${baseUrl}/api/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: 'invalid', lon: 106.82 },
          destination: { lat: -6.19, lon: 106.82 },
        }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.ok, false);
    });
  });
});
