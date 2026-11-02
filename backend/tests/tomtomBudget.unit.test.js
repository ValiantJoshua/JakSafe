import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOverBudget,
  normalizeBudget,
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
});
