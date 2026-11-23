/*
   Panggung kanan — Peta Interaktif 3D CesiumJS & 2D Normal Map (Clean Google Maps Style).

   Menyediakan:
   - Kanvas utama CesiumJS (#mapCanvas).
   - Bilah atas mengambang yang bersih:
     1) Pemilih Mode Peta: "3D" | "2D Peta" | "Satelit"
     2) Pintasan Wilayah: Jakarta | Jabodetabek | Indonesia
   - Bilah bawah mengambang (Layer ON / OFF):
     Traffic, CCTV, Gedung 3D, dan Udara (AQI).
   - Kartu Mengambang Pratinjau Kamera CCTV saat titik kamera di peta diklik.
*/

import { ikon } from '../icons.js';

export function templateStage() {
  return `
<main class="mapstage" aria-label="Interactive Jakarta 3D map">

  <div class="mapholder" id="mapHolder">
    <div class="mapcanvas" id="mapCanvas"></div>
  </div>

  <!-- Top-Left: Switch Mode 3D / 2D Map / Satellite -->
  <div class="mapstage__float mapstage__float--tl" id="mapModeWrap">
    <div class="maphud-bar">
      <div class="mapmode-group" role="group" aria-label="Map view mode">
        <button type="button" class="mapmode-btn" data-map-mode="3d" aria-pressed="false" title="3D view">
          ${ikon('i-layers', 14)}
          <span>3D</span>
        </button>
        <button type="button" class="mapmode-btn" data-map-mode="2d-road" aria-pressed="true" title="2D Road Map">
          ${ikon('i-route', 14)}
          <span>2D Map</span>
        </button>
        <button type="button" class="mapmode-btn" data-map-mode="2d-sat" aria-pressed="false" title="2D Satellite Map">
          ${ikon('i-eye', 14)}
          <span>Satellite</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Top-Right: Zoom & Locate Controls -->
  <div class="mapstage__float mapstage__float--tr" id="mapCtrlWrap">
    <div class="mapctrl">
      <button type="button" class="iconbtn" id="btnMapZoomIn" aria-label="Zoom in" title="Zoom in">${ikon('i-plus', 17)}</button>
      <button type="button" class="iconbtn" id="btnMapZoomOut" aria-label="Zoom out" title="Zoom out">${ikon('i-minus', 17)}</button>
      <button type="button" class="iconbtn" id="btnMapLocate" aria-label="Go to my current location" title="My Current Location">${ikon('i-locate', 17)}</button>
    </div>
  </div>

  <!-- Bottom-Left: Layer Toggles ON / OFF (Traffic, CCTV, 3D Buildings, AQI) -->
  <div class="mapstage__float mapstage__float--bl" id="mapLayersWrap">
    <div class="maplayer-dock" role="group" aria-label="Map data layers (ON/OFF)">
      <button type="button" class="maplayer-chip" id="btnLayerTraffic" aria-pressed="true" title="Toggle live traffic flow layer">
        <span class="maplayer-chip__dot maplayer-chip__dot--traffic"></span>
        ${ikon('i-car', 15)}
        <span class="maplayer-chip__name">Traffic</span>
        <span class="maplayer-chip__badge" id="badgeLayerTraffic">ON</span>
      </button>

      <button type="button" class="maplayer-chip" id="btnLayerCctv" aria-pressed="false" title="Toggle CCTV camera pins">
        <span class="maplayer-chip__dot maplayer-chip__dot--cctv"></span>
        ${ikon('i-camera', 15)}
        <span class="maplayer-chip__name">CCTV</span>
        <span class="maplayer-chip__badge" id="badgeLayerCctv">OFF</span>
      </button>

      <button type="button" class="maplayer-chip" id="btnLayerBuildings" aria-pressed="false" title="Toggle 3D buildings">
        <span class="maplayer-chip__dot maplayer-chip__dot--buildings"></span>
        ${ikon('i-layers', 15)}
        <span class="maplayer-chip__name">3D Buildings</span>
        <span class="maplayer-chip__badge" id="badgeLayerBuildings">OFF</span>
      </button>

      <button type="button" class="maplayer-chip" id="btnLayerAqi" aria-pressed="false" title="Toggle PM2.5 air quality zones">
        <span class="maplayer-chip__dot maplayer-chip__dot--aqi"></span>
        ${ikon('i-wind', 15)}
        <span class="maplayer-chip__name">AQI</span>
        <span class="maplayer-chip__badge" id="badgeLayerAqi">OFF</span>
      </button>
    </div>
  </div>

  <!-- Floating CCTV Camera Preview Card (#mapCctvPopup) -->
  <aside class="mapcctv-popup" id="mapCctvPopup" aria-label="CCTV camera preview" hidden>
    <div class="mapcctv__head">
      <div class="mapcctv__titlewrap">
        <div class="mapcctv__tagline">
          <span class="mapcctv__live" id="mapCctvLiveBadge"><span class="mapcctv__livedot"></span><span id="mapCctvLiveLabel">LIVE STREAM</span></span>
          <span class="mapcctv__quality" id="mapCctvQuality">HLS 640p</span>
          <span class="mapcctv__status" id="mapCctvStatusBadge" data-status="unknown" hidden>Unchecked</span>
        </div>
        <h3 class="mapcctv__title" id="mapCctvTitle">Jakarta Camera</h3>
        <p class="mapcctv__meta" id="mapCctvMeta">Loading camera info...</p>
      </div>
      <button type="button" class="mapcctv__close" id="btnMapCctvClose" aria-label="Close camera preview">
        ${ikon('i-x', 15)}
      </button>
    </div>

    <!-- Stream Mode Tabs: Live Video vs Snapshot -->
    <div class="mapcctv__tabs">
      <button type="button" class="mapcctv__tab press" id="tabMapCctvVideo" data-active="1">
        <span class="mapcctv__tabdot"></span>
        <span>Live Video</span>
      </button>
      <button type="button" class="mapcctv__tab press" id="tabMapCctvSnapshot" data-active="0">
        <span>Snapshot</span>
      </button>
      <button type="button" class="mapcctv__tabbtn" id="btnMapCctvAutoRefresh" title="Toggle 3-second auto refresh">
        Auto: <strong id="lblMapCctvAutoRefresh">ON</strong>
      </button>
    </div>

    <div class="mapcctv__frame" id="mapCctvFrame">
      <!-- HTML5 HLS Video Player -->
      <video class="mapcctv__video" id="mapCctvVideo" autoplay muted playsinline controls preload="auto"></video>

      <!-- Snapshot Image View -->
      <img class="mapcctv__img" id="mapCctvImg" alt="Live CCTV camera snapshot" hidden
           onerror="this.closest('.mapcctv__frame').setAttribute('data-gagal','1')">

      <!-- Buffer / Spinner -->
      <div class="mapcctv__spinner-wrap" id="mapCctvSpinner" hidden>
        <span class="mapcctv__spinner"></span>
        <span class="mapcctv__spinnerText" id="mapCctvSpinnerText">Connecting to live stream...</span>
      </div>

      <div class="mapcctv__fallback">
        ${ikon('i-camera-off', 20)}
        <span id="mapCctvFallbackMsg">Camera is currently unresponsive</span>
      </div>
    </div>

    <div class="mapcctv__angles" id="mapCctvAngles" role="group" aria-label="Camera angles at this location" hidden></div>

    <div class="mapcctv__actions">
      <div class="mapcctv__utils">
        <button type="button" class="mapcctv__btn press" id="btnMapCctvFly" title="Fly 3D camera to this CCTV viewpoint">
          ${ikon('i-locate', 13)} 3D View
        </button>
        <button type="button" class="mapcctv__btn press" id="btnMapCctvFullscreen" title="Watch in fullscreen">
          Fullscreen
        </button>
        <button type="button" class="mapcctv__btn press" id="btnMapCctvRefresh" title="Reload live feed">
          Refresh
        </button>
      </div>
      <button type="button" class="mapcctv__btn mapcctv__btn--primary press" id="btnMapCctvAnalyze" title="Analyze road & flood conditions with Gemini Vision">
        ${ikon('i-spark', 13)} AI Analysis
      </button>
    </div>

    <div class="mapcctv__aibox" id="mapCctvAiResult" hidden></div>
  </aside>

  <!-- Click-to-Pick Map Location Menu -->
  <aside class="mappick-menu" id="mapPickMenu" aria-label="Selected map location details" hidden>
    <div class="mappick__head">
      <div class="mappick__locname">
        <span class="mappick__pin" aria-hidden="true">${ikon('i-pin', 15)}</span>
        <h4 class="mappick__title" id="mapPickTitle">Resolving address...</h4>
      </div>
      <button type="button" class="mappick__close" id="btnMapPickClose" aria-label="Close location details" title="Close">
        ${ikon('i-x', 14)}
      </button>
    </div>

    <div class="mappick__body">
      <p class="mappick__area" id="mapPickArea">Greater Jakarta</p>
      <p class="mappick__coords" id="mapPickCoords">[-6.2088, 106.8456]</p>
    </div>

    <div class="mappick__actions">
      <button type="button" class="mappick__btn mappick__btn--origin press" id="btnPickAsOrigin" title="Set as route origin">
        <span class="mappick__indicator mappick__indicator--origin" aria-hidden="true">A</span>
        <span>Origin</span>
      </button>
      <button type="button" class="mappick__btn mappick__btn--dest press" id="btnPickAsDest" title="Set as route destination">
        <span class="mappick__indicator mappick__indicator--dest" aria-hidden="true">B</span>
        <span>Destination</span>
      </button>
      <button type="button" class="mappick__btn mappick__btn--copy press" id="btnPickCopy" title="Copy coordinates">
        ${ikon('i-copy', 13)}
        <span>Copy</span>
      </button>
    </div>
  </aside>

  <!-- Bottom-Right: Compact Legend -->
  <div class="mapstage__float mapstage__float--br" id="legendWrap">
    <div class="legend">
      <p class="legend__title">Route &amp; Traffic Index</p>
      <div class="legend__item"><span class="legend__swatch" style="background:#22C55E"></span>
        Safe / Smooth <span class="legend__range">0–29</span></div>
      <div class="legend__item"><span class="legend__swatch" style="background:#F59E0B"></span>
        Caution / Moderate <span class="legend__range">30–59</span></div>
      <div class="legend__item"><span class="legend__swatch" style="background:#EF4444"></span>
        Avoid / Congested <span class="legend__range">60–100</span></div>
    </div>
  </div>

</main>`;
}
