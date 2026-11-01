/*
   Layar pencarian, yaitu tampilan pertama di panel kiri.

   Satu perubahan penting dibanding rancangan sebelumnya. Kartu rute
   populer sekarang TIDAK lagi memuat skor, jarak, atau label status.
   Dulu angka angka itu ditulis tetap di dalam markup, dan itu keliru,
   karena yang terlihat seperti hasil penilaian ternyata tidak pernah
   dihitung dari data mana pun. Sekarang kartu itu hanya berfungsi sebagai
   jalan pintas untuk mengisi titik awal dan tujuan. Skornya baru muncul
   setelah tombol ditekan dan datanya benar benar diambil dari backend.

   Aturan yang dipakai di seluruh frontend ini, tidak ada satu angka pun
   di layar yang tidak berasal dari backend.
*/

import { ikon } from '../icons.js';
import { routeThumb } from '../brand.js';
import { PROFILES } from '../../config/constants.js';
import { findPlaceById } from '../../config/jakartaPlaces.js';

/**
 * Pasangan rute yang sering dipakai, dipajang sebagai jalan pintas.
 * Isinya hanya pasangan id tempat, tanpa angka apa pun, karena memang
 * belum ada yang dihitung pada tahap ini.
 */
const PINTASAN_RUTE = [
  { asal: 'sudirman', tujuan: 'monas', varian: 'pagi' },
  { asal: 'kuningan', tujuan: 'kelapa-gading', varian: 'siang' },
  { asal: 'blokm', tujuan: 'grogol', varian: 'sore' },
  { asal: 'cawang', tujuan: 'thamrin', varian: 'pagi' },
];

/** Satu kartu pintasan rute. */
function kartuPintasan({ asal, tujuan, varian }) {
  const a = findPlaceById(asal);
  const b = findPlaceById(tujuan);
  if (!a || !b) return '';
  return `
<button class="routecard press" data-pintasan-asal="${asal}" data-pintasan-tujuan="${tujuan}">
  <span class="routecard__thumb">${routeThumb(varian)}</span>
  <span class="routecard__body">
    <span class="routecard__name">${a.nama}</span>
    <span class="routecard__to">${ikon('i-arrow-r', 13)} ${b.nama}</span>
  </span>
</button>`;
}

/** Deretan tombol pilihan moda perjalanan. */
function barisProfil() {
  return PROFILES.map((p, i) => `
    <button class="chip press" data-profile="${p.key}" aria-pressed="${i === 0}">
      ${ikon(p.ikon, 18)} ${p.nama}
    </button>`).join('');
}

/**
 * @returns {string} potongan HTML layar pencarian
 */
export function templateSearchView() {
  return `
<section id="viewSearch" class="slide-in">

  <div class="greet" id="greetBox">
    <h1 class="search__title">Mau ke mana <em>hari ini?</em></h1>
    <p class="search__sub">Kami carikan rute yang aman dan sehat, bukan cuma yang paling cepat.</p>
  </div>

  <!-- Kotak isian titik. Nilainya diisi dari daftar tempat tetap di
       config/jakartaPlaces.js karena backend belum punya layanan
       pencarian alamat. Daftar saran muncul saat kotak difokuskan. -->
  <div class="fieldgroup" style="margin-bottom:var(--s5)">
    <div class="field">
      <span class="field__label">Titik Awal</span>
      <span class="field__pin field__pin--origin"></span>
      <input class="field__input" id="inpOrigin" type="text" role="combobox"
             aria-expanded="false" aria-controls="saranOrigin"
             placeholder="Pilih lokasi awal" autocomplete="off">
      <div class="saran" id="saranOrigin" role="listbox" hidden></div>
    </div>

    <button class="fieldgroup__swap press" id="btnSwap"
            title="Tukar awal dan tujuan" aria-label="Tukar titik awal dan tujuan">
      ${ikon('i-swap', 17)}
    </button>

    <div class="field">
      <span class="field__label">Tujuan</span>
      <span class="field__pin field__pin--dest"></span>
      <input class="field__input" id="inpDest" type="text" role="combobox"
             aria-expanded="false" aria-controls="saranDest"
             placeholder="Mau ke mana?" autocomplete="off">
      <div class="saran" id="saranDest" role="listbox" hidden></div>
    </div>
  </div>

  <p class="sectlabel">Cara Perjalanan</p>
  <div class="chiprow" role="group" aria-label="Pilih cara perjalanan" style="margin-bottom:var(--s5)">
    ${barisProfil()}
  </div>

  <button class="btn btn--primary btn--block btn--lg sheen" id="btnSearch" style="margin-bottom:var(--s6)">
    Cari Rute Aman
    <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
  </button>

  <!-- Rute tersimpan hanya muncul setelah masuk. Isinya ditambah oleh
       authController dari keadaan aplikasi, bukan ditulis di sini. -->
  <div id="savedBox" hidden style="margin-bottom:var(--s6)">
    <p class="sectlabel">${ikon('i-star', 14)} Rute Tersimpan</p>
    <div class="savedlist" id="savedList"></div>
  </div>

  <p class="sectlabel">Rute yang Sering Dicari</p>
  <div class="routecards scroll-x" id="routeCards">
    ${PINTASAN_RUTE.map(kartuPintasan).join('')}
  </div>

  <div class="promo" id="promoBox">
    <span class="promo__icon">${ikon('i-shield', 19)}</span>
    <span class="promo__text">
      <strong>Masuk untuk fitur lengkap.</strong>
      Simpan rute favorit, lihat riwayat, dan nyalakan profil kesehatan
      supaya bobot polusi dinaikkan saat rute dinilai.
    </span>
    <button class="promo__btn press" id="btnPromoLogin">
      Lihat untungnya ${ikon('i-arrow-r', 15)}
    </button>
  </div>
</section>`;
}
