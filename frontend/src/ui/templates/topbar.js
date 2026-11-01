/*
   Bilah atas (Topbar) JakSafe — Desain Bersih (Clean UI).

   Hanya menampilkan elemen esensial bagi pengguna:
   - Tombol lipat/buka panel samping (Sidebar Toggle)
   - Logo JakSafe
   - Pemilih tampilan Terang / Gelap
   - Tombol Masuk / Profil Pengguna
*/

import { logoHorizontal } from '../brand.js';
import { ikon } from '../icons.js';

/**
 * @returns {string} potongan HTML bilah atas
 */
export function templateTopbar() {
  return `
<header class="topbar">
  <button type="button" class="iconbtn topbar__menubtn" id="btnToggleSidebar"
          aria-label="Sembunyikan atau tampilkan panel samping"
          title="Tutup / Buka Panel Samping">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d="M4 7h16M4 12h16M4 17h12"/>
    </svg>
  </button>

  <a class="brandlink" href="#" id="brandSlot" aria-label="JakSafe, beranda">
    ${logoHorizontal(38, 'topbar', true)}
  </a>

  <span class="topbar__spacer"></span>

  <div class="topbar__tools">
    <div class="themeswitch" role="group" aria-label="Pilih tema tampilan">
      <button type="button" class="themeswitch__btn" data-theme-set="terang" aria-pressed="true" title="Tampilan terang">Terang</button>
      <button type="button" class="themeswitch__btn" data-theme-set="gelap" aria-pressed="false" title="Tampilan gelap">Gelap</button>
    </div>

    <button type="button" class="btn btn--primary btn--sm press" id="btnLogin">
      ${ikon('i-user', 16)} Masuk
    </button>

    <button type="button" class="userchip press" id="userChip" hidden>
      <span class="userchip__ava">GS</span>
      <span class="userchip__name">Gerald</span>
      ${ikon('i-chev', 15)}
    </button>
  </div>
</header>`;
}
