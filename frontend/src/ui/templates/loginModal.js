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
    <button class="modal__x press" data-close-modal aria-label="Tutup">${ikon('i-x', 18)}</button>

    <div class="modal__grid">
      <div class="modal__left">
        <h3 class="modal__eyebrow">Kenapa perlu masuk?</h3>
        <div class="comparebox">

          <div class="compare compare--guest">
            <p class="compare__head"><span class="compare__tag compare__tag--guest">Tanpa Masuk</span></p>
            <ul class="compare__list">
              ${baris('Cari rute aman')}
              ${baris('Lihat skor dan rincian penilaian')}
              ${baris('Lihat kualitas udara sepanjang rute')}
              ${baris('Lihat bukti kamera CCTV')}
              ${baris('Rute tersimpan', { aktif: false })}
              ${baris('Riwayat perjalanan', { aktif: false })}
              ${baris('Peringatan dini area rawan banjir', { aktif: false })}
              ${baris('Profil kesehatan', { aktif: false })}
            </ul>
          </div>

          <div class="compare compare--member">
            <p class="compare__head"><span class="compare__tag compare__tag--member">Sudah Masuk</span></p>
            <ul class="compare__list">
              ${baris('Semua fitur tanpa masuk')}
              ${baris('Profil kesehatan, tersimpan permanen di database', { sorot: true, ikonNama: 'i-wind' })}
              ${baris('Simpan rute favorit permanen ke database', { sorot: true, ikonNama: 'i-star' })}
              ${baris('Riwayat perjalanan otomatis & muat ulang cepat', { sorot: true, ikonNama: 'i-clock' })}
              ${baris('Peringatan dini area rawan banjir & hujan', { sorot: true, ikonNama: 'i-bell' })}
            </ul>
          </div>

        </div>
      </div>

      <div class="modal__right">
        <div class="modal__logo">${logoMark(54, 'modal')}</div>
        <h2 class="modal__title" id="loginTitle">Masuk ke JakSafe</h2>
        <p class="modal__sub" id="loginSub">Masuk dengan email dan kata sandi Anda.</p>

        <div class="auth-tabs" role="tablist" aria-label="Mode akun">
          <button type="button" class="auth-tab" role="tab" id="tabLoginMode" data-auth-tab="login" aria-selected="true">
            Masuk
          </button>
          <button type="button" class="auth-tab" role="tab" id="tabRegisterMode" data-auth-tab="register" aria-selected="false">
            Daftar Akun
          </button>
        </div>

        <form id="loginForm" novalidate>
          <div class="auth-alert" id="authError" role="alert" hidden></div>

          <div id="registerNameWrap" hidden>
            <label class="inputwrap" for="loginName">
              <span class="inputwrap__label">Nama Lengkap</span>
              <input class="inputwrap__input" type="text" id="loginName" name="name"
                     autocomplete="name" placeholder="Nama lengkap Anda">
              <span class="inputwrap__hint">Opsional — kosongkan untuk memakai awalan email.</span>
            </label>
          </div>

          <label class="inputwrap" for="loginEmail">
            <span class="inputwrap__label">Email</span>
            <input class="inputwrap__input" type="email" id="loginEmail" name="email"
                   autocomplete="username" inputmode="email" autocapitalize="none"
                   spellcheck="false" placeholder="nama@email.com" required>
          </label>

          <div class="inputwrap">
            <label class="inputwrap__label" for="loginPass">Kata Sandi</label>
            <div class="inputwrap__pass">
              <input class="inputwrap__input inputwrap__input--pass" type="password" id="loginPass" name="password"
                     autocomplete="current-password" minlength="6" spellcheck="false"
                     placeholder="Minimal 6 karakter" required>
              <button type="button" class="inputwrap__toggle press" id="btnTogglePass"
                      aria-label="Tampilkan kata sandi" aria-pressed="false" aria-controls="loginPass">
                ${ikon('i-eye', 17)}
              </button>
            </div>
            <span class="inputwrap__hint" id="loginPassHint">Minimal 6 karakter.</span>
          </div>

          <div id="registerSensitifWrap" hidden>
            <label class="switchrow" for="chkSensitif">
              <input type="checkbox" id="chkSensitif" checked>
              <span class="switchrow__teks">
                <strong>Saya sensitif terhadap polusi udara</strong>
                Bobot polusi dinaikkan saat rute dinilai.
              </span>
            </label>
          </div>

          <button class="btn btn--primary btn--block btn--lg press" type="submit" id="btnAuthSubmit" style="margin-top:var(--s4)">
            Masuk Sekarang
            <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
          </button>
        </form>

        <button class="btn btn--ghost btn--block press" id="btnGuest" style="margin-top:var(--s3)">
          Lanjut Sebagai Tamu
        </button>

        <p class="modal__fine">
          Akun dan rute tersimpan diamankan dengan otentikasi JWT dan enkripsi kata sandi di backend JakSafe.
        </p>
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
      <span class="usermenu__name" id="menuNama">Pengguna JakSafe</span>
      <span class="usermenu__mail" id="menuEmail"></span>
    </span>
  </div>

  <!-- Penanda ini tampil hanya kalau profil kesehatan benar benar aktif,
       karena pengaruhnya pada skor memang nyata. -->
  <div class="usermenu__badge" id="menuBadgeSensitif" hidden>
    ${ikon('i-wind', 15)}
    Profil kesehatan aktif, bobot polusi dinaikkan
  </div>

  <button type="button" class="usermenu__item usermenu__switchrow" id="btnToggleSensitif"
          role="switch" aria-checked="false" aria-describedby="menuSensitifSub">
    ${ikon('i-wind', 17)}
    <span class="usermenu__labelwrap">
      <span class="usermenu__label">Profil Kesehatan</span>
      <span class="usermenu__sub" id="menuSensitifSub">Prioritaskan udara bersih</span>
    </span>
    <span class="jswitch" aria-hidden="true"><span class="jswitch__thumb"></span></span>
  </button>
  <button type="button" class="usermenu__item" id="btnOpenHistory">
    ${ikon('i-clock', 17)} <span class="usermenu__text">Riwayat Perjalanan</span>
    <span class="usermenu__n" id="menuHistoryCount">0</span>
  </button>
  <button type="button" class="usermenu__item" id="btnOpenAlerts">
    ${ikon('i-bell', 17)} <span class="usermenu__text">Peringatan Area Rawan</span>
    <span class="usermenu__n" id="menuAlertCount">Pantau</span>
  </button>

  <div class="divider" style="margin:var(--s2) 0"></div>

  <button class="usermenu__item usermenu__item--out" id="btnLogout">
    ${ikon('i-logout', 17)} Keluar
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
      <h2 class="jmodal__title" id="historyTitle">Riwayat Perjalanan</h2>
      <p class="jmodal__sub">Pencarian rute terbaru yang tersimpan ke akun Anda</p>
    </div>
    <button type="button" class="jmodal__close press" data-close-dialog="historyDialog" aria-label="Tutup dialog riwayat">
      ${ikon('i-x', 17)}
    </button>
  </div>

  <div class="jmodal__toolbar">
    <span class="jmodal__count" id="historySummaryText">Memuat riwayat</span>
    <button type="button" class="jmodal__action press" id="btnClearHistory" hidden>
      Kosongkan Riwayat
    </button>
  </div>

  <div class="jmodal__body scroll-y">
    <ul class="jlist" id="historyList" aria-label="Daftar riwayat perjalanan"></ul>
  </div>
