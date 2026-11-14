/*
   Efek miring tiga dimensi mengikuti kursor dengan dua pegas X/Y independen
   (WWDC Designing Fluid Interfaces §3 & §4).

   Dipasang pada kartu skor dan kartu kualitas udara. Sudut maksimalnya
   dibatasi tujuh derajat agar teks tetap tajam dan terbaca.
   Saat kursor bergerak atau meninggalkan kartu, rotasi X dan Y kembali ke 0deg
   menggunakan pegas critically-damped (damping 1.0, response 0.32s) dari nilai
   aktual di layar (presentation value) sehingga tidak pernah patah (hard-cut).
*/

import { animateSpring } from '../utils/spring.js';

/** Sudut maksimal dalam derajat. */
const SUDUT_MAKS = 7;

/**
 * Memasang efek miring pada seluruh elemen berkelas tilt.
 * Dipanggil sekali dari main.js, setelah kerangka tampilan terpasang.
 */
export function pasangEfekMiring() {
  const punyaTetikus = window.matchMedia('(pointer: fine)').matches;
  const kurangiGerak = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!punyaTetikus || kurangiGerak) return;

  for (const kartu of document.querySelectorAll('.tilt')) {
    const lapisan = kartu.querySelector('.tilt__layer');
    if (!lapisan) continue;

    let rotX = 0;
    let rotY = 0;
    let velX = 0;
    let velY = 0;
    let springX = null;
    let springY = null;

    const terapkanTransform = () => {
      if (Math.abs(rotX) < 0.02 && Math.abs(rotY) < 0.02 && !springX && !springY) {
        lapisan.style.transform = '';
      } else {
        lapisan.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
      }
    };

    kartu.addEventListener('pointermove', (e) => {
      if (springX) {
        const sx = springX.stop();
        rotX = sx.value;
        velX = sx.velocity;
        springX = null;
      }
      if (springY) {
        const sy = springY.stop();
        rotY = sy.value;
        velY = sy.velocity;
        springY = null;
      }

      const kotak = kartu.getBoundingClientRect();
      const x = (e.clientX - kotak.left) / kotak.width - 0.5;
      const y = (e.clientY - kotak.top) / kotak.height - 0.5;
      const targetX = -y * SUDUT_MAKS;
      const targetY = x * SUDUT_MAKS;

      springX = animateSpring({
        from: rotX,
        to: targetX,
        velocity: velX,
        damping: 1.0,
        response: 0.18,
        precision: 0.03,
        onUpdate(v, vel) {
          rotX = v;
          velX = vel;
          terapkanTransform();
        },
        onComplete() {
          springX = null;
        },
      });

      springY = animateSpring({
        from: rotY,
        to: targetY,
        velocity: velY,
        damping: 1.0,
        response: 0.18,
        precision: 0.03,
        onUpdate(v, vel) {
          rotY = v;
          velY = vel;
          terapkanTransform();
        },
        onComplete() {
          springY = null;
        },
      });
    });

    kartu.addEventListener('pointerleave', () => {
      if (springX) {
        const sx = springX.stop();
        rotX = sx.value;
        velX = sx.velocity;
      }
      if (springY) {
        const sy = springY.stop();
        rotY = sy.value;
        velY = sy.velocity;
      }

      springX = animateSpring({
        from: rotX,
        to: 0,
        velocity: velX,
        damping: 1.0,
        response: 0.34,
        precision: 0.02,
        onUpdate(v, vel) {
          rotX = v;
          velX = vel;
          terapkanTransform();
        },
        onComplete() {
          springX = null;
          terapkanTransform();
        },
      });

      springY = animateSpring({
        from: rotY,
        to: 0,
        velocity: velY,
        damping: 1.0,
        response: 0.34,
        precision: 0.02,
        onUpdate(v, vel) {
          rotY = v;
          velY = vel;
          terapkanTransform();
        },
        onComplete() {
          springY = null;
          terapkanTransform();
        },
      });
    });
  }
}
