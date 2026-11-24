/*
   Jendela masuk / pendaftaran akun pengguna serta menu akun.

   Terhubung ke backend JakSafe (/api/auth/login, /api/auth/register,
   /api/auth/me) memakai token JWT. Mode Masuk dan Daftar Akun dipisahkan
   dengan tab eksplisit agar typo email saat masuk tidak otomatis mendaftarkan
   akun baru tanpa sepengetahuan pengguna.

   Keuntungan yang sudah aktif: profil kesehatan (mengubah bobot polusi
   di penilaian rute dan tersimpan permanen di MongoDB) serta daftar rute
   tersimpan per akun. Fitur berlabel "Menyusul" seperti riwayat perjalanan
   dan peringatan dini banjir disiapkan pada tahap berikutnya.
*/

import { ikon } from '../icons.js';
import { logoMark } from '../brand.js';

/** Satu baris dalam daftar perbandingan. */
function baris(teks, { aktif = true, sorot = false, ikonNama = 'i-check' } = {}) {
  const kelas = [!aktif ? 'off' : '', sorot ? 'hl' : ''].filter(Boolean).join(' ');
  return `<li${kelas ? ` class="${kelas}"` : ''}>${ikon(aktif ? ikonNama : 'i-x', 15)} ${teks}</li>`;
}

/**
 * @returns {string} potongan HTML jendela masuk
 */
export function templateLoginModal() {
  return `
<div class="modal" id="loginModal" hidden>
  <div class="modal__scrim" data-close-modal></div>
  <div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
    <button class="modal__x press" data-close-modal aria-label="Close">${ikon('i-x', 18)}</button>

    <div class="modal__grid">
      <div class="modal__left">
        <h3 class="modal__eyebrow">Why sign in?</h3>
        <div class="comparebox">

          <div class="compare compare--guest">
            <p class="compare__head"><span class="compare__tag compare__tag--guest">Guest</span></p>
            <ul class="compare__list">
              ${baris('Search safe routes')}
              ${baris('View safety scores & breakdown')}
              ${baris('Inspect air quality along routes')}
              ${baris('View live CCTV evidence')}
              ${baris('Saved routes', { aktif: false })}
              ${baris('Trip history', { aktif: false })}
              ${baris('Flood-prone area alerts', { aktif: false })}
              ${baris('Health sensitivity profile', { aktif: false })}
            </ul>
          </div>

          <div class="compare compare--member">
            <p class="compare__head"><span class="compare__tag compare__tag--member">Signed In</span></p>
            <ul class="compare__list">
              ${baris('All guest features')}
              ${baris('Health profile synced permanently to your account', { sorot: true, ikonNama: 'i-wind' })}
              ${baris('Bookmark favorite routes permanently', { sorot: true, ikonNama: 'i-star' })}
              ${baris('Automatic trip history & quick reload', { sorot: true, ikonNama: 'i-clock' })}
              ${baris('Early flood & rain corridor alerts', { sorot: true, ikonNama: 'i-bell' })}
            </ul>
          </div>

        </div>
      </div>

      <div class="modal__right">
        <div class="modal__logo">${logoMark(54, 'modal')}</div>
        <h2 class="modal__title" id="loginTitle">Sign In to JakSafe</h2>
        <p class="modal__sub" id="loginSub">Sign in with your email and password.</p>

        <div class="auth-tabs" role="tablist" aria-label="Account mode">
          <button type="button" class="auth-tab" role="tab" id="tabLoginMode" data-auth-tab="login" aria-selected="true">
            Sign In
          </button>
          <button type="button" class="auth-tab" role="tab" id="tabRegisterMode" data-auth-tab="register" aria-selected="false">
            Create Account
          </button>
        </div>

        <div class="auth-google" id="googleAuthWrap" hidden>
          <button type="button" class="btn btn--google btn--block press" id="btnGoogleAuth">
            <svg class="btn--google__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span id="lblGoogleAuth">Continue with Google</span>
          </button>
          <div class="auth-divider" aria-hidden="true"><span>or continue with email</span></div>
        </div>

        <form id="loginForm" novalidate>
          <div class="auth-alert" id="authError" role="alert" hidden></div>

          <div id="registerNameWrap" hidden>
            <label class="inputwrap" for="loginName">
              <span class="inputwrap__label">Full Name</span>
              <input class="inputwrap__input" type="text" id="loginName" name="name"
                     autocomplete="name" placeholder="Your full name">
              <span class="inputwrap__hint">Optional — leave blank to use your email prefix.</span>
            </label>
          </div>

          <label class="inputwrap" for="loginEmail">
            <span class="inputwrap__label">Email</span>
            <input class="inputwrap__input" type="email" id="loginEmail" name="email"
                   autocomplete="username" inputmode="email" autocapitalize="none"
                   spellcheck="false" placeholder="you@example.com" required>
          </label>

          <div class="inputwrap">
            <label class="inputwrap__label" for="loginPass">Password</label>
            <div class="inputwrap__pass">
              <input class="inputwrap__input inputwrap__input--pass" type="password" id="loginPass" name="password"
                     autocomplete="current-password" minlength="6" spellcheck="false"
                     placeholder="At least 6 characters" required>
              <button type="button" class="inputwrap__toggle press" id="btnTogglePass"
                      aria-label="Show password" aria-pressed="false" aria-controls="loginPass">
                ${ikon('i-eye', 17)}
              </button>
            </div>
            <span class="inputwrap__hint" id="loginPassHint">Minimum 6 characters.</span>
          </div>

          <div id="registerSensitifWrap" hidden>
            <label class="switchrow" for="chkSensitif">
              <input type="checkbox" id="chkSensitif" checked>
              <span class="switchrow__teks">
                <strong>I am sensitive to air pollution</strong>
                Increase air quality weight when scoring routes.
              </span>
            </label>
          </div>

          <button class="btn btn--primary btn--block btn--lg press" type="submit" id="btnAuthSubmit" style="margin-top:var(--s4)">
            Sign In
            <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
          </button>
        </form>

        <button class="btn btn--ghost btn--block press" id="btnGuest" style="margin-top:var(--s3)">
          Continue as Guest
        </button>
      </div>
    </div>
  </div>
</div>`;
}

