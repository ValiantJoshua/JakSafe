/*
   Layar pencarian di panel kiri — Desain bersih ala aplikasi navigasi modern.
*/

import { ikon } from '../icons.js';
import { routeThumb } from '../brand.js';
import { PROFILES } from '../../config/constants.js';
import { findPlaceById } from '../../config/jakartaPlaces.js';

const PINTASAN_RUTE = [
  { asal: 'sudirman', tujuan: 'monas', varian: 'pagi' },
  { asal: 'kuningan', tujuan: 'kelapa-gading', varian: 'siang' },
  { asal: 'blokm', tujuan: 'grogol', varian: 'sore' },
  { asal: 'cawang', tujuan: 'thamrin', varian: 'pagi' },
];

function kartuPintasan({ asal, tujuan, varian }) {
  const a = findPlaceById(asal);
  const b = findPlaceById(tujuan);
  if (!a || !b) return '';
  return `
<button type="button" class="routecard press" data-pintasan-asal="${asal}" data-pintasan-tujuan="${tujuan}">
  <span class="routecard__thumb">${routeThumb(varian)}</span>
  <span class="routecard__body">
    <span class="routecard__name">${a.nama}</span>
    <span class="routecard__to">${ikon('i-arrow-r', 12)} ${b.nama}</span>
  </span>
</button>`;
}

function barisProfil() {
  return PROFILES.map((p, i) => `
    <button type="button" class="chip press" data-profile="${p.key}" aria-pressed="${i === 0}">
      ${ikon(p.ikon, 17)} ${p.nama}
    </button>`).join('');
}

export function templateSearchView() {
  return `
<section id="viewSearch" class="slide-in">

  <div class="greet" id="greetBox">
    <h1 class="search__title">Mau ke mana <em>hari ini?</em></h1>
    <p class="search__sub">Navigasi Jakarta dengan pertimbangan kualitas udara, lalu lintas, dan pantauan CCTV.</p>
  </div>

  <div class="fieldgroup" style="margin-bottom:var(--s4)">
    <div class="field">
      <span class="field__label">Titik Awal</span>
      <span class="field__pin field__pin--origin"></span>
      <input class="field__input" id="inpOrigin" type="text" role="combobox"
             aria-expanded="false" aria-controls="saranOrigin"
             placeholder="Pilih lokasi awal" autocomplete="off">
      <div class="saran" id="saranOrigin" role="listbox" hidden></div>
    </div>

    <button type="button" class="fieldgroup__swap press" id="btnSwap"
            title="Tukar awal dan tujuan" aria-label="Tukar titik awal dan tujuan">
      ${ikon('i-swap', 16)}
    </button>

    <div class="field">
      <span class="field__label">Tujuan</span>
      <span class="field__pin field__pin--dest"></span>
      <input class="field__input" id="inpDest" type="text" role="combobox"
             aria-expanded="false" aria-controls="saranDest"
             placeholder="Mau ke mana?" autocomplete="off">
      <div class="saran" id="saranDest" role="listbox" hidden></div>
    </div>
  </div>

  <p class="sectlabel">Moda Perjalanan</p>
  <div class="chiprow" role="group" aria-label="Pilih cara perjalanan" style="margin-bottom:var(--s4)">
    ${barisProfil()}
  </div>

  <button type="button" class="btn btn--primary btn--block btn--lg sheen" id="btnSearch" style="margin-bottom:var(--s5)">
    Cari Rute Aman
    <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
  </button>

  <div id="savedBox" hidden style="margin-bottom:var(--s5)">
    <p class="sectlabel">${ikon('i-star', 14)} Rute Tersimpan</p>
    <div class="savedlist" id="savedList"></div>
  </div>

  <p class="sectlabel">Pintasan Koridor</p>
  <div class="routecards scroll-x" id="routeCards" style="margin-bottom:var(--s4)">
    ${PINTASAN_RUTE.map(kartuPintasan).join('')}
  </div>

  <div class="promo" id="promoBox">
    <span class="promo__icon">${ikon('i-shield', 18)}</span>
    <span class="promo__text">
      <strong>Profil Kesehatan & Simpan Rute</strong>
      Masuk untuk menyimpan rute favorit dan memprioritaskan bobot udara bersih.
    </span>
    <button type="button" class="promo__btn press" id="btnPromoLogin">
      Masuk ${ikon('i-arrow-r', 14)}
    </button>
  </div>
</section>`;
}
