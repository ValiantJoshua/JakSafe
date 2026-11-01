/*
   Bilah atas.

   Isinya logo, pemilih tema, pengatur ukuran teks, penanda sambungan ke
   backend, dan tombol akun. Semua tombol di sini hanya menghasilkan
   markup, tidak memasang satu pun pendengar peristiwa. Pemasangan
   perilaku dikerjakan oleh berkas di dalam folder controllers supaya
   bentuk tampilan dan perilakunya tetap terpisah.
*/

import { logoHorizontal } from '../brand.js';
import { ikon } from '../icons.js';

/**
 * @returns {string} potongan HTML bilah atas
 */
export function templateTopbar() {
  return `
<header class="topbar">
  <a class="brandlink" href="#" id="brandSlot" aria-label="JakSafe, beranda">
    ${logoHorizontal(42, 'topbar', true)}
  </a>

  <span class="topbar__spacer"></span>

  <div class="topbar__tools">
    <!-- Penanda sambungan backend. Isinya diperbarui backendController,
         dan atribut data-status yang menentukan warnanya lewat CSS. -->
    <span class="konstat" id="konStat" data-status="memeriksa" title="Keadaan sambungan ke backend JakSafe">
      <span class="konstat__titik"></span>
      <span class="konstat__teks" id="konStatTeks">Memeriksa backend</span>
    </span>

    <div class="themeswitch" role="group" aria-label="Pilih tampilan">
      <button class="themeswitch__btn" data-theme-set="terang" aria-pressed="true" title="Tampilan terang">Terang</button>
      <button class="themeswitch__btn" data-theme-set="gelap" aria-pressed="false" title="Tampilan gelap">Gelap</button>
      <button class="themeswitch__btn" data-theme-set="kontras" aria-pressed="false" title="Kontras tinggi">Kontras</button>
    </div>

    <button class="iconbtn press" id="btnTextSize" aria-pressed="false"
            title="Perbesar ukuran teks" aria-label="Perbesar ukuran teks">
      ${ikon('i-text', 20)}
    </button>

    <!-- Keadaan tamu. Ditukar dengan chip akun oleh authController. -->
    <button class="btn btn--primary btn--sm press" id="btnLogin">
      ${ikon('i-user', 17)} Masuk
    </button>

    <!-- Keadaan sudah masuk. -->
    <button class="userchip press" id="userChip" hidden>
      <span class="userchip__ava">GS</span>
      <span class="userchip__name">Gerald</span>
      ${ikon('i-chev', 16)}
    </button>
  </div>
</header>`;
}
