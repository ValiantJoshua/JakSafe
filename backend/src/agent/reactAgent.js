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
import { findNearest, publicView } from '../services/cctvCatalog.js';
import { attachHealth, sortCandidatesByHealth } from '../services/cctvHealthService.js';
import { saveExecutionLog } from '../db/mongoClient.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
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
export function summarizeAqiResults(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  let maxPm25 = 0;
  let maxAqi = 0;
  let category = results[0]?.usAqiCategory?.label || 'Moderate';
  let worstPmPoint = null;
  let worstAqiPoint = null;
  let firstValidPoint = null;

  for (const r of results) {
    if (!r) continue;
    const hasCoords = Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon));
    if (!firstValidPoint && hasCoords && !r.unavailable) firstValidPoint = r;

    const pm = Number(r.values?.pm2_5) || 0;
    const aqi = Number(r.values?.us_aqi) || 0;
    if (pm > maxPm25) {
      maxPm25 = Math.round(pm * 10) / 10;
      if (hasCoords) worstPmPoint = r;
    }
    if (aqi > maxAqi) {
      maxAqi = Math.round(aqi);
      if (r.usAqiCategory?.label) category = r.usAqiCategory.label;
      if (hasCoords) worstAqiPoint = r;
    }
  }

  const worst = worstPmPoint || worstAqiPoint || firstValidPoint || results[0];
  const time = worst?.time || results[0]?.time || new Date().toISOString();
  const hasWorstCoords = Number.isFinite(Number(worst?.lat)) && Number.isFinite(Number(worst?.lon));
  const titikTerburuk = hasWorstCoords
    ? {
      lat: Number(worst.lat),
      lon: Number(worst.lon),
      time,
      values: worst.values || null,
      usAqiCategory: worst.usAqiCategory || null,
    }
    : { time };

  return {
    pm2_5: maxPm25,
    us_aqi: maxAqi,
    usAqiCategory: category,
    time,
    titikTerburuk,
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

/** Clean up large image/geometry data before storing in reasoning trace */
function sanitizeObservation(action, data) {
  if (action === 'get_route' && data?.ok && Array.isArray(data.routes)) {
    const first = data.routes[0] || {};
    return {
      ok: true,
      profile: data.profile,
      distanceM: first.distanceM,
      durationS: first.durationS,
      summary: first.summary,
      routes: data.routes.map((r) => ({
        distanceM: r.distanceM,
        durationS: r.durationS,
        summary: r.summary,
        stepCount: Array.isArray(r.steps) ? r.steps.length : 0,
        sampledPoints: samplePoints(r.geometry, 3),
      })),
    };
  }
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
 * Menghasilkan rekomendasi ringkas dalam bahasa Indonesia apabila seluruh model Gemini
 * sedang mengalami lonjakan beban (503) atau loop selesai sebelum menyusun teks akhir.
 */
function buildFallbackAgentSummary({ primaryRoute, primaryScore, trafficData, airSummary, visualResult, alternatives = [] }) {
  const corridor = primaryRoute?.summary || 'jalur utama';
  const statusLabel = primaryScore?.label === 'AMAN'
    ? 'relatif aman dan terkendali'
    : primaryScore?.label === 'HATI-HATI'
      ? 'memerlukan kewaspadaan ekstra'
      : 'cukup padat dan berisiko tinggi';

  const maxDelay = Number(trafficData?.maxDelayPercent ?? trafficData?.delayPercent ?? 0);
  const trafficPhrase = maxDelay >= 45
    ? 'terpantau kepadatan signifikan di beberapa segmen jalan'
    : maxDelay >= 15
      ? 'arus lalu lintas bergerak melambat di sejumlah titik'
      : 'arus lalu lintas cenderung lancar di sepanjang koridor';

  const pm25 = Number(airSummary?.pm2_5 ?? 0);
  const airAdvice = pm25 > 55
    ? 'Nyalakan sirkulasi udara dalam (recirculation) AC atau gunakan masker karena kepekatan polutan udara cukup tinggi.'
    : pm25 > 25
      ? 'Disarankan menjaga ventilasi kabin tetap tertutup saat melewati persimpangan padat.'
      : 'Kualitas udara di sepanjang koridor berada dalam batas nyaman untuk perjalanan.';

  const floodWarn = visualResult?.analysis?.genangan_air
    ? ' Waspadai potensi genangan air yang terdeteksi pada pantauan kamera di sekitar rute.'
    : '';

  const bestAlt = alternatives.find((a) => a.totalScore < (primaryScore?.totalScore ?? 100));
  const altAdvice = bestAlt
    ? ` Anda juga dapat mempertimbangkan jalur alternatif melalui ${bestAlt.summary} yang memiliki indeks risiko lebih rendah.`
    : '';

  return `Perjalanan melalui ${corridor} saat ini ${statusLabel} dengan kondisi ${trafficPhrase}. ${airAdvice}${floodWarn}${altAdvice}`;
}

/**
 * Memanggil generateContent dengan rantai fallback model otomatis apabila model utama
 * mengembalikan 503 Service Unavailable / 429 / 404.
 */
async function generateContentWithFallback(ai, candidateModels, toolDeclarations, contents) {
  let lastErr = null;
  for (const modelName of candidateModels) {
    try {
      const model = ai.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: toolDeclarations }],
      });
      return await model.generateContent({ contents });
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      // Jika API key ditolak (401/403), jangan ulangi ke model lain
      if (/API key|API_KEY|permission|403|401/i.test(msg)) {
        throw err;
      }
      console.warn(`[reactAgent] Model ${modelName} busy/unavailable (${msg.slice(0, 90)}), switching to fallback model...`);
    }
  }
  throw lastErr || new Error('All Gemini models unavailable');
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
  const preferredModel = process.env.GEMINI_REASONING_MODEL || process.env.GEMINI_VISION_MODEL || DEFAULT_MODEL;
  const candidateModels = [...new Set([preferredModel, ...FALLBACK_MODELS])];

  const ai = apiKey ? new GoogleGenerativeAI(apiKey) : null;

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
    if (ai) {
      for (let step = 0; step < MAX_STEPS; step++) {
        const stepStart = Date.now();
        const response = await generateContentWithFallback(ai, candidateModels, toolDeclarations, contents);
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
            toolResult = await getRoute({ ...call.args, profile: call.args?.profile || profile, alternatives: true });
            if (toolResult.ok && toolResult.routes?.length > 0) {
              primaryRoute = toolResult.routes[0];
              alternativeRoutes = toolResult.routes.slice(1);
            }
          } else if (call.name === 'get_traffic') {
            const trafficArgs = primaryRoute?.geometry?.length > 1 && !call.args?.points
              ? { ...call.args, geometry: primaryRoute.geometry, distanceM: primaryRoute.distanceM }
              : call.args;
            toolResult = await getTraffic(trafficArgs);
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

            const cameraId = call.args?.camera_id || lastCctvSnapshot?.camera?.id || null;

            if (imageBase64) {
              toolResult = await analyzeImage({
                image_base64: imageBase64,
                mime_type: mimeType,
                context,
                camera_id: cameraId,
              });
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
    console.warn('[reactAgent] ReAct reasoning loop fallback triggered:', err.message);
    reasoning.push({
      step: stepIndex++,
      thought: 'Melanjutkan evaluasi multi-sensor secara deterministik karena antrean padat pada server model.',
      action: 'fallback',
      observation: { status: 'deterministic_pipeline' },
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
        thought: 'Mengambil rute jalan secara langsung untuk memastikan rute tersedia.',
        action: 'get_route_fallback',
        observation: { distanceM: primaryRoute.distanceM, durationS: primaryRoute.durationS },
        durationMs: 0,
      });
    } else {
      throw new Error(routeRes.error || 'Gagal menghitung rute navigasi');
    }
  }

  const midpoint = getMidpoint(primaryRoute.geometry) || { lat: origin.lat, lon: origin.lon };

  // Ensure multi-segment traffic check was performed along the route corridor
  if (!trafficData || ((trafficData.sampleCount ?? 1) < 2 && primaryRoute.geometry?.length > 2)) {
    const trafficRes = await getTraffic({
      geometry: primaryRoute.geometry,
      distanceM: primaryRoute.distanceM,
    });
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

  // Ensure visual check was attempted if camera is nearby or analysis is pending.
  // Prioritize the most congested segment (worstSegment) on the route before falling back to midpoint.
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
    const bottleneckPt = trafficData?.worstSegment?.delayPercent > 0
      ? { lat: trafficData.worstSegment.lat, lon: trafficData.worstSegment.lon }
      : midpoint;
    let cctvRes = await getCctvSnapshot({ lat: bottleneckPt.lat, lon: bottleneckPt.lon, radius_m: 1000 });
    if (!cctvRes.ok && (bottleneckPt.lat !== midpoint.lat || bottleneckPt.lon !== midpoint.lon)) {
      cctvRes = await getCctvSnapshot({ lat: midpoint.lat, lon: midpoint.lon, radius_m: 1000 });
    }
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

  // Score alternative routes with multi-segment corridor traffic, AQI & nearest CCTV metadata
  const alternatives = await Promise.all(
    alternativeRoutes.map(async (alt, idx) => {
      const altMid = getMidpoint(alt.geometry) || midpoint;

      let altTraffic = null;
      try {
        const tr = await getTraffic({
          geometry: alt.geometry,
          distanceM: alt.distanceM,
        });
        if (tr.ok) altTraffic = tr;
      } catch {
        altTraffic = trafficData;
      }

      let altAir = airSummary;
      try {
        const altPts = samplePoints(alt.geometry, 2);
        const aq = await getAqi({ points: altPts });
        if (aq.ok && Array.isArray(aq.results) && aq.results.length > 0) {
          altAir = summarizeAqiResults(aq.results);
        }
      } catch {
        altAir = airSummary;
      }

      let altVisual = null;
      try {
        const altTarget = altTraffic?.worstSegment?.delayPercent > 0
          ? altTraffic.worstSegment
          : altMid;
        let nearestList = findNearest(altTarget.lat, altTarget.lon, { radiusM: 1000, limit: 6 });
        if (nearestList.length === 0 && altTarget !== altMid) {
          nearestList = findNearest(altMid.lat, altMid.lon, { radiusM: 1000, limit: 6 });
        }
        if (nearestList.length > 0) {
          const prioritized = sortCandidatesByHealth(nearestList);
          const found = prioritized[0];
          const camView = attachHealth(publicView(found.camera));
          const sameAsPrimary = visualResult?.cameraId === camView.id;
          altVisual = {
            cameraId: camView.id,
            cameraName: camView.name,
            fetchedAt: new Date().toISOString(),
            analysis: sameAsPrimary ? visualResult.analysis : null,
            kamera: {
              id: camView.id,
              nama: camView.name,
              jarakM: found.distanceM,
              provider: camView.provider || null,
              license: camView.license || null,
            },
            analisis: sameAsPrimary ? visualResult.analisis : null,
          };
        }
      } catch {
        altVisual = null;
      }

      const altScore = calculateRouteScore({
        durationS: alt.durationS,
        trafficData: altTraffic || trafficData,
        aqiData: altAir ? { pm2_5: altAir.pm2_5, us_aqi: altAir.us_aqi } : aqiData || {},
        visualAnalysis: altVisual?.analysis || null,
        weights,
      });

      return {
        distanceM: alt.distanceM,
        durationS: alt.durationS,
        summary: alt.summary || `Jalur Alternatif ${idx + 2}`,
        geometry: alt.geometry,
        steps: Array.isArray(alt.steps) ? alt.steps : [],
        totalScore: altScore.totalScore,
        label: altScore.label,
        color: altScore.color,
        score: altScore,
        air: altAir
          ? {
            ...altAir,
            titikTerburuk: altAir.titikTerburuk || { time: altAir.time },
          }
          : null,
        visual: altVisual,
      };
    })
  );

  if (!agentFinalThought || !agentFinalThought.trim()) {
    agentFinalThought = buildFallbackAgentSummary({
      primaryRoute,
      primaryScore,
      trafficData,
      airSummary,
      visualResult,
      alternatives,
    });
  }

  const totalDurationMs = Date.now() - startTime;

  const resultPayload = {
    ok: true,
    route: {
      distanceM: primaryRoute.distanceM,
      durationS: primaryRoute.durationS,
      summary: primaryRoute.summary || 'Jalur Utama',
      geometry: primaryRoute.geometry,
      steps: Array.isArray(primaryRoute.steps) ? primaryRoute.steps : [],
    },
    score: primaryScore,
    air: airSummary
      ? {
        ...airSummary,
        titikTerburuk: airSummary.titikTerburuk || { time: airSummary.time },
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
