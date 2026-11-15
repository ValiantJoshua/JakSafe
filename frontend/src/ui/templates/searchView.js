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
    <h1 class="search__title">Plan Your Route</h1>
    <p class="search__sub">Navigate Jakarta with live air quality, traffic flow, and CCTV road checks.</p>
  </div>

  <div class="fieldgroup" style="margin-bottom:var(--s4)">
    <div class="field">
      <span class="field__label">Origin</span>
      <button type="button" class="field__gps press" id="btnDetectOrigin"
              title="Detect my current location via GPS" aria-label="Detect current location">
        ${ikon('i-locate', 12)} <span id="lblDetectOrigin">My Location</span>
      </button>
      <span class="field__pin field__pin--origin"></span>
      <input class="field__input" id="inpOrigin" type="text" role="combobox"
             aria-expanded="false" aria-controls="saranOrigin"
             placeholder="Street, neighborhood, or landmark..." autocomplete="off">
      <div class="saran" id="saranOrigin" role="listbox" hidden></div>
    </div>

    <button type="button" class="fieldgroup__swap press" id="btnSwap"
            title="Swap origin and destination" aria-label="Swap origin and destination">
      ${ikon('i-swap', 16)}
    </button>

    <div class="field">
      <span class="field__label">Destination</span>
      <span class="field__pin field__pin--dest"></span>
      <input class="field__input" id="inpDest" type="text" role="combobox"
             aria-expanded="false" aria-controls="saranDest"
             placeholder="Enter destination (street, area, or landmark)..." autocomplete="off">
      <div class="saran" id="saranDest" role="listbox" hidden></div>
    </div>
  </div>

  <p class="sectlabel">Travel Mode</p>
  <div class="chiprow" role="group" aria-label="Select travel mode" style="margin-bottom:var(--s4)">
    ${barisProfil()}
  </div>

  <button type="button" class="btn btn--primary btn--block btn--lg press" id="btnSearch" style="margin-bottom:var(--s5)">
    Find Safe Route
    <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
  </button>

  <div id="savedBox" hidden style="margin-bottom:var(--s5)">
    <p class="sectlabel">Saved Routes</p>
    <div class="savedlist" id="savedList"></div>
  </div>

  <div class="promo" id="promoBox">
    <span class="promo__icon">${ikon('i-shield', 18)}</span>
    <span class="promo__text">
      <strong>Health Profile &amp; Saved Routes</strong>
      Sign in to save favorite routes and prioritize clean-air scoring.
    </span>
    <button type="button" class="promo__btn press" id="btnPromoLogin">
      Sign In ${ikon('i-arrow-r', 14)}
    </button>
  </div>
</section>`;
}
