/*
   Pengendali pergantian layar dengan pegas critically-damped yang dapat
   diinterupsi kapan saja (Apple Designing Fluid Interfaces §3, §4, §14).

   Panel kiri punya empat layar yang saling menggantikan: pencarian,
   proses, hasil, dan galat. Saat layar berganti, animasi dimulai dari
   nilai aktual di layar (presentation value) dan tidak pernah mengunci
   input pengguna. Bila prefers-reduced-motion: reduce aktif, pergantian
   memakai cross-fade opasitas lembut tanpa pergeseran vertikal.
*/

import { $, show } from '../../utils/dom.js';
import { animateSpring } from '../../utils/spring.js';
import { subscribe } from '../../state/appState.js';

/** Peta nama keadaan tampilan ke id elemen layarnya. */
const LAYAR = {
  siap: '#viewSearch',
  memproses: '#viewProgress',
  hasil: '#viewResult',
  galat: '#viewError',
};

let springLayar = null;
let offsetLayarSaatIni = 0;

/**
 * Menampilkan satu layar pada panel kiri dan menyembunyikan sisanya
 * dengan transisi pegas yang dapat diinterupsi.
 * @param {'siap'|'memproses'|'hasil'|'galat'} nama
 */
function gantiLayar(nama) {
  let elemenAktif = null;
  for (const [kunci, pemilih] of Object.entries(LAYAR)) {
    const el = $(pemilih);
    const tampil = kunci === nama;
    show(el, tampil);
    if (tampil) elemenAktif = el;
  }

  // Pastikan panggung peta beserta kendali HUD selalu tampil
  show($('#mapHolder'), true);
  show($('#mapCtrlWrap'), true);
  show($('#legendWrap'), true);

  // Panel digulirkan ke atas setiap berganti layar.
  const panel = $('#panelBody');
  if (panel) panel.scrollTop = 0;

  if (!elemenAktif) return;

  let velAwal = 0;
  if (springLayar) {
    const prev = springLayar.stop();
    velAwal = prev.velocity;
    springLayar = null;
  }

  const kurangiGerak = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (kurangiGerak) {
    elemenAktif.style.transform = '';
    elemenAktif.style.opacity = '0';
    requestAnimationFrame(() => {
      elemenAktif.style.transition = 'opacity 160ms ease-out';
      elemenAktif.style.opacity = '1';
    });
    return;
  }

  offsetLayarSaatIni = 8;
  elemenAktif.style.opacity = '0.2';
  elemenAktif.style.transform = `translate3d(0, ${offsetLayarSaatIni}px, 0)`;

  springLayar = animateSpring({
    from: offsetLayarSaatIni,
    to: 0,
    velocity: velAwal,
    damping: 1.0,
    response: 0.28,
    precision: 0.2,
    onUpdate(val) {
      offsetLayarSaatIni = val;
      const progress = Math.max(0, Math.min(1, 1 - val / 8));
      elemenAktif.style.opacity = (0.2 + 0.8 * progress).toFixed(3);
      elemenAktif.style.transform = `translate3d(0, ${val.toFixed(2)}px, 0)`;
    },
    onComplete() {
      springLayar = null;
      elemenAktif.style.opacity = '';
      elemenAktif.style.transform = '';
    },
  });
}

/**
 * Memasang langganan pergantian layar. Dipanggil sekali dari main.js.
 */
export function pasangPengendaliTampilan() {
  subscribe((keadaan, berubah) => {
    if (berubah.includes('tampilan')) gantiLayar(keadaan.tampilan);
  });

  // Dijalankan sekali di awal supaya layar pertama sesuai keadaan awal.
  gantiLayar('siap');
}
