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
<main class="mapstage" aria-label="Area peta interaktif Indonesia">

  <div class="mapholder" id="mapHolder">
    <div class="mapcanvas" id="mapCanvas"></div>
  </div>

  <!-- Kiri Atas: Switch Mode 3D / 2D Peta Normal / Satelit -->
  <div class="mapstage__float mapstage__float--tl" id="mapModeWrap">
    <div class="maphud-bar">
      <div class="mapmode-group" role="group" aria-label="Mode tampilan peta">
        <button type="button" class="mapmode-btn" data-map-mode="3d" aria-pressed="true" title="Tampilan 3D dengan Gedung 3D">
          ${ikon('i-layers', 14)}
          <span>3D</span>
        </button>
        <button type="button" class="mapmode-btn" data-map-mode="2d-road" aria-pressed="false" title="Peta 2D Normal (Google Maps)">
          ${ikon('i-route', 14)}
          <span>2D Peta</span>
        </button>
        <button type="button" class="mapmode-btn" data-map-mode="2d-sat" aria-pressed="false" title="Peta 2D Satelit">
          ${ikon('i-eye', 14)}
          <span>Satelit</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Kanan Atas: Kendali Zoom & Lokasi Saya -->
  <div class="mapstage__float mapstage__float--tr" id="mapCtrlWrap">
    <div class="mapctrl">
      <button type="button" class="iconbtn" id="btnMapZoomIn" aria-label="Perbesar peta" title="Perbesar">${ikon('i-plus', 17)}</button>
      <button type="button" class="iconbtn" id="btnMapZoomOut" aria-label="Perkecil peta" title="Perkecil">${ikon('i-minus', 17)}</button>
      <button type="button" class="iconbtn" id="btnMapLocate" aria-label="Menuju lokasi saya saat ini" title="Lokasi Saya Saat Ini">${ikon('i-locate', 17)}</button>
    </div>
  </div>

  <!-- Kiri Bawah: Sakelar Layer ON / OFF (Traffic, CCTV, Gedung 3D, AQI) -->
  <div class="mapstage__float mapstage__float--bl" id="mapLayersWrap">
    <div class="maplayer-dock" role="group" aria-label="Lapisan data peta (ON/OFF)">
      <button type="button" class="maplayer-chip" id="btnLayerTraffic" aria-pressed="true" title="Nyalakan/matikan layer arus lalu lintas">
        <span class="maplayer-chip__dot maplayer-chip__dot--traffic"></span>
        ${ikon('i-car', 15)}
        <span class="maplayer-chip__name">Traffic</span>
        <span class="maplayer-chip__badge" id="badgeLayerTraffic">ON</span>
      </button>

      <button type="button" class="maplayer-chip" id="btnLayerCctv" aria-pressed="true" title="Nyalakan/matikan titik kamera CCTV">
        <span class="maplayer-chip__dot maplayer-chip__dot--cctv"></span>
        ${ikon('i-camera', 15)}
        <span class="maplayer-chip__name">CCTV</span>
        <span class="maplayer-chip__badge" id="badgeLayerCctv">ON</span>
      </button>

      <button type="button" class="maplayer-chip" id="btnLayerBuildings" aria-pressed="true" title="Nyalakan/matikan Gedung 3D">
        <span class="maplayer-chip__dot maplayer-chip__dot--buildings"></span>
        ${ikon('i-layers', 15)}
        <span class="maplayer-chip__name">Gedung 3D</span>
        <span class="maplayer-chip__badge" id="badgeLayerBuildings">ON</span>
      </button>

      <button type="button" class="maplayer-chip" id="btnLayerAqi" aria-pressed="false" title="Nyalakan/matikan zona kualitas udara PM2.5">
        <span class="maplayer-chip__dot maplayer-chip__dot--aqi"></span>
        ${ikon('i-wind', 15)}
        <span class="maplayer-chip__name">Udara</span>
        <span class="maplayer-chip__badge" id="badgeLayerAqi">OFF</span>
      </button>
    </div>
  </div>

  <!-- Kartu Mengambang Pratinjau Kamera CCTV saat titik kamera di peta diklik -->
  <aside class="mapcctv-popup" id="mapCctvPopup" aria-label="Pratinjau kamera CCTV" hidden>
    <div class="mapcctv__head">
      <div class="mapcctv__titlewrap">
        <div class="mapcctv__tagline">
          <span class="mapcctv__live" id="mapCctvLiveBadge"><span class="mapcctv__livedot"></span><span id="mapCctvLiveLabel">LIVE STREAM</span></span>
          <span class="mapcctv__quality" id="mapCctvQuality">HLS 640p</span>
        </div>
        <h3 class="mapcctv__title" id="mapCctvTitle">Kamera Jakarta</h3>
        <p class="mapcctv__meta" id="mapCctvMeta">Memuat info kamera...</p>
      </div>
      <button type="button" class="mapcctv__close" id="btnMapCctvClose" aria-label="Tutup pratinjau kamera">
        ${ikon('i-x', 15)}
      </button>
    </div>

    <!-- Tab mode pilihan: Live Video vs Snapshot -->
    <div class="mapcctv__tabs">
      <button type="button" class="mapcctv__tab press" id="tabMapCctvVideo" data-active="1">
        <span class="mapcctv__tabdot"></span>
        <span>Live Video</span>
      </button>
      <button type="button" class="mapcctv__tab press" id="tabMapCctvSnapshot" data-active="0">
        <span>Snapshot (Foto)</span>
      </button>
      <button type="button" class="mapcctv__tabbtn" id="btnMapCctvAutoRefresh" title="Aktifkan/nonaktifkan pembaruan otomatis tiap 3 detik">
        Auto: <strong id="lblMapCctvAutoRefresh">ON</strong>
      </button>
    </div>

    <div class="mapcctv__frame" id="mapCctvFrame">
      <!-- Player Video HLS HTML5 -->
      <video class="mapcctv__video" id="mapCctvVideo" autoplay muted playsinline controls preload="auto"></video>

      <!-- Tampilan Snapshot Gambar -->
      <img class="mapcctv__img" id="mapCctvImg" alt="Cuplikan langsung kamera CCTV" hidden
           onerror="this.closest('.mapcctv__frame').setAttribute('data-gagal','1')">

      <!-- Status Buffer / Spinner -->
      <div class="mapcctv__spinner-wrap" id="mapCctvSpinner" hidden>
        <span class="mapcctv__spinner"></span>
        <span class="mapcctv__spinnerText" id="mapCctvSpinnerText">Menghubungkan ke live stream...</span>
      </div>

      <div class="mapcctv__fallback">
        ${ikon('i-camera-off', 20)}
        <span id="mapCctvFallbackMsg">Kamera sedang tidak merespons</span>
      </div>
    </div>

    <div class="mapcctv__actions">
      <button type="button" class="mapcctv__btn" id="btnMapCctvFly" title="Arahkan kamera 3D ke sudut pandang CCTV ini">
        ${ikon('i-locate', 13)} Sudut Pandang 3D
      </button>
      <button type="button" class="mapcctv__btn" id="btnMapCctvFullscreen" title="Tonton dalam layar penuh">
        Layar Penuh
      </button>
      <button type="button" class="mapcctv__btn" id="btnMapCctvRefresh" title="Muat ulang siaran langsung">
        Muat Ulang
      </button>
      <button type="button" class="mapcctv__btn mapcctv__btn--primary" id="btnMapCctvAnalyze" title="Analisis kondisi jalan & banjir dengan Gemini Vision">
        ${ikon('i-spark', 13)} Analisis AI
      </button>
    </div>

    <div class="mapcctv__aibox" id="mapCctvAiResult" hidden></div>
  </aside>

  <!-- Menu Titik Peta Terpilih (Click-to-Pick Coordinate ala Google Maps) -->
  <aside class="mappick-menu" id="mapPickMenu" aria-label="Menu Titik Peta Terpilih" hidden>
    <div class="mappick__head">
      <div class="mappick__badge">
        <span class="mappick__pin">${ikon('i-pin', 13)}</span>
        <span class="mappick__badgetext">Titik Peta Terpilih</span>
      </div>
      <button type="button" class="mappick__close" id="btnMapPickClose" aria-label="Tutup menu titik peta" title="Tutup">
        ${ikon('i-x', 13)}
      </button>
    </div>

    <div class="mappick__body">
      <h4 class="mappick__title" id="mapPickTitle">Mendeteksi alamat...</h4>
      <p class="mappick__meta" id="mapPickMeta">-6.2088, 106.8456</p>
    </div>

    <div class="mappick__actions">
      <button type="button" class="mappick__btn mappick__btn--origin press" id="btnPickAsOrigin" title="Jadikan titik ini sebagai titik awal perjalanan">
        <span class="mappick__dot mappick__dot--origin"></span>
        <span>Titik Awal</span>
      </button>
      <button type="button" class="mappick__btn mappick__btn--dest press" id="btnPickAsDest" title="Jadikan titik ini sebagai tujuan perjalanan">
        <span class="mappick__dot mappick__dot--dest"></span>
        <span>Tujuan</span>
      </button>
      <button type="button" class="mappick__btn mappick__btn--copy press" id="btnPickCopy" title="Salin koordinat">
        ${ikon('i-copy', 13)}
        <span>Salin</span>
      </button>
    </div>
  </aside>

  <!-- Kanan Bawah: Legenda Ringkas -->
  <div class="mapstage__float mapstage__float--br" id="legendWrap">
    <div class="legend">
      <p class="legend__title">Indeks Rute & Lalu Lintas</p>
      <div class="legend__item"><span class="legend__swatch" style="background:#22C55E"></span>
        Aman / Lancar <span class="legend__range">0–29</span></div>
      <div class="legend__item"><span class="legend__swatch" style="background:#F59E0B"></span>
        Hati-hati / Padat <span class="legend__range">30–59</span></div>
      <div class="legend__item"><span class="legend__swatch" style="background:#EF4444"></span>
        Hindari / Macet <span class="legend__range">60–100</span></div>
    </div>
  </div>

</main>`;
}
