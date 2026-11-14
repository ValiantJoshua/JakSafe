/*
   Mesin Fisika Pegas & Gerak Fluida ala Apple (WWDC 2018 — Designing Fluid Interfaces).

   Mengimplementasikan:
   1. Pegas berbasis Damping Ratio (1.0 = critically damped, ~0.8 = momentum bounce)
      dan Response (waktu respons dalam detik), yang secara alami dapat diinterupsi
      (interruptible) dan meneruskan kecepatan jari (velocity handoff).
   2. Proyeksi momentum eksponensial Apple: project(initialVelocity, decelerationRate).
   3. Resistensi batas karet (rubber-banding): rubberband(overshoot, dimension, constant).
*/

/**
 * Proyeksi posisi berhenti berdasarkan kecepatan lepas jari (px/s).
 * Rumus eksak dari sesi WWDC Designing Fluid Interfaces.
 *
 * @param {number} initialVelocity  Kecepatan dalam px/detik
 * @param {number} [decelerationRate=0.998]  0.998 untuk gulir normal, 0.99 untuk sheet responsif
 * @returns {number} Jarak proyeksi dalam piksel
 */
export function project(initialVelocity, decelerationRate = 0.998) {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Resistensi progresif saat pengguna menarik melewati batas maksimum/minimum.
 *
 * @param {number} overshoot  Jarak melewati batas (px)
 * @param {number} dimension  Dimensi kontainer referensi (px)
 * @param {number} [constant=0.55]  Konstanta resistensi Apple (0.55)
 * @returns {number} Jarak teredam (px)
 */
export function rubberband(overshoot, dimension, constant = 0.55) {
  if (dimension <= 0 || overshoot === 0) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const abs = Math.abs(overshoot);
  return sign * ((abs * dimension * constant) / (dimension + constant * abs));
}

/**
 * Menjalankan animasi pegas berbasis fisika yang dapat diinterupsi kapan saja.
 *
 * @param {object} opts
 * @param {number} opts.from            Nilai layar saat ini (presentation value)
 * @param {number} opts.to              Nilai target
 * @param {number} [opts.velocity=0]    Kecepatan awal dalam satuan/detik
 * @param {number} [opts.damping=1.0]   Rasio redaman (1.0 = tanpa pantulan, 0.8 = sedikit membal)
 * @param {number} [opts.response=0.35] Waktu respons pegas dalam detik
 * @param {number} [opts.precision=0.5] Ambang berhenti
 * @param {(value: number, velocity: number) => void} opts.onUpdate
 * @param {() => void} [opts.onComplete]
 * @returns {{ stop: () => { value: number, velocity: number }, getState: () => { value: number, velocity: number } }}
 */
export function animateSpring({
  from,
  to,
  velocity = 0,
  damping = 1.0,
  response = 0.35,
  precision = 0.5,
  onUpdate,
  onComplete,
}) {
  const kurangiGerak =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let current = Number(from) || 0;
  let vel = Number(velocity) || 0;
  const target = Number(to) || 0;

  if (kurangiGerak || Math.abs(target - current) <= precision && Math.abs(vel) <= precision) {
    current = target;
    vel = 0;
    onUpdate?.(current, 0);
    onComplete?.();
    return {
      stop: () => ({ value: current, velocity: 0 }),
      getState: () => ({ value: current, velocity: 0 }),
    };
  }

  const safeResponse = Math.max(0.08, Number(response) || 0.35);
  const safeDamping = Math.max(0.1, Number(damping) || 1.0);
  const omega = (2 * Math.PI) / safeResponse;
  const stiffness = omega * omega;
  const dampingCoeff = 2 * safeDamping * omega;

  let rafId = null;
  let stopped = false;
  let lastTime = performance.now();

  const step = (now) => {
    if (stopped) return;
    // Batasi dt maksimum 32ms agar tab tidak melompat saat kembali dari background
    const dt = Math.min(0.032, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    // Integrasi semi-implicit Euler 2 sub-langkah untuk stabilitas pegas frekuensi tinggi
    const subSteps = 2;
    const subDt = dt / subSteps;
    for (let i = 0; i < subSteps; i += 1) {
      const displacement = current - target;
      const springForce = -stiffness * displacement;
      const dampingForce = -dampingCoeff * vel;
      const acceleration = springForce + dampingForce;
      vel += acceleration * subDt;
      current += vel * subDt;
    }

    if (Math.abs(target - current) <= precision && Math.abs(vel) <= precision * 6) {
      current = target;
      vel = 0;
      stopped = true;
      onUpdate?.(current, 0);
      onComplete?.();
      return;
    }

    onUpdate?.(current, vel);
    rafId = requestAnimationFrame(step);
  };

  rafId = requestAnimationFrame(step);

  return {
    stop() {
      stopped = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      return { value: current, velocity: vel };
    },
    getState() {
      return { value: current, velocity: vel };
    },
  };
}