/**
 * Menu yang muncul setelah chip akun di bilah atas ditekan.
 * @returns {string}
 */
export function templateUserMenu() {
  return `
<div class="usermenu" id="userMenu" hidden>
  <div class="usermenu__head">
    <span class="usermenu__ava">JS</span>
    <span>
      <span class="usermenu__name" id="menuNama">JakSafe User</span>
      <span class="usermenu__mail" id="menuEmail"></span>
    </span>
  </div>

  <!-- Penanda ini tampil hanya kalau profil kesehatan benar benar aktif,
       karena pengaruhnya pada skor memang nyata. -->
  <div class="usermenu__badge" id="menuBadgeSensitif" hidden>
    ${ikon('i-wind', 15)}
    Health profile active — pollution weight increased
  </div>

  <button type="button" class="usermenu__item usermenu__switchrow" id="btnToggleSensitif"
          role="switch" aria-checked="false" aria-describedby="menuSensitifSub">
    ${ikon('i-wind', 17)}
    <span class="usermenu__labelwrap">
      <span class="usermenu__label">Health Profile</span>
      <span class="usermenu__sub" id="menuSensitifSub">Prioritize cleaner air</span>
    </span>
    <span class="jswitch" aria-hidden="true"><span class="jswitch__thumb"></span></span>
  </button>
  <button type="button" class="usermenu__item" id="btnOpenHistory">
    ${ikon('i-clock', 17)} <span class="usermenu__text">Trip History</span>
    <span class="usermenu__n" id="menuHistoryCount">0</span>
  </button>
  <button type="button" class="usermenu__item" id="btnOpenAlerts">
    ${ikon('i-bell', 17)} <span class="usermenu__text">Flood Alerts</span>
    <span class="usermenu__n" id="menuAlertCount">Watch</span>
  </button>

  <a class="usermenu__item" id="btnOpenAdmin" href="/admin.html" hidden>
    ${ikon('i-shield', 17)} <span class="usermenu__text">Admin Dashboard</span>
  </a>

  <div class="divider" style="margin:var(--s2) 0"></div>

  <button class="usermenu__item usermenu__item--out" id="btnLogout">
    ${ikon('i-logout', 17)} Sign Out
  </button>
</div>`;
}

