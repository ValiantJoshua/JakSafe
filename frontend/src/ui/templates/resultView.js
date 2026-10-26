/*
   Layar hasil.

   Seluruh isian angka di sini dibiarkan kosong. Markupnya hanya menyiapkan
   wadah beserta id, lalu resultController yang mengisinya dari objek hasil
   backend. Tidak ada nilai contoh yang ditulis di markup, karena nilai
   contoh punya kebiasaan buruk tertinggal di layar ketika pengisian gagal
   dan membuat data palsu terlihat seperti data sungguhan.

   Urutan kartunya mengikuti cara orang membaca hasil. Angka besar dan
   labelnya lebih dulu sebagai kesimpulan, lalu jarak dan waktu sebagai
   fakta dasar, lalu alasan dalam satu kalimat, baru rincian tiap kriteria,
   bukti kualitas udara, bukti visual dari kamera, dan terakhir jejak
   proses untuk yang ingin menelusuri sendiri.
*/

import { ikon } from '../icons.js';

/**
 * @returns {string} potongan HTML layar hasil
 */
export function templateResultView() {
  return `
<section id="viewResult" hidden>

  <!-- Kartu skor. Atribut data-status diisi aman, hati, atau hindari,
       dan itu yang menentukan warna cincin serta lencana lewat CSS. -->
  <div class="scorecard tilt rise rise-1" id="scoreCard" data-status="hati">
    <div class="tilt__layer">

      <!-- Lencana asal hasil. Menandai apakah penilaian datang dari agen
           di backend atau dari perhitungan pratinjau di frontend. Lencana
           ini sengaja ditaruh paling atas supaya tidak mungkin terlewat. -->
      <span class="sumberbadge" id="sumberBadge" data-sumber="pratinjau">
        <span class="sumberbadge__titik"></span>
        <span id="sumberBadgeTeks"></span>
      </span>

      <p class="scorecard__route">
        <span id="sRouteFrom"></span>
        ${ikon('i-arrow-r', 18, 'scorecard__arrow')}
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

      <button class="savebtn press" id="btnSaveRoute" title="Simpan rute ini">
        ${ikon('i-heart', 16)} <span id="saveLabel">Simpan rute</span>
      </button>
    </div>
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
      <span class="reason__badge">${ikon('i-spark', 18)}</span>
      <span class="reason__title">Kenapa rute ini?</span>
    </div>
    <p class="reason__text" id="sReason"></p>
  </div>

  <!-- Rincian penilaian. Persentase bobot tidak ditulis tetap di markup
       karena bobot polusi bisa naik saat profil kesehatan menyala. -->
  <div class="card card--detail rise rise-4">
    <div class="card__head">
      <span class="card__icon">${ikon('i-route', 19)}</span>
      <span class="card__title">Rincian Penilaian</span>
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

    <div class="note" style="margin-top:var(--s4)">
      ${ikon('i-info', 16)}
      <span>Makin rendah nilainya, makin baik. Skor akhir adalah gabungan ketiganya sesuai bobot di atas.</span>
    </div>

    <p class="note note--sumber" id="sumberWaktu"></p>
  </div>

  <div class="card card--aqi tilt rise rise-5" id="aqiCard">
    <div class="tilt__layer">
      <div class="card__head">
        <span class="card__icon">${ikon('i-wind', 19)}</span>
        <span class="card__title">Kualitas Udara</span>
        <span class="badge" style="margin-left:auto" id="aqiBadge"></span>
      </div>
      <div class="aqi__main">
        <span class="aqi__value counting" id="aqiValue">0</span>
        <span class="aqi__unit">µg/m³ · PM2.5</span>
      </div>
      <div class="aqi__scale"><span class="aqi__marker" id="aqiMarker" style="left:0%"></span></div>
      <div class="aqi__ticks"><span>BAIK</span><span>SEDANG</span><span>SENSITIF</span><span>BURUK</span></div>
      <p class="note" style="margin-top:var(--s4)" id="aqiNote"></p>
    </div>
  </div>

  <!-- Bukti visual. Gambar diambil lewat /api/cctv/frame/:id sehingga
       alamat sumber kamera tetap tersembunyi di sisi backend. -->
  <div class="card card--cctv rise rise-6" id="cctvCard">
    <div class="card__head">
      <span class="card__icon">${ikon('i-camera', 19)}</span>
      <span class="card__title">Bukti Kondisi Jalan</span>
      <span class="badge badge--lime" style="margin-left:auto">CCTV</span>
    </div>
    <div id="cctvBody"></div>
  </div>

  <!-- Jejak proses. Isinya daftar panggilan HTTP yang sungguh terjadi
       beserta lamanya, bukan narasi yang dikarang. -->
  <div class="disclosure card--log rise rise-6">
    <button class="disclosure__btn" id="btnLog" aria-expanded="false" aria-controls="logPanel">
      <span class="card__icon" style="width:34px;height:34px;flex:0 0 34px">${ikon('i-spark', 18)}</span>
      <span class="disclosure__title">Cara JakSafe mengambil keputusan</span>
      <span class="disclosure__meta" id="logTotal"></span>
      ${ikon('i-chev', 18, 'disclosure__chev')}
    </button>
    <div class="disclosure__panel" id="logPanel" hidden></div>
  </div>

  <button class="btn btn--accent btn--block btn--lg press" id="btnAgain" style="margin-top:var(--s2)">
    Cari Rute Lain
    <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
  </button>
</section>`;
}
