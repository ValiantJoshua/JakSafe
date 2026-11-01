// ReAct Agent Orchestrator for jakSafe
// Combines Gemini multi-turn reasoning with 5 tools:
// Tool 1: get_route (OSRM)
// Tool 2: get_aqi (Open-Meteo)
// Tool 3: get_cctv_snapshot (Jakarta CCTV Catalog & Frame fetcher)
// Tool 4: analyze_image (Gemini Vision)
// Tool 5: get_traffic (TomTom Flow Segment)
//
// Calculates final multi-criteria scores using routeScorer.js and logs to MongoDB.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getRouteDeclaration, getRoute } from './tools/getRoute.js';
import { getAqiDeclaration, getAqi } from './tools/getAqi.js';
import { getCctvSnapshotDeclaration, getCctvSnapshot } from './tools/getCctvSnapshot.js';
import { analyzeImageDeclaration, analyzeImage } from './tools/analyzeImage.js';
import { getTrafficDeclaration, getTraffic } from './tools/getTraffic.js';
import { calculateRouteScore, DEFAULT_WEIGHTS } from '../scoring/routeScorer.js';
import { saveExecutionLog } from '../db/mongoClient.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const MAX_STEPS = 6;

const SYSTEM_INSTRUCTION = [
  'Anda adalah agen navigasi cerdas jakSafe untuk wilayah DKI Jakarta.',
  'Tugas Anda adalah menemukan dan mengevaluasi rute perjalanan teraman dan tersehat.',
  'Evaluasi didasarkan pada 3 pilar: 1. Waktu tempuh & kemacetan (OSRM & TomTom), 2. Kualitas udara PM2.5 (Open-Meteo), 3. Kondisi fisik/visual jalan dan genangan banjir (CCTV Jakarta & Vision).',
  'Alur kerja Anda (ReAct):',
  '1. Cari rute menggunakan get_route.',
  '2. Periksa kemacetan real-time pada rute menggunakan get_traffic.',
  '3. Periksa kualitas udara PM2.5 di sepanjang rute menggunakan get_aqi.',
  '4. Cari snapshot CCTV terdekat di titik kritis menggunakan get_cctv_snapshot, lalu analisis gambar dengan analyze_image jika kamera tersedia.',
  '5. Berikan kesimpulan dan rekomendasi rute yang holistik.',
  'ATURAN FORMAT JAWABAN AKHIR (SANGAT PENTING):',
  '- Tuliskan kesimpulan akhir secara RINGKAS, PADAT, dan ELEGAN (cukup 2–3 kalimat langsung ke intinya).',
  '- Fokuskan HANYA pada: (a) Status kelayakan rute & lalu lintas, dan (b) Tindakan mitigasi / saran praktis bagi pengguna (misal: mode sirkulasi AC, kewaspadaan genangan, atau pilihan waktu berangkat).',
  '- JANGAN mengulang-ulang daftar angka mentah (seperti koordinat [lat, lon], jarak km, detik, persentase delay, angka PM2.5 eksak), karena seluruh metrik tersebut SUDAH ditampilkan secara visual di kartu statistik antarmuka pengguna.',
  '- Gunakan bahasa Indonesia yang ramah, profesional, dan actionable.',
  'ATURAN ETIKA: Jangan pernah mengidentifikasi orang atau plat kendaraan.',
].join(' ');

/** Helper to summarize air quality from results */
function summarizeAqiResults(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  let maxPm25 = 0;
  let maxAqi = 0;
  let category = results[0]?.usAqiCategory?.label || 'Moderate';
  for (const r of results) {
    const pm = Number(r.values?.pm2_5) || 0;
    const aqi = Number(r.values?.us_aqi) || 0;
    if (pm > maxPm25) maxPm25 = Math.round(pm * 10) / 10;
    if (aqi > maxAqi) {
      maxAqi = Math.round(aqi);
      if (r.usAqiCategory?.label) category = r.usAqiCategory.label;
    }
  }
  return {
    pm2_5: maxPm25,
    us_aqi: maxAqi,
    usAqiCategory: category,
    time: results[0]?.time || new Date().toISOString(),
  };
}

