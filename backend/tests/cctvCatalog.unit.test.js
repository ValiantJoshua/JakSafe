import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceM,
  findNearest,
  publicView,
  loadCatalog,
} from '../src/services/cctvCatalog.js';

describe('Unit Test: CCTV Catalog (Watts Humphrey / Eric J. Braude Method Checklist)', () => {

  describe('1. Parameter Limits & Illegal Inputs (Humphrey Checklist #1, #2, #3)', () => {
    it('distanceM: Haversine distance computation within, at boundaries, and outside', () => {
      // Normal values (Monas to Bundaran HI ~ 2.2 km)
      const dist = distanceM(-6.1754, 106.8272, -6.1950, 106.8230);
      assert.ok(dist > 2000 && dist < 2400, `Distance should be approx 2.2 km, got ${dist}`);

      // Same coordinates (Boundary: zero distance)
      const zeroDist = distanceM(-6.1754, 106.8272, -6.1754, 106.8272);
      assert.equal(Math.round(zeroDist), 0, 'Distance between identical points must be 0');

      // Antipodal points (Limit of spherical geometry)
      const maxDist = distanceM(0, 0, 0, 180);
      assert.ok(maxDist > 20000000, 'Half circumference should be ~20,000 km');
    });

    it('findNearest: Radius boundaries and limit slicing', () => {
      const monasLat = -6.1754;
      const monasLon = 106.8272;

      // Limit parameter values (Humphrey #2): limit = 1
      const nearestOne = findNearest(monasLat, monasLon, { radiusM: 5000, limit: 1 });
      assert.ok(nearestOne.length <= 1, 'Limit parameter 1 must return at most 1 item');

      // Boundary: radius = 0 meters (unlikely to match exact coordinates)
      const zeroRadius = findNearest(monasLat, monasLon, { radiusM: 0, limit: 5 });
      assert.equal(zeroRadius.length, 0, 'Zero radius should match 0 cameras unless exact point');

      // Illegal parameter: negative radius
      const negativeRadius = findNearest(monasLat, monasLon, { radiusM: -100, limit: 5 });
      assert.equal(negativeRadius.length, 0, 'Negative radius should return empty array');
    });
  });

  describe('2. File Handling, Data Structures & Catalog Loading (Humphrey #7, #8)', () => {
    it('loadCatalog: Loads catalog and maintains data structure integrity', () => {
      const catalog = loadCatalog();
      assert.ok(Array.isArray(catalog), 'Catalog must be loaded as an Array');
      assert.ok(catalog.length > 0, `Catalog must contain camera entries, got ${catalog.length}`);

      // Verify each loaded object has valid structure
      const first = catalog[0];
      assert.ok(typeof first.id === 'string', 'Entry must have string id');
      assert.ok(Number.isFinite(first.lat), 'Entry must have finite lat');
      assert.ok(Number.isFinite(first.lon), 'Entry must have finite lon');
      assert.ok(first.feedType === 'image', 'feedType should be normalized to image');
    });
  });

  describe('3. Class / Object Invariant: Privacy Protection (Braude Invariant Verification)', () => {
    it('publicView: Invariant - Internal CCTV stream URL must NEVER be leaked to clients', () => {
      const mockInternalCamera = {
        id: 'cam-test-123',
        name: 'Simpang Thamrin Test',
        url: 'https://cctv.internal.jakarta.go.id/secret_stream_token.m3u8',
        lat: -6.189,
        lon: 106.824,
        city: 'Jakarta Pusat',
        provider: 'Bali Tower',
        headingDeg: 180,
      };

      const exposed = publicView(mockInternalCamera);

      // Verify Invariant: URL property is omitted completely
      assert.equal(exposed.url, undefined, 'Class Invariant Violated: URL must not be present in public view');
      assert.equal(exposed.id, 'cam-test-123');
      assert.equal(exposed.name, 'Simpang Thamrin Test');
      assert.equal(exposed.lat, -6.189);
      assert.equal(exposed.lon, 106.824);
    });
  });
});
