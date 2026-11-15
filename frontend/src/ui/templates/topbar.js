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
          aria-label="Toggle side panel"
          title="Toggle Side Panel">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d="M4 7h16M4 12h16M4 17h12"/>
    </svg>
  </button>

  <a class="brandlink" href="#" id="brandSlot" aria-label="JakSafe home">
    ${logoHorizontal(38, 'topbar', true)}
  </a>

  <span class="topbar__spacer"></span>

  <div class="topbar__tools">
    <button type="button" class="themeswitch" id="btnThemeToggle"
            role="switch"
            aria-checked="false"
            aria-label="Dark mode"
            title="Switch theme (Light / Dark)">
      <span class="themeswitch__track" aria-hidden="true">
        <span class="themeswitch__thumb"></span>
        <span class="themeswitch__slot themeswitch__slot--sun" data-theme-set="terang" title="Light theme">
          ${ikon('i-sun', 17)}
        </span>
        <span class="themeswitch__slot themeswitch__slot--moon" data-theme-set="gelap" title="Dark theme">
          ${ikon('i-moon', 17)}
        </span>
      </span>
    </button>

    <button type="button" class="btn btn--primary btn--sm press" id="btnLogin">
      ${ikon('i-user', 16)} Sign In
    </button>

    <button type="button" class="userchip press" id="userChip" hidden>
      <span class="userchip__ava" id="userChipAva">JS</span>
      <span class="userchip__name" id="userChipNama">Account</span>
      ${ikon('i-chev', 15)}
    </button>
  </div>
</header>`;
}
