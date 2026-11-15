/*
   Layar hasil — Desain bersih tanpa elemen debug teknis.
*/

import { ikon } from '../icons.js';

export function templateResultView() {
  return `
<section id="viewResult" hidden>

  <!-- Header Directions & Origin/Destination -->
  <div class="dirhead rise rise-1">
    <div class="dirhead__topbar">
      <button type="button" class="dirhead__back press" id="btnBackSearch" title="Edit search locations">
        ${ikon('i-arrow-r', 15, 'dirhead__backicon')}
        <span>Edit Route</span>
      </button>
      <span class="dirhead__title">Directions</span>
      <span class="dirhead__mode" id="sProfileBadge">Car</span>
    </div>

    <div class="dirhead__endpoints">
      <div class="dirhead__track" aria-hidden="true">
        <span class="dirhead__dot dirhead__dot--origin"></span>
        <span class="dirhead__line"></span>
        <span class="dirhead__dot dirhead__dot--dest"></span>
      </div>
      <div class="dirhead__pills">
        <button type="button" class="dirhead__pill" id="btnEditOrigin" title="Click to change origin">
          <span class="dirhead__pillname" id="sDirOriginName">-</span>
          <span class="dirhead__pillsub" id="sDirOriginArea"></span>
        </button>
        <button type="button" class="dirhead__pill" id="btnEditDest" title="Click to change destination">
          <span class="dirhead__pillname" id="sDirDestName">-</span>
          <span class="dirhead__pillsub" id="sDirDestArea"></span>
        </button>
      </div>
      <button type="button" class="dirhead__swap press" id="btnResultSwap" title="Swap origin and destination" aria-label="Swap origin and destination">
        ${ikon('i-swap', 16)}
      </button>
    </div>
  </div>

  <!-- Interactive Alternative Route Selector -->
  <div class="routeselect rise rise-1" id="routeSelectorBox">
    <div class="routeselect__head">
      <span class="routeselect__title">Route Options</span>
    </div>
    <div class="routeselect__list" id="routeOptionsList" role="listbox" aria-label="Route options"></div>
  </div>

  <!-- Hazard & Motor Toll Corridor Alert -->
  <div class="hazardbanner rise rise-1" id="routeHazardAlert" hidden>
    <div class="hazardbanner__head">
      <span class="hazardbanner__icon">${ikon('i-alert', 16)}</span>
      <span class="hazardbanner__title" id="routeHazardTitle">Hazard Alerts Along Route</span>
      <button type="button" class="hazardbanner__all press" id="btnViewAllAlerts">View all</button>
    </div>
    <ul class="hazardbanner__list" id="routeHazardList"></ul>
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
          <span class="gauge__max">of 100</span>
        </div>
      </div>
    </div>

    <span class="scorelabel" id="sLabel">
      <span class="scorelabel__icon" id="sLabelIcon"></span>
      <span id="sLabelText"></span>
    </span>

    <p class="scorecard__arti" id="sArti"></p>

    <button type="button" class="savebtn press" id="btnSaveRoute" title="Save this route">
      ${ikon('i-heart', 15)} <span id="saveLabel">Save route</span>
    </button>
  </div>

  <div class="statrow rise rise-2">
    <div class="stat stat--a">
      <p class="stat__label">Distance</p>
      <p class="stat__value" id="sDistance"></p>
    </div>
    <div class="stat stat--b">
      <p class="stat__label">Est. Time</p>
      <p class="stat__value" id="sDuration"></p>
    </div>
  </div>

  <div class="reason rise rise-3">
    <div class="reason__head">
      <span class="reason__badge">${ikon('i-shield', 17)}</span>
      <span class="reason__title">AI Route Reasoning</span>
    </div>
    <div class="reason__text" id="sReason"></div>
  </div>

  <!-- Turn-by-Turn Steps -->
  <div class="card card--steps rise rise-3" id="turnByTurnCard">
    <div class="card__head steps__head">
      <span class="card__icon">${ikon('i-route', 18)}</span>
      <div class="steps__headtext">
        <span class="card__title">Turn-by-Turn Steps</span>
        <span class="steps__sub" id="stepsSub">Click a step to inspect on map</span>
      </div>
      <span class="badge steps__badge" id="stepsCountBadge">0 steps</span>
      <button type="button" class="steps__toggle press" id="btnToggleSteps" aria-expanded="true" aria-controls="stepsListWrap" title="Collapse or expand turn list">
        ${ikon('i-chev', 15, 'steps__chev')}
      </button>
    </div>
    <div class="steps__wrap" id="stepsListWrap">
      <ol class="steps__list" id="stepsList" aria-label="Turn-by-turn route maneuvers"></ol>
    </div>
  </div>

  <div class="card card--detail rise rise-4">
    <div class="card__head">
      <span class="card__icon">${ikon('i-route', 18)}</span>
      <span class="card__title">Risk Score Breakdown</span>
    </div>

    <div class="bar">
      <div class="bar__top">
        <span class="bar__name">Travel Time</span>
        <span class="bar__weight" id="bTimeW"></span>
        <span class="bar__raw" id="bTimeRaw"></span>
      </div>
      <div class="bar__track"><div class="bar__fill" id="bTime"></div></div>
    </div>

    <div class="bar">
      <div class="bar__top">
        <span class="bar__name">Air Quality</span>
        <span class="bar__weight" id="bPollW"></span>
        <span class="bar__raw" id="bPollRaw"></span>
      </div>
      <div class="bar__track"><div class="bar__fill" id="bPoll"></div></div>
    </div>

    <div class="bar">
      <div class="bar__top">
        <span class="bar__name">Road Condition</span>
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
      <span class="card__title">Route Air Quality (AQI)</span>
      <span class="badge" style="margin-left:auto" id="aqiBadge"></span>
    </div>
    <div class="aqi__main">
      <span class="aqi__value counting" id="aqiValue">0</span>
      <span class="aqi__unit">µg/m³ · PM2.5</span>
    </div>
    <div class="aqi__scale"><span class="aqi__marker" id="aqiMarker" style="left:0%"></span></div>
    <div class="aqi__ticks"><span>Good</span><span>Moderate</span><span>Sensitive</span><span>Unhealthy</span></div>
    <p class="note" style="margin-top:var(--s3)" id="aqiNote"></p>
  </div>

  <div class="card card--cctv rise rise-6" id="cctvCard">
    <div class="card__head">
      <span class="card__icon">${ikon('i-camera', 18)}</span>
      <span class="card__title">CCTV Camera Inspection</span>
      <span class="badge badge--lime" style="margin-left:auto">Live</span>
    </div>
    <div id="cctvBody"></div>
  </div>

  <button type="button" class="btn btn--accent btn--block btn--lg press" id="btnAgain" style="margin-top:var(--s2)">
    Search Another Route
    <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
  </button>
</section>`;
}
