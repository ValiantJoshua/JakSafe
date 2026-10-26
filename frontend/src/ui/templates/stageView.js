/*
   Panggung kanan.

   Berisi tiga lapis yang bergantian tampil. Banner sambutan saat belum
   ada pencarian, tempat peta saat sedang memproses dan melihat hasil,
   serta kendali dan legenda yang mengambang di atasnya.

   Peta tiga dimensi belum dipasang pada tahap ini. Yang ada sekarang
   gambar pengganti berupa sketsa jaringan jalan, lengkap dengan keterangan
   jujur bahwa peta aslinya menyusul. Modul kosong untuk peta sudah
   disiapkan di folder src/map supaya tahap berikutnya tinggal mengisi,
   bukan merombak susunan berkas.
*/

import { ikon } from '../icons.js';
import { heroBanner } from '../brand.js';

/**
 * @returns {string} potongan HTML panggung kanan
 */
export function templateStage() {
  return `
<main class="mapstage" aria-label="Area peta">

  <!-- Banner sambutan. Gambarnya sudah memuat logo dan tagline, jadi
       tidak ada teks tambahan yang ditimpa di atasnya. Yang menimpa
       hanya tiga penanda fitur di tepi bawah. -->
  <section class="hero" id="hero">
    <div class="hero__banner" id="heroArt">${heroBanner()}</div>

    <div class="hero__feats">
      <span class="feat"><span class="feat__ic feat__ic--b">${ikon('i-route', 17)}</span>Rute cerdas</span>
      <span class="feat"><span class="feat__ic feat__ic--g">${ikon('i-wind', 17)}</span>Pantau udara</span>
      <span class="feat"><span class="feat__ic feat__ic--n">${ikon('i-camera', 17)}</span>Bukti CCTV</span>
    </div>

    <span class="hero__note">
      ${ikon('i-layers', 14)}
      Peta 3D dipasang pada tahap berikutnya
    </span>
  </section>

  <!-- Tempat peta. Sketsa jalannya memakai ruas lurus dan diagonal,
       bukan lengkungan, supaya terbaca sebagai jaringan jalan dan tidak
       membuat mata lelah. -->
  <div class="mapholder" id="mapHolder" hidden>
    <div class="mapholder__grid"></div>
    <svg class="mapholder__sketch" viewBox="0 0 900 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g stroke="var(--border-strong)" stroke-width="3" fill="none" opacity=".6">
        <path d="M0 200 H900M0 420 H900M240 0 V640M640 0 V640"/>
      </g>
      <path class="sketch-path" stroke="var(--jk-blue-2)"
            d="M80 560 L240 560 L240 420 L420 420 L420 300 L640 300 L640 200 L840 120"/>
      <path class="sketch-path sketch-path--alt" stroke="var(--jk-green)"
            d="M60 300 L240 300 L300 200 L640 200 L720 120 L870 70"/>
      <g class="sketch-node"><circle cx="80" cy="560" r="13" fill="var(--jk-blue-1)"/><circle cx="80" cy="560" r="5" fill="#fff"/></g>
      <g class="sketch-node"><circle cx="420" cy="300" r="11" fill="var(--jk-green)"/><circle cx="420" cy="300" r="4" fill="#fff"/></g>
      <g class="sketch-node"><circle cx="840" cy="120" r="13" fill="var(--st-hindari)"/><circle cx="840" cy="120" r="5" fill="#fff"/></g>
    </svg>

    <div class="mapholder__card">
      <div class="mapholder__x">${ikon('i-x', 34)}</div>
      <h2 class="mapholder__title">Peta 3D belum aktif</h2>
      <p class="mapholder__text">Area ini nantinya diisi globe 3D Jakarta beserta garis rute,
        lapisan kualitas udara, dan penanda kamera CCTV.</p>
      <span class="mapholder__hint">${ikon('i-layers', 14)} Dipasang pada tahap berikutnya</span>
    </div>
  </div>

  <div class="mapstage__float mapstage__float--tr" id="mapCtrlWrap" hidden>
    <div class="mapctrl">
      <button class="iconbtn" disabled aria-label="Perbesar">${ikon('i-plus', 18)}</button>
      <button class="iconbtn" disabled aria-label="Perkecil">${ikon('i-minus', 18)}</button>
      <button class="iconbtn" disabled aria-label="Posisi saya">${ikon('i-locate', 18)}</button>
    </div>
  </div>

  <div class="mapstage__float mapstage__float--br" id="legendWrap" hidden>
    <div class="legend">
      <p class="legend__title">Arti Warna Rute</p>
      <div class="legend__item"><span class="legend__swatch" style="background:var(--st-aman)"></span>
        Aman <span class="legend__range">0 sampai 29</span></div>
      <div class="legend__item"><span class="legend__swatch" style="background:var(--st-hati)"></span>
        Hati-hati <span class="legend__range">30 sampai 59</span></div>
      <div class="legend__item"><span class="legend__swatch" style="background:var(--st-hindari)"></span>
        Hindari <span class="legend__range">60 sampai 100</span></div>
    </div>
  </div>

</main>`;
}
