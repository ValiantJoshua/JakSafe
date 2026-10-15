// Multi-Criteria Route Scoring Engine for jakSafe
// Combines 3 independent factors into a unified risk/safety score (0 - 100):
// 1. Travel Time (OSRM duration)
// 2. Air Pollution (PM2.5 / AQI from Open-Meteo)
// 3. Road & Visual Condition (Flood/traffic detection from CCTV + Gemini Vision)
//
// Reference: JAKSENTINEL_PROJECT_GUIDE.md Section 8

export const DEFAULT_WEIGHTS = {
  time: 0.40,
  aqi: 0.35,
  condition: 0.25,
};

export const SCORE_LABELS = {
  SAFE: { min: 0, max: 29, label: 'AMAN', color: '#22c55e' },         // Green
  CAUTION: { min: 30, max: 59, label: 'HATI-HATI', color: '#f59e0b' }, // Yellow/Orange
  AVOID: { min: 60, max: 100, label: 'HINDARI', color: '#ef4444' },    // Red
};

/**
 * Normalizes travel duration to a 0 - 100 score.
 * < 5 mins = 0 (best)
 * > 60 mins = 100 (worst)
 * @param {number} durationS Duration in seconds
 * @returns {number} Score between 0 and 100
 */
export function normalizeTimeScore(durationS) {
  if (!Number.isFinite(durationS) || durationS <= 0) return 50; // Neutral fallback
  const durationMin = durationS / 60;
  if (durationMin <= 5) return 0;
  if (durationMin >= 60) return 100;
  // Linear scale between 5m (0) and 60m (100)
  return Math.round(((durationMin - 5) / (60 - 5)) * 100);
}

/**
 * Normalizes PM2.5 or US AQI to a 0 - 100 score.
 * PM2.5 <= 12 µg/m³ = 0 (clean)
 * PM2.5 >= 150 µg/m³ = 100 (very polluted)
 * @param {object} opts
 * @param {number} [opts.pm2_5] PM2.5 in µg/m³
 * @param {number} [opts.us_aqi] US AQI index (fallback if pm2_5 is missing)
 * @returns {number} Score between 0 and 100
 */
export function normalizeAqiScore({ pm2_5, us_aqi }) {
  if (Number.isFinite(pm2_5)) {
    if (pm2_5 <= 12) return 0;
    if (pm2_5 >= 150) return 100;
    return Math.round(((pm2_5 - 12) / (150 - 12)) * 100);
  }
  if (Number.isFinite(us_aqi)) {
    if (us_aqi <= 50) return 0;
    if (us_aqi >= 200) return 100;
    return Math.round(((us_aqi - 50) / (200 - 50)) * 100);
  }
  return 50; // Neutral fallback if no air data
}

/**
 * Normalizes visual road condition (from Gemini Vision analysis) to 0 - 100.
 * Factors:
 * - Flood presence & severity (major weight)
 * - Traffic congestion (minor weight)
 * - Confidence guardrail: confidence < 0.4 downgrades to caution (at least 45)
 * @param {object} [analysis] Output from analyzeImage tool
 * @returns {number} Score between 0 and 100
 */
export function normalizeConditionScore(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    // No camera nearby or analysis unavailable -> neutral condition
    return 20;
  }

  const {
    genangan_air = false,
    tingkat_genangan = 'tidak_ada',
    kondisi_jalan = 'lancar',
    confidence = 1.0,
  } = analysis;

  // Base score from flooding
  let floodScore = 0;
  if (genangan_air) {
    const level = String(tingkat_genangan).toLowerCase();
    if (level === 'rendah' || level === 'ringan') floodScore = 35;
    else if (level === 'sedang') floodScore = 65;
    else if (level === 'berat' || level === 'tinggi') floodScore = 95;
    else floodScore = 50;
  }

  // Traffic congestion contribution
  let trafficScore = 0;
  const traffic = String(kondisi_jalan).toLowerCase();
  if (traffic === 'padat' || traffic === 'merayap') trafficScore = 15;
  else if (traffic === 'macet' || traffic === 'macet_total') trafficScore = 30;

  let totalCondition = floodScore + trafficScore;

  // Ethical guardrail: low confidence degrades to caution
  if (Number.isFinite(confidence) && confidence < 0.4) {
    totalCondition = Math.max(totalCondition, 45);
  }

  return Math.min(100, Math.max(0, Math.round(totalCondition)));
}

/**
 * Determine the qualitative label and color for a total score.
 * @param {number} totalScore 0 - 100
 * @returns {{ label: string, color: string }}
 */
export function getScoreCategory(totalScore) {
  if (totalScore <= SCORE_LABELS.SAFE.max) return SCORE_LABELS.SAFE;
  if (totalScore <= SCORE_LABELS.CAUTION.max) return SCORE_LABELS.CAUTION;
  return SCORE_LABELS.AVOID;
}

/**
 * Calculates the multi-criteria score for a route.
 * @param {object} params
 * @param {number} params.durationS Route duration in seconds (from Tool 1)
 * @param {object} params.aqiData Air quality data { pm2_5, us_aqi } (from Tool 2)
 * @param {object} [params.visualAnalysis] CCTV analysis result (from Tool 4)
 * @param {object} [params.weights] Optional custom weights { time, aqi, condition }
 * @returns {{
 *   totalScore: number,
 *   label: string,
 *   color: string,
 *   breakdown: {
 *     time: { score: number, weight: number, durationMinutes: number },
 *     aqi: { score: number, weight: number, pm2_5?: number, us_aqi?: number },
 *     condition: { score: number, weight: number, floodDetected: boolean, traffic: string }
 *   }
 * }}
 */
export function calculateRouteScore({
  durationS,
  aqiData = {},
  visualAnalysis = null,
  weights = DEFAULT_WEIGHTS,
}) {
  // Normalize custom weights so they sum to 1.0
  const rawW = { ...DEFAULT_WEIGHTS, ...weights };
  const sumW = (rawW.time || 0) + (rawW.aqi || 0) + (rawW.condition || 0);
  const w = {
    time: (rawW.time || 0) / sumW,
    aqi: (rawW.aqi || 0) / sumW,
    condition: (rawW.condition || 0) / sumW,
  };

  const timeScore = normalizeTimeScore(durationS);
  const aqiScore = normalizeAqiScore(aqiData);
  const conditionScore = normalizeConditionScore(visualAnalysis);

  const totalScore = Math.round(
    (timeScore * w.time) + (aqiScore * w.aqi) + (conditionScore * w.condition)
  );

  const category = getScoreCategory(totalScore);

  return {
    totalScore,
    label: category.label,
    color: category.color,
    breakdown: {
      time: {
        score: timeScore,
        weight: Number(w.time.toFixed(2)),
        durationMinutes: Math.round(durationS / 60),
      },
      aqi: {
        score: aqiScore,
        weight: Number(w.aqi.toFixed(2)),
        pm2_5: aqiData?.pm2_5 ?? null,
        us_aqi: aqiData?.us_aqi ?? null,
      },
      condition: {
        score: conditionScore,
        weight: Number(w.condition.toFixed(2)),
        floodDetected: Boolean(visualAnalysis?.genangan_air),
        traffic: visualAnalysis?.kondisi_jalan || 'normal',
      },
    },
  };
}
