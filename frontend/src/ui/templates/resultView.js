/*
   Layar hasil — Desain bersih tanpa elemen debug teknis.
*/

import { ikon } from '../icons.js';

export function templateResultView() {
  return `
<section id="viewResult" hidden>

  <!-- Header Petunjuk Arah & Titik Awal/Tujuan ala Waze / Google Maps -->
  <div class="dirhead rise rise-1">
    <div class="dirhead__topbar">
      <button type="button" class="dirhead__back press" id="btnBackSearch" title="Ubah titik pencarian">
        ${ikon('i-arrow-r', 15, 'dirhead__backicon')}
        <span>Ubah Rute</span>
      </button>
      <span class="dirhead__title">Petunjuk Arah</span>
      <span class="dirhead__mode" id="sProfileBadge">Mobil</span>
    </div>

    <div class="dirhead__endpoints">
      <div class="dirhead__track" aria-hidden="true">
        <span class="dirhead__dot dirhead__dot--origin"></span>
        <span class="dirhead__line"></span>
        <span class="dirhead__dot dirhead__dot--dest"></span>
      </div>
      <div class="dirhead__pills">
        <button type="button" class="dirhead__pill" id="btnEditOrigin" title="Klik untuk ganti titik awal">
          <span class="dirhead__pillname" id="sDirOriginName">-</span>
          <span class="dirhead__pillsub" id="sDirOriginArea"></span>
        </button>
        <button type="button" class="dirhead__pill" id="btnEditDest" title="Klik untuk ganti tujuan">
          <span class="dirhead__pillname" id="sDirDestName">-</span>
          <span class="dirhead__pillsub" id="sDirDestArea"></span>
        </button>
      </div>
      <button type="button" class="dirhead__swap press" id="btnResultSwap" title="Putar balik awal & tujuan" aria-label="Tukar titik awal dan tujuan">
        ${ikon('i-swap', 16)}
      </button>
    </div>
  </div>

  <!-- Interactive Alternative Route Selector (Pilihan Rute 1, 2, 3...) -->
  <div class="routeselect rise rise-1" id="routeSelectorBox">
    <div class="routeselect__head">
      <span class="routeselect__title">Pilihan Rute</span>
      <span class="routeselect__sub" id="routeSelectorSub">Klik rute untuk membandingkan</span>
    </div>
    <div class="routeselect__list" id="routeOptionsList" role="listbox" aria-label="Pilihan rute perjalanan"></div>
  </div>

  <div class="scorecard rise rise-2" id="scoreCard" data-status="hati">
    <p class="scorecard__route">
      <span id="sRouteFrom"></span>
      ${ikon('i-arrow-r', 17, 'scorecard__arrow')}
      <span id="sRouteTo"></span>
    </p>

    <div class="gauge-stage">
      <div class="gauge" id="gauge" style="--val:0">
        <div class="gauge__shadow"></div>
        <div class="gauge__ring"></div>
        <div class="gauge__core">
          <span class="gauge__num counting" id="sScore">0</span>
          <span class="gauge__max">dari 100</span>
        </div>
      </div>
    </div>

    <span class="scorelabel" id="sLabel">
      <span class="scorelabel__icon" id="sLabelIcon"></span>
      <span id="sLabelText"></span>
    </span>

    <p class="scorecard__arti" id="sArti"></p>

    <button type="button" class="savebtn press" id="btnSaveRoute" title="Simpan rute ini">
      ${ikon('i-heart', 15)} <span id="saveLabel">Simpan rute</span>
    </button>
  </div>

  <div class="statrow rise rise-2">
    <div class="stat stat--a">
      <p class="stat__label">Jarak</p>
      <p class="stat__value" id="sDistance"></p>
    </div>
    <div class="stat stat--b">
      <p class="stat__label">Perkiraan Waktu</p>
      <p class="stat__value" id="sDuration"></p>
    </div>
  </div>

  <div class="reason rise rise-3">
    <div class="reason__head">
      <span class="reason__badge">${ikon('i-spark', 17)}</span>
      <span class="reason__title">Ringkasan Rekomendasi AI</span>
    </div>
    <div class="reason__text" id="sReason"></div>
  </div>

  <div class="card card--detail rise rise-4">
    <div class="card__head">
      <span class="card__icon">${ikon('i-route', 18)}</span>
      <span class="card__title">Rincian Penilaian Risiko</span>
    </div>

    <div class="bar">
      <div class="bar__top">
        <span class="bar__name">Waktu tempuh</span>
        <span class="bar__weight" id="bTimeW"></span>
        <span class="bar__raw" id="bTimeRaw"></span>
      </div>
      <div class="bar__track"><div class="bar__fill" id="bTime"></div></div>
    </div>

    <div class="bar">
      <div class="bar__top">
        <span class="bar__name">Tingkat polusi</span>
        <span class="bar__weight" id="bPollW"></span>
        <span class="bar__raw" id="bPollRaw"></span>
      </div>
      <div class="bar__track"><div class="bar__fill" id="bPoll"></div></div>
    </div>

    <div class="bar">
      <div class="bar__top">
        <span class="bar__name">Kondisi jalan</span>
        <span class="bar__weight" id="bRoadW"></span>
        <span class="bar__raw" id="bRoadRaw"></span>
      </div>
      <div class="bar__track"><div class="bar__fill" id="bRoad"></div></div>
    </div>

    <p class="note note--sumber" id="sumberWaktu"></p>
  </div>

  <div class="card card--aqi rise rise-5" id="aqiCard">
    <div class="card__head">
      <span class="card__icon">${ikon('i-wind', 18)}</span>
      <span class="card__title">Kualitas Udara Rute</span>
      <span class="badge" style="margin-left:auto" id="aqiBadge"></span>
    </div>
    <div class="aqi__main">
      <span class="aqi__value counting" id="aqiValue">0</span>
      <span class="aqi__unit">µg/m³ · PM2.5</span>
    </div>
    <div class="aqi__scale"><span class="aqi__marker" id="aqiMarker" style="left:0%"></span></div>
    <div class="aqi__ticks"><span>BAIK</span><span>SEDANG</span><span>SENSITIF</span><span>BURUK</span></div>
    <p class="note" style="margin-top:var(--s3)" id="aqiNote"></p>
  </div>

  <div class="card card--cctv rise rise-6" id="cctvCard">
    <div class="card__head">
      <span class="card__icon">${ikon('i-camera', 18)}</span>
      <span class="card__title">Pantauan Kamera CCTV</span>
      <span class="badge badge--lime" style="margin-left:auto">LIVE</span>
    </div>
    <div id="cctvBody"></div>
  </div>

  <div class="disclosure card--log rise rise-6">
    <button type="button" class="disclosure__btn" id="btnLog" aria-expanded="false" aria-controls="logPanel">
      <span class="card__icon" style="width:32px;height:32px;flex:0 0 32px">${ikon('i-spark', 16)}</span>
      <span class="disclosure__title">Jejak Penalaran Agen</span>
      <span class="disclosure__meta" id="logTotal"></span>
      ${ikon('i-chev', 16, 'disclosure__chev')}
    </button>
    <div class="disclosure__panel" id="logPanel" hidden></div>
  </div>

  <button type="button" class="btn btn--accent btn--block btn--lg press" id="btnAgain" style="margin-top:var(--s2)">
    Cari Rute Lain
    <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
  </button>
</section>`;
}
