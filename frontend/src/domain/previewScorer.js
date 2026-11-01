/*
   BERKAS SEMENTARA. DIHAPUS SETELAH POST /api/navigate SELESAI DIBUAT.

   Apa isinya.
   Salinan rumus penilaian milik backend, yaitu
   backend/src/scoring/routeScorer.js, dengan nama fungsi dan nilai ambang
   yang sama persis.

   Kenapa sampai perlu ada salinan di frontend.
   Mesin penilaian sudah selesai di backend, tetapi endpoint yang
   memanggilnya, POST /api/navigate, belum dibuat. Yang sudah bisa dipakai
   baru endpoint data mentah, yaitu /api/route, /api/aqi, /api/cctv, dan
   /api/tomtom. Tanpa berkas ini, frontend bisa menampilkan jarak, waktu,
   angka PM2.5, dan gambar kamera, tetapi tidak bisa menampilkan satu pun
   skor atau label, sehingga seluruh kartu hasil kosong dan tampilan tidak
   bisa diuji maupun didemokan.

   Bagaimana supaya tidak membingungkan saat dipakai.
   Setiap hasil yang dihitung di sini diberi penanda sumber Pratinjau, dan
   penanda itu muncul sebagai lencana di kartu skor. Jadi tidak pernah ada
   keadaan di mana pengguna atau penguji mengira angka pratinjau adalah
   keputusan agen.

   Cara menghapusnya nanti, tiga langkah saja.
   1. Pastikan POST /api/navigate sudah mengembalikan objek score.
   2. Hapus berkas ini.
   3. Hapus cabang pratinjau pada src/domain/navigationService.js. Tidak
      ada berkas tampilan yang perlu disentuh, karena tampilan hanya
      membaca bentuk objek, bukan asalnya.

   Aturan pemeliharaan selama berkas ini masih ada.
   Jangan memperbaiki atau menyetel rumus di sini. Kalau ada rumus yang
   dirasa salah, perbaikannya dilakukan di backend lebih dulu, baru
   disalin ke sini, supaya dua sisi tidak pernah berbeda hasil.
*/

/** Bobot bawaan. Sama dengan DEFAULT_WEIGHTS di backend. */
export const DEFAULT_WEIGHTS = {
  time: 0.40,
  aqi: 0.35,
  condition: 0.25,
};

/** Ambang label. Sama dengan SCORE_LABELS di backend. */
export const SCORE_LABELS = {
  SAFE: { min: 0, max: 29, label: 'AMAN', color: '#22c55e' },
  CAUTION: { min: 30, max: 59, label: 'HATI-HATI', color: '#f59e0b' },
  AVOID: { min: 60, max: 100, label: 'HINDARI', color: '#ef4444' },
};

/**
 * Menormalkan waktu tempuh menjadi nilai nol sampai seratus.
 * Lima menit atau kurang bernilai nol, enam puluh menit atau lebih
 * bernilai seratus, di antaranya dibuat linear.
 *
 * @param {number} durationS
 * @returns {number}
 */
export function normalizeTimeScore(durationS) {
  if (!Number.isFinite(durationS) || durationS <= 0) return 50;
  const durationMin = durationS / 60;
  if (durationMin <= 5) return 0;
  if (durationMin >= 60) return 100;
  return Math.round(((durationMin - 5) / (60 - 5)) * 100);
}

/**
 * Menormalkan pencemaran udara menjadi nilai nol sampai seratus.
 * PM2.5 dipakai lebih dulu karena paling langsung berhubungan dengan
 * kesehatan pernapasan. Indeks us_aqi hanya dipakai kalau PM2.5 kosong.
 *
 * @param {{pm2_5?:number, us_aqi?:number}} opsi
 * @returns {number}
 */
export function normalizeAqiScore({ pm2_5: pm25, us_aqi: usAqi } = {}) {
  if (Number.isFinite(pm25)) {
    if (pm25 <= 12) return 0;
    if (pm25 >= 150) return 100;
    return Math.round(((pm25 - 12) / (150 - 12)) * 100);
  }
  if (Number.isFinite(usAqi)) {
    if (usAqi <= 50) return 0;
    if (usAqi >= 200) return 100;
    return Math.round(((usAqi - 50) / (200 - 50)) * 100);
  }
  return 50;
}

/**
 * Menormalkan kondisi jalan menjadi nilai nol sampai seratus.
 *
 * Urutan pertimbangannya sama dengan di backend. Jalan tertutup langsung
 * seratus. Genangan menyumbang bobot terbesar. Kemacetan menambah di
 * atasnya. Kalau tidak ada data sama sekali dipakai nilai netral dua puluh.
 * Terakhir, keyakinan analisis citra di bawah nol koma empat menaikkan
 * nilai minimal menjadi empat puluh lima, karena bukti yang meragukan
 * tidak boleh dibaca sebagai jalan yang aman.
 *
 * @param {object} [analysis]     hasil analisis citra kamera
 * @param {object} [trafficData]  data arus dari TomTom
 * @returns {number}
 */
