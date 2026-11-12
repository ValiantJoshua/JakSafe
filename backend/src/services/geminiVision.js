// Gemini Vision service: analyses a CCTV frame for road/flood conditions.
// Direct Gemini SDK call from Node (no separate Python/FastAPI service needed).
// Output is forced to a JSON schema so the scoring engine can consume it safely.

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { cctvVisionCache, hashKey } from './cacheService.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-latest'];
const TIMEOUT_MS = 20_000;
const CONFIDENCE_FLOOR = 0.4; // guide §13: below this -> downgrade to "hati_hati"
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class VisionError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const SYSTEM_INSTRUCTION = [
  'Anda adalah analis infrastruktur jalan untuk sistem navigasi jakSafe.',
  'Tugas: menilai kondisi jalan dari satu gambar CCTV lalu lintas Jakarta.',
  'Nilai HANYA kondisi fisik: kepadatan lalu lintas, genangan air/banjir, dan kualitas visibilitas kamera.',
  'ATURAN ETIKA (WAJIB): jangan mengidentifikasi atau menjelaskan wajah, plat nomor, atau identitas individu.',
  'Jangan menebak. Jika gambar gelap, buram, bukan jalan, atau tidak jelas, turunkan confidence dan jelaskan di "alasan".',
  'Genangan air = air menutupi permukaan jalan (pantulan luas, kendaraan terendam sebagian). Basah akibat hujan tanpa genangan bukan genangan.',
].join(' ');

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    kondisi_jalan: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['lancar', 'padat', 'macet', 'tidak_terlihat'],
      description: 'Kepadatan lalu lintas pada gambar',
    },
    genangan_air: { type: SchemaType.BOOLEAN, description: 'Ada genangan/banjir di permukaan jalan' },
    tingkat_genangan: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['tidak_ada', 'rendah', 'sedang', 'tinggi'],
    },
    visibilitas_kamera: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['jelas', 'hujan', 'gelap', 'buram', 'terhalang'],
    },
    confidence: { type: SchemaType.NUMBER, description: 'Keyakinan analisis, 0.0 - 1.0' },
    alasan: { type: SchemaType.STRING, description: 'Penjelasan singkat (1-2 kalimat) berbasis apa yang terlihat' },
  },
  required: ['kondisi_jalan', 'genangan_air', 'tingkat_genangan', 'visibilitas_kamera', 'confidence', 'alasan'],
};

let client = null;
function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new VisionError('GEMINI_API_KEY is not configured', 503);
  if (!client) client = new GoogleGenerativeAI(key);
  return client;
}

function clamp01(n) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Derive the recommendation locally so it is consistent with the guardrails. */
export function deriveRecommendation(a) {
  if (a.confidence < CONFIDENCE_FLOOR) return 'hati_hati';
  if (a.genangan_air && (a.tingkat_genangan === 'sedang' || a.tingkat_genangan === 'tinggi')) return 'hindari';
  if (a.kondisi_jalan === 'macet') return 'hindari';
  if (a.genangan_air || a.kondisi_jalan === 'padat') return 'hati_hati';
  return 'aman';
}

/** Normalise/validate model output and apply guardrails. Exported for unit tests. */
export function normalizeAnalysis(raw) {
  const a = {
    kondisi_jalan: String(raw?.kondisi_jalan || 'tidak_terlihat'),
    genangan_air: Boolean(raw?.genangan_air),
    tingkat_genangan: String(raw?.tingkat_genangan || 'tidak_ada'),
    visibilitas_kamera: String(raw?.visibilitas_kamera || 'jelas'),
    confidence: clamp01(Number(raw?.confidence)),
    alasan: String(raw?.alasan || '').slice(0, 400),
  };
  if (!a.genangan_air) a.tingkat_genangan = 'tidak_ada';
  if (a.genangan_air && a.tingkat_genangan === 'tidak_ada') a.tingkat_genangan = 'rendah';
  const lowConfidence = a.confidence < CONFIDENCE_FLOOR;
  a.rekomendasi = deriveRecommendation(a);
  if (lowConfidence) a.catatan = 'Confidence rendah (<0.4): hasil di-downgrade ke hati_hati.';
  return a;
}

/**
 * Analyse one image with automatic model fallback on 503 / 429 / 404,
 * and high-performance in-memory caching (TTL 90s).
 * @param {object} opts
 * @param {string} opts.base64    image bytes, base64 (no data: prefix)
 * @param {string} [opts.mimeType]
 * @param {string} [opts.context] e.g. camera name / location
 * @param {string} [opts.cacheKey] optional explicit key (e.g. cctv:id)
 * @param {boolean} [opts.skipCache=false]
 */
export async function analyzeRoadImage({ base64, mimeType = 'image/jpeg', context = '', cacheKey = null, skipCache = false }) {
  if (typeof base64 !== 'string' || !base64.length) throw new VisionError('image base64 is required', 400);
  const mime = String(mimeType).toLowerCase();
  if (!ALLOWED_MIME.has(mime)) throw new VisionError(`unsupported image type: ${mime}`, 400);
  if (Buffer.byteLength(base64, 'base64') > MAX_IMAGE_BYTES) throw new VisionError('image too large', 413);

  const effectiveKey = cacheKey || `img:${hashKey(base64.slice(0, 1024) + '_' + base64.length + '_' + context)}`;

  if (!skipCache) {
    const cached = cctvVisionCache.get(effectiveKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  const primaryModel = process.env.GEMINI_VISION_MODEL || DEFAULT_MODEL;
  const candidateModels = [...new Set([primaryModel, ...FALLBACK_MODELS])];
  const prompt = `Analisis gambar CCTV ini. Lokasi/konteks: ${String(context).slice(0, 200) || 'tidak diketahui'}.`;

  let text = null;
  let lastError = null;

  for (const modelName of candidateModels) {
    try {
      const model = getClient().getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const result = await model.generateContent(
        [prompt, { inlineData: { data: base64, mimeType: mime } }],
        { timeout: TIMEOUT_MS },
      );
      text = result.response.text();
      break;
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || '');
      if (/API key|API_KEY|permission|403|401/i.test(msg)) {
        throw new VisionError('Gemini API key rejected', 503);
      }
      // Jika 503 (High Demand), 429, atau 404, lanjutkan ke model cadangan berikutnya
    }
  }

  if (!text) {
    const msg = String(lastError?.message || '');
    if (/429|quota|rate/i.test(msg)) throw new VisionError('Gemini quota/rate limit reached', 429);
    throw new VisionError('Gemini vision request failed');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VisionError('Gemini returned invalid JSON');
  }
  const normalized = normalizeAnalysis(parsed);
  cctvVisionCache.set(effectiveKey, normalized);
  return normalized;
}
