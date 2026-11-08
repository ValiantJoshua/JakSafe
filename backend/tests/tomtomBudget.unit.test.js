import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOverBudget,
  normalizeBudget,
  pickTrafficSamplePoints,
  aggregateTrafficSegments,
} from '../src/services/tomtom.js';

describe('Unit Test: TomTom Budget & State Transitions (Braude Section 5)', () => {

  describe('1. Boundary Value Analysis: isOverBudget', () => {
    const LIMIT = 2400;

    it('returns false when strictly within budget (count < limit)', () => {
      assert.equal(isOverBudget({ count: 0 }, LIMIT), false, 'Count 0 is under limit');
      assert.equal(isOverBudget({ count: 2399 }, LIMIT), false, 'Boundary: Count 2399 is under limit 2400');
    });

    it('returns true exactly at limit boundary (count == limit)', () => {
      assert.equal(isOverBudget({ count: 2400 }, LIMIT), true, 'Boundary: Count 2400 reaches limit 2400');
    });

    it('returns true when exceeding budget (count > limit)', () => {
      assert.equal(isOverBudget({ count: 2401 }, LIMIT), true, 'Boundary: Count 2401 exceeds limit');
      assert.equal(isOverBudget({ count: 5000 }, LIMIT), true, 'Count 5000 exceeds limit');
    });

    it('handles undefined / null state gracefully', () => {
      assert.equal(isOverBudget(null, LIMIT), false, 'Null budget defaults count to 0');
      assert.equal(isOverBudget(undefined, LIMIT), false, 'Undefined budget defaults count to 0');
    });
  });

  describe('2. State Transitions & Invariant: Daily Reset Mechanism', () => {
    it('preserves counter if same date, resets to 0 if new date (State Transition)', () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = '2026-11-01';

      // State 1: Previous day state with 1500 calls
      const oldState = { date: yesterday, count: 1500 };

      // Transition to today: must reset count to 0
      const resetState = normalizeBudget(oldState, today);
      assert.equal(resetState.date, today, 'Date transitions to current day');
      assert.equal(resetState.count, 0, 'Counter must reset to 0 on new day transition');

      // State 2: Current day with 500 calls
      const currentState = { date: today, count: 500 };
      const preservedState = normalizeBudget(currentState, today);
      assert.equal(preservedState.date, today);
      assert.equal(preservedState.count, 500, 'Counter must be preserved on same day');
    });

    it('sanitizes corrupt or invalid state object (Illegal State Recovery)', () => {
      const today = '2026-11-02';
      assert.deepEqual(normalizeBudget(null, today), { date: today, count: 0 });
      assert.deepEqual(normalizeBudget({ date: today, count: -5 }, today), { date: today, count: 0 });
      assert.deepEqual(normalizeBudget({ date: today, count: 'invalid' }, today), { date: today, count: 0 });
    });
  });

  describe('3. Multi-Segment Traffic Sampling & Bottleneck Aggregation', () => {
    const sampleGeometry = Array.from({ length: 21 }, (_, i) => [
      106.80 + i * 0.005,
      -6.25 + i * 0.005,
    ]);

    it('adapts sample count to route distance (2 for short, 3 for medium, 4 for long)', () => {
      const shortSamples = pickTrafficSamplePoints(sampleGeometry, { distanceM: 2100 });
      const medSamples = pickTrafficSamplePoints(sampleGeometry, { distanceM: 6500 });
      const longSamples = pickTrafficSamplePoints(sampleGeometry, { distanceM: 14500 });

      assert.equal(shortSamples.length, 2, 'Short routes (<3km) sample 2 interior segments');
      assert.equal(medSamples.length, 3, 'Medium routes (3-10km) sample 3 interior segments');
      assert.equal(longSamples.length, 4, 'Long corridors (>=10km) sample 4 interior segments');
    });

    it('computes bottleneck-weighted effective delay and identifies worstSegment', () => {
      const segments = [
        { lat: -6.23, lon: 106.82, ratio: 0.25, delayPercent: 10, currentSpeedKmH: 42, freeFlowSpeedKmH: 45, roadClosure: false },
        { lat: -6.21, lon: 106.83, ratio: 0.50, delayPercent: 95, currentSpeedKmH: 12, freeFlowSpeedKmH: 45, roadClosure: false },
        { lat: -6.19, lon: 106.84, ratio: 0.75, delayPercent: 15, currentSpeedKmH: 36, freeFlowSpeedKmH: 45, roadClosure: false },
      ];

      const agg = aggregateTrafficSegments(segments);
      assert.equal(agg.sampleCount, 3);
      assert.equal(agg.avgDelayPercent, 40); // (10 + 95 + 15) / 3 = 40
      assert.equal(agg.maxDelayPercent, 95);
      // Bottleneck-weighted: round(40 * 0.60 + 95 * 0.40) = round(24 + 38) = 62
      assert.equal(agg.delayPercent, 62);
      assert.equal(agg.minSpeedKmH, 12);
      assert.equal(agg.worstSegment.lat, -6.21);
      assert.equal(agg.worstSegment.delayPercent, 95);
      assert.equal(agg.roadClosure, false);
    });

    it('propagates roadClosure if any single segment along the corridor is closed', () => {
      const segments = [
        { lat: -6.23, lon: 106.82, delayPercent: 0, roadClosure: false },
        { lat: -6.21, lon: 106.83, delayPercent: 100, roadClosure: true },
      ];
      const agg = aggregateTrafficSegments(segments);
      assert.equal(agg.roadClosure, true, 'Must report roadClosure=true if any segment is closed');
    });
  });
});
