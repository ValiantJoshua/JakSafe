import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTimeScore,
  normalizeAqiScore,
  normalizeConditionScore,
  getScoreCategory,
  calculateRouteScore,
  DEFAULT_WEIGHTS,
  SCORE_LABELS,
} from '../src/scoring/routeScorer.js';

describe('Unit Test: RouteScorer (Eric J. Braude / Prof. Riri Fitri Sari Methodology)', () => {

  describe('1. Black-Box Testing: Equivalence Partitioning & Boundary Values', () => {
    // Normalizing Time: <= 5 min (300s) = 0, >= 60 min (3600s) = 100, linear between
    it('normalizeTimeScore: Boundary & Equivalence Partitions', () => {
      // Within range (Normal values)
      assert.equal(normalizeTimeScore(300), 0, 'Boundary: Exactly 5 mins -> 0');
      assert.equal(normalizeTimeScore(1950), 50, 'Mid-point: 32.5 mins -> 50');
      assert.equal(normalizeTimeScore(3600), 100, 'Boundary: Exactly 60 mins -> 100');

      // Beyond limit (Legal extremes)
      assert.equal(normalizeTimeScore(60), 0, 'Below 5 mins -> capped at 0');
      assert.equal(normalizeTimeScore(7200), 100, 'Above 60 mins -> capped at 100');

      // Outside range / Illegal partitions (Robustness)
      assert.equal(normalizeTimeScore(0), 50, 'Illegal: 0 duration fallback to neutral 50');
      assert.equal(normalizeTimeScore(-100), 50, 'Illegal: negative duration fallback to 50');
      assert.equal(normalizeTimeScore(NaN), 50, 'Illegal: NaN fallback to 50');
      assert.equal(normalizeTimeScore(Infinity), 50, 'Illegal: Infinity fallback to 50');
    });

    // Normalizing AQI: pm2_5 <= 12 -> 0, >= 150 -> 100
    it('normalizeAqiScore: Boundary & Equivalence Partitions', () => {
      // Normal within range
      assert.equal(normalizeAqiScore({ pm2_5: 12 }), 0, 'Boundary: pm2_5 12 -> 0');
      assert.equal(normalizeAqiScore({ pm2_5: 81 }), 50, 'Midpoint: pm2_5 81 -> 50');
      assert.equal(normalizeAqiScore({ pm2_5: 150 }), 100, 'Boundary: pm2_5 150 -> 100');

      // Beyond boundaries
      assert.equal(normalizeAqiScore({ pm2_5: 5 }), 0, 'Below 12 -> 0');
      assert.equal(normalizeAqiScore({ pm2_5: 250 }), 100, 'Above 150 -> 100');

      // US AQI fallback branch
      assert.equal(normalizeAqiScore({ us_aqi: 50 }), 0, 'Fallback: us_aqi 50 -> 0');
      assert.equal(normalizeAqiScore({ us_aqi: 200 }), 100, 'Fallback: us_aqi 200 -> 100');
      assert.equal(normalizeAqiScore({ us_aqi: 125 }), 50, 'Fallback midpoint: us_aqi 125 -> 50');

      // Illegal / Missing data
      assert.equal(normalizeAqiScore({}), 50, 'Illegal/Empty: fallback to neutral 50');
      assert.equal(normalizeAqiScore({ pm2_5: NaN }), 50, 'Illegal: NaN fallback to 50');
    });
  });

  describe('2. White-Box Testing: Statement & Decision Coverage (Myers Branch Analysis)', () => {
    it('normalizeConditionScore: checks all branches of road closure & flood levels', () => {
      // Branch A: roadClosure = true -> short circuits to 100 immediately
      assert.equal(
        normalizeConditionScore({ genangan_air: false }, { roadClosure: true }),
        100,
        'Branch A: Road closure short-circuits to maximum score 100'
      );

      // Branch B: Flood severity branches (rendah, sedang, tinggi/berat, unknown)
      assert.equal(
        normalizeConditionScore({ genangan_air: true, tingkat_genangan: 'rendah' }),
        35,
        'Branch B1: Flood level rendah -> 35'
      );
      assert.equal(
        normalizeConditionScore({ genangan_air: true, tingkat_genangan: 'sedang' }),
        65,
        'Branch B2: Flood level sedang -> 65'
      );
      assert.equal(
        normalizeConditionScore({ genangan_air: true, tingkat_genangan: 'tinggi' }),
        95,
        'Branch B3: Flood level tinggi -> 95'
      );
      assert.equal(
        normalizeConditionScore({ genangan_air: true, tingkat_genangan: 'berat' }),
        95,
        'Branch B4: Flood level berat -> 95'
      );
      assert.equal(
        normalizeConditionScore({ genangan_air: true, tingkat_genangan: 'unknown' }),
        50,
        'Branch B5: Unknown flood level -> 50'
      );

      // Branch C: Traffic delay sensor thresholds (>= 80 -> 30, >= 30 -> 15, < 30 -> 0)
      assert.equal(
        normalizeConditionScore(null, { delayPercent: 85 }),
        30,
        'Branch C1: Delay >= 80 -> traffic score 30'
      );
      assert.equal(
        normalizeConditionScore(null, { delayPercent: 45 }),
        15,
        'Branch C2: Delay >= 30 -> traffic score 15'
      );
      assert.equal(
        normalizeConditionScore(null, { delayPercent: 10 }),
        0,
        'Branch C3: Free flow (< 30) -> traffic score 0'
      );

      // Branch D: Fallback to vision analysis for traffic when TomTom absent
      assert.equal(
        normalizeConditionScore({ kondisi_jalan: 'padat' }),
        15,
        'Branch D1: Vision kondisi padat -> 15'
      );
      assert.equal(
        normalizeConditionScore({ kondisi_jalan: 'macet_total' }),
        30,
        'Branch D2: Vision kondisi macet_total -> 30'
      );

      // Branch E: Confidence floor guardrail (< 0.4 upgrades condition to at least 45)
      const lowConfidenceResult = normalizeConditionScore({
        genangan_air: false,
        kondisi_jalan: 'lancar',
        confidence: 0.2,
      });
      assert.equal(lowConfidenceResult, 45, 'Branch E: Low confidence < 0.4 guardrail activates');

      // Branch F: No data at all default
      assert.equal(normalizeConditionScore(null, null), 20, 'Branch F: Default fallback is 20');
    });

    it('getScoreCategory: Boundary decisions for AMAN, HATI-HATI, HINDARI', () => {
      // AMAN: 0 - 29
      assert.equal(getScoreCategory(0).label, SCORE_LABELS.SAFE.label);
      assert.equal(getScoreCategory(29).label, SCORE_LABELS.SAFE.label);

      // HATI-HATI: 30 - 59
      assert.equal(getScoreCategory(30).label, SCORE_LABELS.CAUTION.label);
      assert.equal(getScoreCategory(59).label, SCORE_LABELS.CAUTION.label);

      // HINDARI: 60 - 100
      assert.equal(getScoreCategory(60).label, SCORE_LABELS.AVOID.label);
      assert.equal(getScoreCategory(100).label, SCORE_LABELS.AVOID.label);
    });
  });

  describe('3. Method Combinations & Invariants', () => {
    it('calculateRouteScore: Hand-computed attribute values & weights invariant sum = 1.0', () => {
      // Test with known deterministic inputs:
      // durationS = 300 (5 mins -> timeScore = 0)
      // pm2_5 = 12 (clean -> aqiScore = 0)
      // trafficData: delay 0, no flood -> conditionScore = 0
      // Hand computed expected total: 0.40*0 + 0.35*0 + 0.25*0 = 0 -> AMAN
      const perfectScore = calculateRouteScore({
        durationS: 300,
        trafficData: { delayPercent: 0, roadClosure: false },
        aqiData: { pm2_5: 12 },
        visualAnalysis: { genangan_air: false, confidence: 0.95 },
      });

      assert.equal(perfectScore.totalScore, 0);
      assert.equal(perfectScore.label, 'AMAN');

      // Worst case scenario:
      // durationS = 3600 (60 mins -> timeScore = 100)
      // pm2_5 = 150 (polluted -> aqiScore = 100)
      // roadClosure = true (conditionScore = 100)
      // Hand computed total: 0.40*100 + 0.35*100 + 0.25*100 = 100 -> HINDARI
      const worstScore = calculateRouteScore({
        durationS: 3600,
        trafficData: { roadClosure: true },
        aqiData: { pm2_5: 150 },
      });

      assert.equal(worstScore.totalScore, 100);
      assert.equal(worstScore.label, 'HINDARI');

      // Custom weights invariant: sum of normalized weights must equal 1.0
      const customScore = calculateRouteScore({
        durationS: 1950, // 50
        aqiData: { pm2_5: 81 }, // 50
        visualAnalysis: { genangan_air: true, tingkat_genangan: 'sedang', confidence: 0.9 }, // 65
        weights: { time: 2, aqi: 1, condition: 1 }, // Total 4 -> 0.5, 0.25, 0.25
      });
      // Hand computation: 50*0.5 + 50*0.25 + 65*0.25 = 25 + 12.5 + 16.25 = 53.75 -> Math.round -> 54
      assert.equal(customScore.totalScore, 54);
      assert.equal(customScore.label, 'HATI-HATI');
    });
  });
});