</dialog>

<dialog class="jmodal jmodal--wide" id="alertsDialog" closedby="any" aria-labelledby="alertsTitle">
  <div class="jmodal__head">
    <span class="jmodal__icon">${ikon('i-bell', 17)}</span>
    <div class="jmodal__titles">
      <h2 class="jmodal__title" id="alertsTitle">Peringatan Area Rawan</h2>
      <p class="jmodal__sub">Pantauan koridor genangan Jakarta berdasarkan curah hujan dan CCTV terkini</p>
    </div>
    <button type="button" class="jmodal__close press" data-close-dialog="alertsDialog" aria-label="Tutup dialog area rawan">
      ${ikon('i-x', 17)}
    </button>
  </div>

  <div class="alertsbar">
    <div class="alertsbar__top">
      <div class="aseg" id="alertRegionChips" role="group" aria-label="Filter wilayah DKI Jakarta">
        <button type="button" class="aseg__btn" data-region="semua" aria-pressed="true">Semua</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Pusat" aria-pressed="false">Jakpus</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Selatan" aria-pressed="false">Jaksel</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Barat" aria-pressed="false">Jakbar</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Timur" aria-pressed="false">Jaktim</button>
        <button type="button" class="aseg__btn" data-region="Jakarta Utara" aria-pressed="false">Jakut</button>
      </div>
      <button type="button" class="alertsbar__refresh press" id="btnRefreshAlerts">Muat ulang</button>
    </div>

    <div class="alertsbar__sub">
      <span class="alertsbar__meta" id="alertsMetaText">Memeriksa kondisi koridor Jakarta</span>
      <div class="alertsbar__pref" id="alertPrefBar">
        <label class="apref__chk">
          <input type="checkbox" id="chkAlertRouteAuto" checked>
          <span>Peringatan di rute</span>
        </label>
        <label class="apref__sev" for="selAlertSeverity">
          <span class="apref__label">Ambang</span>
          <select id="selAlertSeverity">
            <option value="pantau">Pantau+</option>
            <option value="waspada">Waspada+</option>
            <option value="siaga">Hanya Siaga</option>
          </select>
        </label>
      </div>
    </div>
  </div>

  <div class="jmodal__body jmodal__body--list scroll-y">
    <ul class="alist" id="alertsList" aria-label="Daftar peringatan area rawan Jakarta"></ul>
  </div>
</dialog>`;
}
