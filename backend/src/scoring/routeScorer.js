// Multi-Criteria Route Scoring Engine for jakSafe
// Combines 3 independent factors into a unified risk/safety score (0 - 100):
// 1. Travel Time (OSRM baseline duration calibrated with TomTom real-time delay)
// 2. Air Pollution (PM2.5 / AQI from Open-Meteo)
// 3. Road & Visual Condition (Flood detection from CCTV + Gemini Vision, augmented by TomTom traffic)
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
 * @param {number} durationS Duration in seconds (real-time calibrated)
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
 * Normalizes road condition to 0 - 100 using both CCTV Visual Analysis and TomTom Traffic data.
 * Factors:
 * - Flood presence & severity from Gemini Vision (major weight)
 * - Road closure or extreme congestion from TomTom (when CCTV is unavailable or augmenting)
 * - Traffic congestion contribution
 * - Confidence guardrail: vision confidence < 0.4 downgrades to caution (at least 45)
 * @param {object} [analysis] Output from analyzeImage tool (CCTV + Gemini Vision)
 * @param {object} [trafficData] Output from TomTom flow segment { delayPercent, roadClosure }
 * @returns {number} Score between 0 and 100
 */
export function normalizeConditionScore(analysis, trafficData = null) {
  // If road is reported closed by TomTom -> maximum hazard
  if (trafficData?.roadClosure) {
    return 100;
  }

  // Base score from flooding (Gemini Vision)
  let floodScore = 0;
  if (analysis?.genangan_air) {
    const level = String(analysis.tingkat_genangan || '').toLowerCase();
    if (level === 'rendah' || level === 'ringan') floodScore = 35;
    else if (level === 'sedang') floodScore = 65;
    else if (level === 'berat' || level === 'tinggi') floodScore = 95;
    else floodScore = 50;
  }

  // Traffic congestion score: prioritize TomTom sensor delay if available, else vision analysis
  let trafficScore = 0;
  if (trafficData && Number.isFinite(trafficData.delayPercent)) {
    if (trafficData.delayPercent >= 80) trafficScore = 30;       // Severe congestion
    else if (trafficData.delayPercent >= 30) trafficScore = 15;  // Moderate congestion
    else trafficScore = 0;                                       // Free flow
  } else if (analysis?.kondisi_jalan) {
    const traffic = String(analysis.kondisi_jalan).toLowerCase();
    if (traffic === 'padat' || traffic === 'merayap') trafficScore = 15;
    else if (traffic === 'macet' || traffic === 'macet_total') trafficScore = 30;
  }

  let totalCondition = floodScore + trafficScore;

  // If no CCTV analysis and no traffic data -> neutral default
  if (!analysis && !trafficData) {
    totalCondition = 20;
  }

  // Ethical guardrail: low confidence visual analysis degrades to caution
  if (analysis && Number.isFinite(analysis.confidence) && analysis.confidence < 0.4) {
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
 * Calibrates OSRM duration with TomTom real-time traffic delay.
 * @param {object} params
 * @param {number} params.durationS Route duration in seconds (from OSRM Tool 1)
 * @param {object} [params.trafficData] Real-time traffic data from TomTom { delayPercent, currentSpeedKmH, roadClosure }
 * @param {object} params.aqiData Air quality data { pm2_5, us_aqi } (from Open-Meteo Tool 2)
 * @param {object} [params.visualAnalysis] CCTV analysis result (from Gemini Vision Tool 4)
 * @param {object} [params.weights] Optional custom weights { time, aqi, condition }
 * @returns {{
 *   totalScore: number,
 *   label: string,
 *   color: string,
 *   breakdown: {
 *     time: { score: number, weight: number, baseDurationMin: number, effectiveDurationMin: number, delayPercent: number, trafficSource: string },
 *     aqi: { score: number, weight: number, pm2_5?: number, us_aqi?: number },
 *     condition: { score: number, weight: number, floodDetected: boolean, roadClosure: boolean, traffic: string }
 *   }
 * }}
 */
export function calculateRouteScore({
  durationS,
  trafficData = null,
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

  // Calibrate baseline duration with real-time TomTom delay
  let effectiveDurationS = durationS;
  let delayPercent = 0;
  if (trafficData && Number.isFinite(trafficData.delayPercent) && trafficData.delayPercent > 0) {
    delayPercent = trafficData.delayPercent;
    effectiveDurationS = Math.round(durationS * (1 + delayPercent / 100));
  }
  if (trafficData?.roadClosure) {
    effectiveDurationS = Math.max(effectiveDurationS, 3600); // Heavy penalty for closed road
  }

  const timeScore = normalizeTimeScore(effectiveDurationS);
  const aqiScore = normalizeAqiScore(aqiData);
  const conditionScore = normalizeConditionScore(visualAnalysis, trafficData);

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
        baseDurationMin: Math.round(durationS / 60),
        effectiveDurationMin: Math.round(effectiveDurationS / 60),
        delayPercent,
        trafficSource: trafficData ? 'TomTom Live' : 'OSRM Baseline',
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
        roadClosure: Boolean(trafficData?.roadClosure),
        traffic: trafficData
          ? (trafficData.delayPercent >= 80 ? 'macet_berat' : trafficData.delayPercent >= 30 ? 'padat' : 'lancar')
          : (visualAnalysis?.kondisi_jalan || 'normal'),
      },
    },
  };
}