/** Helper to sample coordinates along an [[lon, lat], ...] line */
function samplePoints(geometry, count = 3) {
  if (!Array.isArray(geometry) || geometry.length === 0) return [];
  if (geometry.length <= count) {
    return geometry.map(([lon, lat]) => ({ lat, lon }));
  }
  const result = [];
  const step = (geometry.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    const idx = Math.min(geometry.length - 1, Math.round(i * step));
    const [lon, lat] = geometry[idx];
    result.push({ lat, lon });
  }
  return result;
}

/** Midpoint helper */
function getMidpoint(geometry) {
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  const mid = geometry[Math.floor(geometry.length / 2)];
  return { lon: mid[0], lat: mid[1] };
}

/** Clean up large image data before storing in reasoning trace */
function sanitizeObservation(action, data) {
  if (action === 'get_cctv_snapshot' && data?.image?.base64) {
    return {
      ok: data.ok,
      camera: data.camera,
      image: {
        mimeType: data.image.mimeType,
        bytes: data.image.bytes,
        base64: `[BASE64_IMAGE_${data.image.bytes}_BYTES]`,
      },
    };
  }
  if (action === 'analyze_image' && data?.analysis) {
    return {
      ok: data.ok,
      analysis: data.analysis,
    };
  }
  return data;
}

/**
 * Execute a navigation request through the ReAct agent.
 *
 * @param {object} params
 * @param {{ lat: number, lon: number }} params.origin
 * @param {{ lat: number, lon: number }} params.destination
 * @param {'car'|'bike'|'foot'} [params.profile='car']
 * @param {{ healthSensitive?: boolean }} [params.preferences]
 * @returns {Promise<object>} Complete navigation result conforming to JakSafe frontend contract
 */
