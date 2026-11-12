import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryLRUCache,
  hashKey,
  cctvVisionCache,
  routeGeometryCache,
  navigationCache,
  geocodeCache,
  getAllCacheStats,
  clearAllCaches,
} from '../src/services/cacheService.js';

describe('Unit Test: In-Memory LRU Cache Service', () => {
  let cache;

  beforeEach(() => {
    cache = new InMemoryLRUCache({ max: 3, defaultTtlMs: 200, name: 'test_store' });
    clearAllCaches();
  });

  it('stores and retrieves values within TTL', () => {
    cache.set('key1', { data: 'jalan sudirman' });
    assert.deepEqual(cache.get('key1'), { data: 'jalan sudirman' });
    assert.equal(cache.has('key1'), true);
  });

  it('returns null and records a miss for non-existent keys', () => {
    assert.equal(cache.get('non_existent'), null);
    assert.equal(cache.has('non_existent'), false);
    const stats = cache.getStats();
    assert.equal(stats.misses, 1);
  });

  it('evicts expired keys after TTL passes', async () => {
    cache.set('short_lived', 'sudirman', 50); // 50ms TTL
    assert.equal(cache.get('short_lived'), 'sudirman');

    await new Promise((r) => setTimeout(r, 70));

    assert.equal(cache.get('short_lived'), null);
    assert.equal(cache.has('short_lived'), false);
    const stats = cache.getStats();
    assert.equal(stats.misses, 1);
  });

  it('enforces LRU eviction when capacity is exceeded', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to make it MRU (most recently used): order becomes b, c, a
    cache.get('a');

    // Add 'd': oldest ('b') should be evicted
    cache.set('d', 4);

    assert.equal(cache.get('b'), null, 'Key b should have been evicted');
    assert.equal(cache.get('a'), 1, 'Key a should remain');
    assert.equal(cache.get('c'), 3, 'Key c should remain');
    assert.equal(cache.get('d'), 4, 'Key d should remain');

    const stats = cache.getStats();
    assert.equal(stats.evictions, 1);
  });

  it('tracks hit rate and operational statistics accurately', () => {
    cache.set('hit_test', 'value');
    cache.get('hit_test'); // hit 1
    cache.get('hit_test'); // hit 2
    cache.get('miss_key'); // miss 1

    const stats = cache.getStats();
    assert.equal(stats.hits, 2);
    assert.equal(stats.misses, 1);
    assert.equal(stats.sets, 1);
    assert.equal(stats.hitRate, '66.7%');
  });

  it('correctly prunes expired keys on demand', async () => {
    cache.set('temp1', 1, 30);
    cache.set('temp2', 2, 30);
    cache.set('persistent', 3, 1000);

    await new Promise((r) => setTimeout(r, 50));

    const prunedCount = cache.prune();
    assert.equal(prunedCount, 2);
    assert.equal(cache.size(), 1);
    assert.equal(cache.get('persistent'), 3);
  });

  it('hashes arbitrary strings deterministically', () => {
    const h1 = hashKey('test-cctv-1');
    const h2 = hashKey('test-cctv-1');
    const h3 = hashKey('test-cctv-2');

    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
    assert.equal(h1.length, 16);
  });

  it('verifies specialized cache registries and getAllCacheStats', () => {
    cctvVisionCache.set('cctv-1', { status: 'lancar' });
    routeGeometryCache.set('route-1', { distanceM: 5000 });
    navigationCache.set('nav-1', { score: 92 });
    geocodeCache.set('geo-1', { name: 'Monas' });

    const allStats = getAllCacheStats();
    assert.equal(allStats.cctvVision.size, 1);
    assert.equal(allStats.routeGeometry.size, 1);
    assert.equal(allStats.navigation.size, 1);
    assert.equal(allStats.geocoding.size, 1);

    clearAllCaches();
    const clearedStats = getAllCacheStats();
    assert.equal(clearedStats.cctvVision.size, 0);
  });
});

