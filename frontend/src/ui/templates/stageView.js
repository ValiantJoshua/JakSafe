/*
   Panggung kanan — Peta Interaktif 3D CesiumJS & 2D Normal Map (Indonesia / Jakarta).

   Menyediakan:
   - Kanvas utama CesiumJS (#mapCanvas) yang aktif sejak awal aplikasi dibuka.
   - Bilah atas mengambang:
     1) Pemilih Mode Peta: "3D Cesium" <-> "2D Peta Normal" <-> "2D Satelit"
     2) Pintasan Wilayah Indonesia: Jakarta Pusat, Jabodetabek, Nusantara (Indonesia)
   - Bilah bawah mengambang (Gaya God's Eye View):
     Sakelar ON / OFF untuk layer Traffic (TomTom Flow + Partikel Kendaraan),
     CCTV (38 Kamera Jakarta + Viewshed Cone), dan Kualitas Udara (AQI / PM2.5).
   - Kartu HUD Pratinjau Kamera CCTV langsung di atas peta ketika penanda kamera diklik,
     lengkap dengan tombol Analisis AI Vision (Gemini).
*/

import { ikon } from '../icons.js';

/**
 * @returns {string} potongan HTML panggung kanan
 */
export function templateStage() {
  return `
<main class="mapstage" aria-label="Area peta interaktif Indonesia">

  <!-- Wadah utama Peta 3D CesiumJS & 2D Normal Map -->
  <div class="mapholder" id="mapHolder">
    <div class="mapcanvas" id="mapCanvas"></div>
  </div>

  <!-- Bilah Kiri Atas: Switch Mode 3D / 2D Normal Map & Preset Wilayah Indonesia -->
  <div class="mapstage__float mapstage__float--tl" id="mapModeWrap">
    <div class="maphud-bar">
      <div class="mapmode-group" role="group" aria-label="Mode tampilan peta">
        <button type="button" class="mapmode-btn" data-map-mode="3d" aria-pressed="true" title="Peta 3D Photorealistic / Globe">
          ${ikon('i-layers', 15)}
          <span>3D Cesium</span>
        </button>
        <button type="button" class="mapmode-btn" data-map-mode="2d-road" aria-pressed="false" title="Peta 2D Jalan Normal (Google Maps)">
          ${ikon('i-route', 15)}
          <span>2D Peta Normal</span>
        </button>
        <button type="button" class="mapmode-btn" data-map-mode="2d-sat" aria-pressed="false" title="Peta 2D Satelit Hibrida">
          ${ikon('i-eye', 15)}
          <span>2D Satelit</span>
        </button>
      </div>

      <div class="mappreset-group" role="group" aria-label="Fokus wilayah Indonesia">
        <button type="button" class="mappreset-btn" data-map-preset="jakarta" title="Fokus ke Jakarta Pusat (Sudirman–Monas)">Jakarta</button>
        <button type="button" class="mappreset-btn" data-map-preset="jabodetabek" title="Fokus ke Jabodetabek">Jabodetabek</button>
        <button type="button" class="mappreset-btn" data-map-preset="indonesia" title="Fokus ke seluruh kepulauan Indonesia">Indonesia</button>
      </div>
    </div>

    <div class="mapstatus-pill" id="mapStatusPill">
      <span class="mapstatus-dot"></span>
      <span id="mapStatusText">3D Photorealistic · Fokus Indonesia</span>
    </div>
  </div>

  <!-- Bilah Kanan Atas: Kendali Zoom & Fokus Kamera -->
  <div class="mapstage__float mapstage__float--tr" id="mapCtrlWrap">
    <div class="mapctrl">
      <button type="button" class="iconbtn" id="btnMapZoomIn" aria-label="Perbesar peta" title="Perbesar">${ikon('i-plus', 18)}</button>
      <button type="button" class="iconbtn" id="btnMapZoomOut" aria-label="Perkecil peta" title="Perkecil">${ikon('i-minus', 18)}</button>
      <button type="button" class="iconbtn" id="btnMapLocate" aria-label="Fokus ke rute atau Jakarta" title="Fokus ke Rute / Jakarta">${ikon('i-locate', 18)}</button>
    </div>
  </div>

  <!-- Bilah Kiri Bawah: Sakelar Layer ON / OFF (Traffic, CCTV, Kualitas Udara) ala God's Eye View -->
  <div class="mapstage__float mapstage__float--bl" id="mapLayersWrap">
    <div class="maplayer-dock" role="group" aria-label="Lapisan data peta (ON/OFF)">
      <span class="maplayer-dock__label">LAYER PETA</span>

      <button type="button" class="maplayer-chip" id="btnLayerTraffic" aria-pressed="true" title="Nyalakan/matikan layer arus lalu lintas & partikel kendaraan">
        <span class="maplayer-chip__dot maplayer-chip__dot--traffic"></span>
        ${ikon('i-car', 16)}
        <span class="maplayer-chip__name">Traffic</span>
        <span class="maplayer-chip__badge" id="badgeLayerTraffic">ON</span>
      </button>

      <button type="button" class="maplayer-chip" id="btnLayerCctv" aria-pressed="true" title="Nyalakan/matikan layer titik kamera CCTV & kerucut pandang">
        <span class="maplayer-chip__dot maplayer-chip__dot--cctv"></span>
        ${ikon('i-camera', 16)}
        <span class="maplayer-chip__name">CCTV</span>
        <span class="maplayer-chip__badge" id="badgeLayerCctv">ON</span>
      </button>

      <button type="button" class="maplayer-chip" id="btnLayerAqi" aria-pressed="false" title="Nyalakan/matikan layer zona kualitas udara PM2.5">
        <span class="maplayer-chip__dot maplayer-chip__dot--aqi"></span>
        ${ikon('i-wind', 16)}
        <span class="maplayer-chip__name">Udara (AQI)</span>
        <span class="maplayer-chip__badge" id="badgeLayerAqi">OFF</span>
      </button>
    </div>
  </div>

  <!-- Kartu Mengambang Pratinjau Kamera CCTV saat titik kamera di peta diklik -->
  <aside class="mapcctv-popup" id="mapCctvPopup" aria-label="Pratinjau kamera CCTV" hidden>
    <div class="mapcctv__head">
      <div class="mapcctv__titlewrap">
        <span class="mapcctv__live"><span class="mapcctv__livedot"></span>LIVE CCTV</span>
        <h3 class="mapcctv__title" id="mapCctvTitle">Kamera Jakarta</h3>
        <p class="mapcctv__meta" id="mapCctvMeta">Memuat info kamera...</p>
      </div>
      <button type="button" class="mapcctv__close" id="btnMapCctvClose" aria-label="Tutup pratinjau kamera">
        ${ikon('i-x', 16)}
      </button>
    </div>

    <div class="mapcctv__frame">
      <img class="mapcctv__img" id="mapCctvImg" alt="Cuplikan langsung kamera CCTV"
           onerror="this.closest('.mapcctv__frame').setAttribute('data-gagal','1')">
      <div class="mapcctv__fallback">
        ${ikon('i-camera-off', 22)}
        <span>Bingkai kamera sedang tidak merespons</span>
      </div>
    </div>

    <div class="mapcctv__actions">
      <button type="button" class="mapcctv__btn" id="btnMapCctvFly" title="Arahkan kamera 3D ke sudut pandang CCTV ini">
        ${ikon('i-locate', 14)} Sudut Pandang 3D
      </button>
      <button type="button" class="mapcctv__btn" id="btnMapCctvRefresh" title="Muat ulang gambar terbaru">
        Muat Ulang
      </button>
      <button type="button" class="mapcctv__btn mapcctv__btn--primary" id="btnMapCctvAnalyze" title="Analisis kondisi jalan & banjir dengan Gemini Vision">
        ${ikon('i-spark', 14)} Analisis AI Vision (Gemini)
      </button>
    </div>

    <div class="mapcctv__aibox" id="mapCctvAiResult" hidden></div>
  </aside>

  <!-- Kanan Bawah: Legenda Skor Rute & Lalu Lintas -->
  <div class="mapstage__float mapstage__float--br" id="legendWrap">
    <div class="legend">
      <p class="legend__title">Arti Warna Rute & Lalu Lintas</p>
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
