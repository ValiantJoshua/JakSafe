/*
   Layar pencarian di panel kiri — Desain bersih ala aplikasi navigasi modern.
*/

import { ikon } from '../icons.js';
import { PROFILES } from '../../config/constants.js';

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
    <h1 class="search__title">Rencanakan Rute Perjalanan</h1>
    <p class="search__sub">Navigasi Jakarta dengan pertimbangan kualitas udara, lalu lintas, dan pantauan CCTV.</p>
  </div>

  <div class="fieldgroup" style="margin-bottom:var(--s4)">
    <div class="field">
      <span class="field__label">Titik Awal</span>
      <button type="button" class="field__gps press" id="btnDetectOrigin"
              title="Deteksi lokasi saya saat ini melalui GPS" aria-label="Deteksi lokasi saat ini">
        ${ikon('i-locate', 12)} <span id="lblDetectOrigin">Lokasi Saya</span>
      </button>
      <span class="field__pin field__pin--origin"></span>
      <input class="field__input" id="inpOrigin" type="text" role="combobox"
             aria-expanded="false" aria-controls="saranOrigin"
             placeholder="Jalan, perumahan, blok/no, atau gedung..." autocomplete="off">
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
             placeholder="Ketik tujuan (jalan, perumahan, blok/no)..." autocomplete="off">
      <div class="saran" id="saranDest" role="listbox" hidden></div>
    </div>
  </div>

  <p class="sectlabel">Moda Perjalanan</p>
  <div class="chiprow" role="group" aria-label="Pilih cara perjalanan" style="margin-bottom:var(--s4)">
    ${barisProfil()}
  </div>

  <button type="button" class="btn btn--primary btn--block btn--lg press" id="btnSearch" style="margin-bottom:var(--s5)">
    Cari Rute Aman
    <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
  </button>

  <div id="savedBox" hidden style="margin-bottom:var(--s5)">
    <p class="sectlabel">Rute Tersimpan</p>
    <div class="savedlist" id="savedList"></div>
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
