/*
   Pengendali layar proses (Shimmer Skeleton + Live Status Capsule).

   Mengelola progres tahap pada kapsul status translusen dan 5 segmented pips.
   Karena panggilan utama /api/navigate berjalan sebagai satu request atomik ke
   backend AI agent, pengendali menjalankan siklus status progresif hingga
   tahap ke-5 (tanpa mengulang/loop) agar antarmuka terasa hidup, dan langsung
   berhenti atau mengikuti tahap nyata jika fallback pratinjau berjalan.
*/

import { $, $$, setText } from '../../utils/dom.js';

const STAGE_MESSAGES = [
  { id: 'rute', label: 'Calculating road corridors…' },
  { id: 'lalulintas', label: 'Checking live traffic & flooding…' },
  { id: 'udara', label: 'Sampling route air quality (AQI)…' },
  { id: 'cctv', label: 'Scanning nearby CCTV cameras…' },
  { id: 'skor', label: 'Scoring safety & AI recommendation…' },
];

const STAGE_INDEX = Object.fromEntries(STAGE_MESSAGES.map((s, idx) => [s.id, idx]));

let timerSiklus = null;
let timerCrossfade = null;
let indeksAktif = 0;

function hentikanSiklus() {
  if (timerSiklus) {
    clearInterval(timerSiklus);
    timerSiklus = null;
  }
  if (timerCrossfade) {
    clearTimeout(timerCrossfade);
    timerCrossfade = null;
  }
}

/** Memperbarui teks status dengan transisi opacity lembut (§15/§16). */
function setStatusTeks(teks, immediate = false) {
  const el = $('#progressSub');
  if (!el) return;
  if (immediate || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    el.classList.remove('is-swapping');
    setText(el, teks);
    return;
  }
  el.classList.add('is-swapping');
  if (timerCrossfade) clearTimeout(timerCrossfade);
  timerCrossfade = setTimeout(() => {
    setText(el, teks);
    el.classList.remove('is-swapping');
  }, 130);
}

/** Menyorot pip aktif & pip selesai sesuai indeks 0..4. */
function terapkanPip(index, allDone = false) {
  const pipsWrap = $('#progressPips');
  if (pipsWrap) {
    pipsWrap.setAttribute('aria-valuenow', String(allDone ? STAGE_MESSAGES.length : index + 1));
  }
  for (const pip of $$('#progressPips .progresspip')) {
    const i = Number(pip.dataset.pip);
    pip.classList.toggle('is-done', allDone || i < index);
    pip.classList.toggle('is-active', !allDone && i === index);
  }
}

/** Mengembalikan layar proses ke kondisi awal dan memulai siklus status. */
export function resetTahap() {
  hentikanSiklus();
  indeksAktif = 0;
  terapkanPip(0, false);
  setStatusTeks(STAGE_MESSAGES[0].label, true);

  timerSiklus = setInterval(() => {
    const view = $('#viewProgress');
    if (!view || view.hidden) {
      hentikanSiklus();
      return;
    }
    if (indeksAktif >= STAGE_MESSAGES.length - 1) {
      hentikanSiklus();
      return;
    }
    indeksAktif += 1;
    terapkanPip(indeksAktif, false);
    setStatusTeks(STAGE_MESSAGES[indeksAktif].label, false);
  }, 1500);
}

/**
 * Menandai tahap spesifik (dipakai ketika fallback rangkaiPratinjau() aktif).
 * Menghentikan timer otomatis agar status mencerminkan tahap nyata 1:1.
 *
 * @param {string} idTahap
 */
export function tandaiTahapBerjalan(idTahap) {
  if (timerSiklus) {
    clearInterval(timerSiklus);
    timerSiklus = null;
  }
  const idx = STAGE_INDEX[idTahap];
  if (!Number.isInteger(idx)) return;
  indeksAktif = idx;
  terapkanPip(idx, false);
  setStatusTeks(STAGE_MESSAGES[idx].label, false);
}

/** Menutup seluruh tahap dan membersihkan timer saat selesai, batal, atau galat. */
export function tutupSemuaTahap() {
  hentikanSiklus();
  terapkanPip(STAGE_MESSAGES.length - 1, true);
}

/** Dipanggil saat respons agen diterima. */
export function modeAgen() {
  hentikanSiklus();
  terapkanPip(STAGE_MESSAGES.length - 1, true);
  setStatusTeks('Route analysis ready', true);
}