/**
 * Dialog semantik native untuk Riwayat Perjalanan dan Peringatan Area Rawan.
 * Mematuhi standar dialog HTML modern (`closedby="any"` tanpa `role="dialog"` atau `aria-modal` tambahan).
 * @returns {string}
 */
export function templateAccountDialogs() {
  return `
<dialog class="jmodal" id="historyDialog" closedby="any" aria-labelledby="historyTitle">
  <div class="jmodal__head">
    <span class="jmodal__icon">${ikon('i-clock', 17)}</span>
    <div class="jmodal__titles">
      <h2 class="jmodal__title" id="historyTitle">Trip History</h2>
      <p class="jmodal__sub">Recent route searches saved to your account</p>
    </div>
    <button type="button" class="jmodal__close press" data-close-dialog="historyDialog" aria-label="Close history dialog">
      ${ikon('i-x', 17)}
    </button>
  </div>

  <div class="jmodal__toolbar">
    <span class="jmodal__count" id="historySummaryText">Loading history</span>
    <button type="button" class="jmodal__action press" id="btnClearHistory" hidden>
      Clear History
    </button>
  </div>

  <div class="jmodal__body scroll-y">
    <ul class="jlist" id="historyList" aria-label="Trip history list"></ul>
  </div>
</dialog>

<dialog class="jmodal jmodal--wide" id="alertsDialog" closedby="any" aria-labelledby="alertsTitle">
  <div class="jmodal__head">
    <span class="jmodal__icon">${ikon('i-bell', 17)}</span>
    <div class="jmodal__titles">
      <h2 class="jmodal__title" id="alertsTitle">Flood-Prone Area Alerts</h2>
      <p class="jmodal__sub">Jakarta inundation corridor watch based on live rainfall &amp; CCTV</p>
    </div>
    <button type="button" class="jmodal__close press" data-close-dialog="alertsDialog" aria-label="Close alerts dialog">
      ${ikon('i-x', 17)}
    </button>
  </div>

  <div class="alertsbar">
    <div class="alertsbar__top">
      <div class="aseg" id="alertRegionChips" role="group" aria-label="Filter DKI Jakarta region">
        <button type="button" class="aseg__btn" data-region="semua" aria-pressed="true">All</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Pusat" aria-pressed="false">Central</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Selatan" aria-pressed="false">South</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Barat" aria-pressed="false">West</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Timur" aria-pressed="false">East</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Utara" aria-pressed="false">North</button>
      </div>
      <button type="button" class="alertsbar__refresh press" id="btnRefreshAlerts">Refresh</button>
    </div>

    <div class="alertsbar__sub">
      <span class="alertsbar__meta" id="alertsMetaText">Checking Jakarta corridors</span>
      <div class="alertsbar__pref" id="alertPrefBar">
        <label class="apref__chk">
          <input type="checkbox" id="chkAlertRouteAuto" checked>
          <span>Route alerts</span>
        </label>
        <label class="apref__sev" for="selAlertSeverity">
          <span class="apref__label">Threshold</span>
          <select id="selAlertSeverity">
            <option value="pantau">Watch+</option>
            <option value="waspada">Caution+</option>
            <option value="siaga">Alert Only</option>
          </select>
        </label>
      </div>
    </div>
  </div>

  <div class="jmodal__body jmodal__body--list scroll-y">
    <ul class="alist" id="alertsList" aria-label="Jakarta flood-prone corridor alerts"></ul>
  </div>
</dialog>`;
}
