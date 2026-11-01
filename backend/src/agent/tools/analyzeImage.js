// Tool 4: analyze_image — Gemini Vision analysis of a CCTV frame.
// Gemini function-calling declaration + executor. Takes the output of Tool 3
// (get_cctv_snapshot) and returns structured road/flood conditions for the scoring engine.

import { analyzeRoadImage } from '../../services/geminiVision.js';

export const analyzeImageDeclaration = {
  name: 'analyze_image',
  description:
    'Analyze a CCTV snapshot (base64, from get_cctv_snapshot) for traffic density and flooding. '
    + 'Returns kondisi_jalan, genangan_air, tingkat_genangan, visibilitas_kamera, confidence (0-1) and rekomendasi. '
    + 'Never identifies people or license plates. If confidence < 0.4 the result is already downgraded to hati_hati.',
  parameters: {
    type: 'OBJECT',
    properties: {
      image_base64: { type: 'STRING', description: 'Base64 image from get_cctv_snapshot (image.base64)' },
      mime_type: { type: 'STRING', description: 'image/jpeg (default), image/png or image/webp' },
      context: { type: 'STRING', description: 'Camera name / location for context' },
    },
    required: ['image_base64'],
  },
};

/** Execute Tool 4. Never throws — returns { ok:false, error } so the agent can reason about it. */
export async function analyzeImage({ image_base64: imageBase64, mime_type: mimeType, context } = {}) {
  try {
    const analysis = await analyzeRoadImage({ base64: imageBase64, mimeType: mimeType || 'image/jpeg', context });
    return { ok: true, analysis };
  } catch (e) {
    return { ok: false, error: e.message || 'vision analysis failed' };
  }
}