export async function runNavigationAgent({
  origin,
  destination,
  profile = 'car',
  preferences = {},
}) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const reasoning = [];
  let stepIndex = 1;

  // Context collected across tool calls
  let primaryRoute = null;
  let alternativeRoutes = [];
  let trafficData = null;
  let aqiData = null;
  let airSummary = null;
  let lastCctvSnapshot = null;
  let visualResult = null;
  let agentFinalThought = '';

  // Calculate weights based on user preferences
  const weights = preferences.healthSensitive
    ? { time: 0.30, aqi: 0.50, condition: 0.20 }
    : { ...DEFAULT_WEIGHTS };

  const toolDeclarations = [
    getRouteDeclaration,
    getTrafficDeclaration,
    getAqiDeclaration,
    getCctvSnapshotDeclaration,
    analyzeImageDeclaration,
  ];

  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_REASONING_MODEL || process.env.GEMINI_VISION_MODEL || DEFAULT_MODEL;

  let model = null;
  if (apiKey) {
    const ai = new GoogleGenerativeAI(apiKey);
    model = ai.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations: toolDeclarations }],
    });
  }

  // Initial user prompt for the ReAct loop
  const initialPrompt = [
    `Rencanakan rute dari koordinat asal [lat: ${origin.lat}, lon: ${origin.lon}] `,
    `ke koordinat tujuan [lat: ${destination.lat}, lon: ${destination.lon}] `,
    `dengan moda transportasi ${profile}. `,
    preferences.healthSensitive ? 'Pengguna sangat sensitif terhadap polusi udara (prioritaskan udara bersih). ' : '',
    'Gunakan tool yang relevan untuk memeriksa rute jalan, lalu lintas terkini, kualitas udara PM2.5, dan kondisi visual CCTV di jalan.',
  ].join('');

  const contents = [{ role: 'user', parts: [{ text: initialPrompt }] }];

  try {
    if (model) {
      for (let step = 0; step < MAX_STEPS; step++) {
        const stepStart = Date.now();
        const response = await model.generateContent({ contents });
        const candidate = response.response?.candidates?.[0];
        if (!candidate) break;

        const functionCalls = response.response.functionCalls();
        if (!functionCalls || functionCalls.length === 0) {
          // Model completed its final thought / text answer
          const finalText = response.response.text ? response.response.text() : '';
          agentFinalThought = finalText;
          reasoning.push({
            step: stepIndex++,
            thought: finalText || 'Analisis dan evaluasi rute selesai.',
            action: 'finish',
            observation: 'completed',
            durationMs: Date.now() - stepStart,
          });
          break;
        }

        // Add model's candidate content to keep thought signatures
        contents.push(candidate.content);

        const functionResponseParts = [];

        for (const call of functionCalls) {
          const actionStart = Date.now();
          let toolResult = null;

          if (call.name === 'get_route') {
            toolResult = await getRoute(call.args);
            if (toolResult.ok && toolResult.routes?.length > 0) {
              primaryRoute = toolResult.routes[0];
              alternativeRoutes = toolResult.routes.slice(1);
            }
          } else if (call.name === 'get_traffic') {
            toolResult = await getTraffic(call.args);
            if (toolResult.ok) {
              trafficData = toolResult;
            }
          } else if (call.name === 'get_aqi') {
            toolResult = await getAqi(call.args);
            if (toolResult.ok && Array.isArray(toolResult.results)) {
              airSummary = summarizeAqiResults(toolResult.results);
              aqiData = airSummary ? { pm2_5: airSummary.pm2_5, us_aqi: airSummary.us_aqi } : null;
            }
          } else if (call.name === 'get_cctv_snapshot') {
            toolResult = await getCctvSnapshot(call.args);
            if (toolResult.ok) {
              lastCctvSnapshot = toolResult;
              const cam = toolResult.camera || {};
              visualResult = {
                cameraId: cam.id,
                cameraName: cam.name,
                fetchedAt: cam.fetchedAt || new Date().toISOString(),
                analysis: null,
                kamera: {
                  id: cam.id,
                  nama: cam.name,
                  jarakM: Number.isFinite(cam.distanceM) ? cam.distanceM : null,
                  provider: cam.provider || null,
                  license: cam.license || null,
                },
                analisis: null,
              };
            }
          } else if (call.name === 'analyze_image') {
            let imageBase64 = call.args?.image_base64;
            let mimeType = call.args?.mime_type || 'image/jpeg';
            let context = call.args?.context || '';

            // If model called analyze_image without raw base64, reuse last snapshot
            if (!imageBase64 && lastCctvSnapshot?.image?.base64) {
              imageBase64 = lastCctvSnapshot.image.base64;
              mimeType = lastCctvSnapshot.image.mimeType;
              context = lastCctvSnapshot.camera?.name || context;
            }

            if (imageBase64) {
              toolResult = await analyzeImage({ image_base64: imageBase64, mime_type: mimeType, context });
              if (toolResult.ok && visualResult) {
                visualResult.analysis = toolResult.analysis;
                visualResult.analisis = toolResult.analysis;
              }
            } else {
              toolResult = { ok: false, error: 'no image base64 provided or available' };
            }
          } else {
            toolResult = { ok: false, error: `unknown tool: ${call.name}` };
          }

          const actionDuration = Date.now() - actionStart;
          const sanitized = sanitizeObservation(call.name, toolResult);

          reasoning.push({
            step: stepIndex++,
            thought: `Menjalankan tool ${call.name} dengan parameter ${JSON.stringify(call.args)}`,
            action: call.name,
            observation: sanitized,
            durationMs: actionDuration,
          });

          // Prepare function response part (pass sanitized to prevent token bloat)
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: sanitized,
            },
          });
        }

        contents.push({
          role: 'user',
          parts: functionResponseParts,
        });
      }
    }
  } catch (err) {
    console.warn('[reactAgent] ReAct reasoning loop error:', err.message);
    reasoning.push({
      step: stepIndex++,
      thought: `Terjadi kendala pada model reasoning (${err.message}). Melanjutkan kalkulasi terpadu secara deterministik.`,
      action: 'fallback',
      observation: { error: err.message },
      durationMs: 0,
    });
  }

  // Ensure primary route exists (Deterministic fallback if agent did not fetch it)
  if (!primaryRoute) {
    const routeRes = await getRoute({ origin, destination, profile, alternatives: true });
    if (routeRes.ok && routeRes.routes?.length > 0) {
      primaryRoute = routeRes.routes[0];
      alternativeRoutes = routeRes.routes.slice(1);
      reasoning.push({
        step: stepIndex++,
        thought: 'Mengambil rute jalan OSRM secara langsung untuk memastikan rute tersedia.',
        action: 'get_route_fallback',
        observation: { distanceM: primaryRoute.distanceM, durationS: primaryRoute.durationS },
        durationMs: 0,
      });
    } else {
      throw new Error(routeRes.error || 'Gagal menghitung rute navigasi');
    }
  }

  const midpoint = getMidpoint(primaryRoute.geometry) || { lat: origin.lat, lon: origin.lon };

  // Ensure traffic check was performed
  if (!trafficData) {
    const trafficRes = await getTraffic(midpoint);
    if (trafficRes.ok) {
      trafficData = trafficRes;
    }
  }

  // Ensure air quality check was performed
  if (!airSummary) {
    const samplePts = samplePoints(primaryRoute.geometry, 3);
    const aqiRes = await getAqi({ points: samplePts });
    if (aqiRes.ok && Array.isArray(aqiRes.results)) {
      airSummary = summarizeAqiResults(aqiRes.results);
      aqiData = airSummary ? { pm2_5: airSummary.pm2_5, us_aqi: airSummary.us_aqi } : null;
    }
  }

  // Ensure visual check was attempted if camera is nearby or analysis is pending
  if (lastCctvSnapshot?.image?.base64 && visualResult && !visualResult.analysis) {
    const visionRes = await analyzeImage({
      image_base64: lastCctvSnapshot.image.base64,
      mime_type: lastCctvSnapshot.image.mimeType,
      context: lastCctvSnapshot.camera?.name,
    });
    if (visionRes.ok) {
      visualResult.analysis = visionRes.analysis;
      visualResult.analisis = visionRes.analysis;
    }
  } else if (!visualResult) {
    const cctvRes = await getCctvSnapshot({ lat: midpoint.lat, lon: midpoint.lon, radius_m: 1000 });
    if (cctvRes.ok && cctvRes.image?.base64) {
      const visionRes = await analyzeImage({
        image_base64: cctvRes.image.base64,
        mime_type: cctvRes.image.mimeType,
        context: cctvRes.camera?.name,
      });
      const cam = cctvRes.camera || {};
      visualResult = {
        cameraId: cam.id,
        cameraName: cam.name,
        fetchedAt: cam.fetchedAt || new Date().toISOString(),
        analysis: visionRes.ok ? visionRes.analysis : null,
        kamera: {
          id: cam.id,
          nama: cam.name,
          jarakM: Number.isFinite(cam.distanceM) ? cam.distanceM : null,
          provider: cam.provider || null,
          license: cam.license || null,
        },
        analisis: visionRes.ok ? visionRes.analysis : null,
      };
    }
  }

  // Compute final multi-criteria score for the primary route
  const primaryScore = calculateRouteScore({
    durationS: primaryRoute.durationS,
    trafficData,
    aqiData: aqiData || {},
    visualAnalysis: visualResult?.analysis || null,
    weights,
  });

  // Score alternative routes for comparison
  const alternatives = alternativeRoutes.map((alt) => {
    const altScore = calculateRouteScore({
      durationS: alt.durationS,
      trafficData: null,
      aqiData: aqiData || {},
      visualAnalysis: null,
      weights,
    });
    return {
      distanceM: alt.distanceM,
      durationS: alt.durationS,
      geometry: alt.geometry,
      totalScore: altScore.totalScore,
      label: altScore.label,
      color: altScore.color,
    };
  });

  const totalDurationMs = Date.now() - startTime;

  const resultPayload = {
    ok: true,
    route: {
      distanceM: primaryRoute.distanceM,
      durationS: primaryRoute.durationS,
      geometry: primaryRoute.geometry,
    },
    score: primaryScore,
    air: airSummary
      ? {
          ...airSummary,
          titikTerburuk: { time: airSummary.time },
        }
      : null,
    visual: visualResult,
    reason: agentFinalThought || null,
    reasoning,
    alternatives,
  };

  // Asynchronously log to MongoDB
  saveExecutionLog({
    requestId,
    timestamp: new Date(),
    origin,
    destination,
    profile,
    preferences,
    reasoning,
    route: resultPayload.route,
    score: primaryScore,
    air: airSummary,
    visual: visualResult,
    traffic: trafficData,
    alternatives,
    totalDurationMs,
    status: 'success',
  }).catch((e) => console.warn('[mongo] Background log error:', e.message));

  return resultPayload;
}
