/*
   Layar hasil — Desain bersih tanpa elemen debug teknis.
*/

import { ikon } from '../icons.js';

export function templateResultView() {
  return `
<section id="viewResult" hidden>

  <div class="scorecard rise rise-1" id="scoreCard" data-status="hati">
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
    <p class="reason__text" id="sReason"></p>
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