export function normalizeConditionScore(analysis, trafficData = null) {
  if (trafficData?.roadClosure) return 100;

  let floodScore = 0;
  if (analysis?.genangan_air) {
    const level = String(analysis.tingkat_genangan || '').toLowerCase();
    if (level === 'rendah' || level === 'ringan') floodScore = 35;
    else if (level === 'sedang') floodScore = 65;
    else if (level === 'berat' || level === 'tinggi') floodScore = 95;
    else floodScore = 50;
  }

  let trafficScore = 0;
  if (trafficData && Number.isFinite(trafficData.delayPercent)) {
    if (trafficData.delayPercent >= 80) trafficScore = 30;
    else if (trafficData.delayPercent >= 30) trafficScore = 15;
    else trafficScore = 0;
  } else if (analysis?.kondisi_jalan) {
    const traffic = String(analysis.kondisi_jalan).toLowerCase();
    if (traffic === 'padat' || traffic === 'merayap') trafficScore = 15;
    else if (traffic === 'macet' || traffic === 'macet_total') trafficScore = 30;
  }

  let totalCondition = floodScore + trafficScore;
  if (!analysis && !trafficData) totalCondition = 20;

  if (analysis && Number.isFinite(analysis.confidence) && analysis.confidence < 0.4) {
    totalCondition = Math.max(totalCondition, 45);
  }

  return Math.min(100, Math.max(0, Math.round(totalCondition)));
}

/**
 * Menentukan label dan warna dari skor akhir.
 *
 * @param {number} totalScore
 * @returns {{label:string, color:string, min:number, max:number}}
 */
export function getScoreCategory(totalScore) {
  if (totalScore <= SCORE_LABELS.SAFE.max) return SCORE_LABELS.SAFE;
  if (totalScore <= SCORE_LABELS.CAUTION.max) return SCORE_LABELS.CAUTION;
  return SCORE_LABELS.AVOID;
}

/**
 * Menghitung skor akhir sebuah rute.
 *
 * Bentuk objek yang dikembalikan dibuat identik dengan keluaran
 * calculateRouteScore di backend, termasuk nama setiap kunci di dalam
 * breakdown. Inilah yang membuat tampilan tidak perlu diubah sedikit pun
 * ketika sumber hasil nanti berpindah ke agen.
 *
 * @param {object} params
 * @param {number} params.durationS
 * @param {object} [params.trafficData]
 * @param {object} [params.aqiData]
 * @param {object} [params.visualAnalysis]
 * @param {object} [params.weights]
 * @returns {object}
 */
export function calculateRouteScore({
  durationS,
  trafficData = null,
  aqiData = {},
  visualAnalysis = null,
  weights = DEFAULT_WEIGHTS,
}) {
  // Bobot dinormalkan supaya jumlahnya tepat satu. Ini penting karena
  // pengguna yang menyalakan profil kesehatan menaikkan bobot polusi,
  // sehingga jumlah mentahnya tidak lagi satu.
  const rawW = { ...DEFAULT_WEIGHTS, ...weights };
  const sumW = (rawW.time || 0) + (rawW.aqi || 0) + (rawW.condition || 0);
  const w = {
    time: (rawW.time || 0) / sumW,
    aqi: (rawW.aqi || 0) / sumW,
    condition: (rawW.condition || 0) / sumW,
  };

  // Waktu dasar dari OSRM dikalibrasi dengan keterlambatan nyata TomTom.
  let effectiveDurationS = durationS;
  let delayPercent = 0;
  if (trafficData && Number.isFinite(trafficData.delayPercent) && trafficData.delayPercent > 0) {
    delayPercent = trafficData.delayPercent;
    effectiveDurationS = Math.round(durationS * (1 + delayPercent / 100));
  }
  if (trafficData?.roadClosure) {
    effectiveDurationS = Math.max(effectiveDurationS, 3600);
  }

  const timeScore = normalizeTimeScore(effectiveDurationS);
  const aqiScore = normalizeAqiScore(aqiData);
  const conditionScore = normalizeConditionScore(visualAnalysis, trafficData);

  const totalScore = Math.round(
    (timeScore * w.time) + (aqiScore * w.aqi) + (conditionScore * w.condition),
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
          ? (trafficData.delayPercent >= 80 ? 'macet_berat'
            : trafficData.delayPercent >= 30 ? 'padat' : 'lancar')
          : (visualAnalysis?.kondisi_jalan || 'normal'),
      },
    },
  };
}
