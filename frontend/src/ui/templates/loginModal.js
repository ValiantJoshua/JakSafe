/*
   Jendela masuk beserta perbandingan keuntungannya, dan menu akun.

   Perlu ditegaskan sejak awal supaya tidak salah dipahami saat demo.
   Backend JakSafe belum punya sistem akun. Tidak ada endpoint pendaftaran,
   tidak ada endpoint masuk, dan tidak ada penyimpanan pengguna. Jadi
   tombol Masuk di sini hanya mengubah keadaan di dalam peramban untuk
   satu sesi, tanpa mengirim apa pun ke mana pun. Kata sandi yang diketik
   tidak dikirim, tidak disimpan, dan tidak diperiksa.

   Meski begitu, satu keuntungan masuk sudah benar benar berfungsi, yaitu
   profil kesehatan. Ketika dinyalakan, bobot polusi dalam penilaian naik
   dari nol koma tiga lima menjadi nol koma lima, dan perubahan itu nyata
   mempengaruhi skor yang keluar. Lihat fungsi bobotUntuk pada
   src/domain/navigationService.js. Keuntungan lain seperti riwayat dan
   peringatan dini masih berupa rencana dan ditandai demikian.
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
              ${baris('Profil kesehatan', { aktif: false })}
            </ul>
          </div>

          <div class="compare compare--member">
            <p class="compare__head"><span class="compare__tag compare__tag--member">Sudah Masuk</span></p>
            <ul class="compare__list">
              ${baris('Semua fitur tanpa masuk')}
              ${baris('Profil kesehatan, bobot polusi dinaikkan saat rute dinilai', { sorot: true, ikonNama: 'i-wind' })}
              ${baris('Simpan rute favorit selama sesi ini', { sorot: true, ikonNama: 'i-star' })}
              ${baris('Riwayat perjalanan, menyusul setelah backend punya basis data', { sorot: true, ikonNama: 'i-clock' })}
              ${baris('Peringatan dini area rawan banjir, menyusul', { sorot: true, ikonNama: 'i-bell' })}
            </ul>
          </div>

        </div>
      </div>

      <div class="modal__right">
        <div class="modal__logo">${logoMark(54, 'modal')}</div>
        <h2 class="modal__title" id="loginTitle">Masuk ke JakSafe</h2>
        <p class="modal__sub">Gratis, cukup pakai email.</p>

        <form id="loginForm" novalidate>
          <label class="inputwrap">
            <span class="inputwrap__label">Email</span>
            <input class="inputwrap__input" type="email" id="loginEmail"
                   placeholder="nama@email.com" required>
          </label>
          <label class="inputwrap">
            <span class="inputwrap__label">Kata Sandi</span>
            <input class="inputwrap__input" type="password" id="loginPass"
                   placeholder="Minimal 8 karakter" required>
          </label>

          <label class="switchrow">
            <input type="checkbox" id="chkSensitif" checked>
            <span class="switchrow__teks">
              <strong>Saya sensitif terhadap polusi udara</strong>
              Bobot polusi dinaikkan saat rute dinilai.
            </span>
          </label>

          <button class="btn btn--primary btn--block btn--lg press" type="submit" style="margin-top:var(--s4)">
            Masuk Sekarang
            <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>
          </button>
        </form>

        <button class="btn btn--ghost btn--block press" id="btnGuest" style="margin-top:var(--s3)">
          Lanjut Sebagai Tamu
        </button>

        <p class="modal__fine">
          Backend belum punya sistem akun, jadi tombol ini hanya mengubah
          tampilan dan bobot penilaian di peramban. Tidak ada data yang dikirim.
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
    <span class="usermenu__ava">GS</span>
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

  <button class="usermenu__item" id="btnToggleSensitif">
    ${ikon('i-wind', 17)} Profil Kesehatan
    <span class="usermenu__n" id="menuSensitifStat">Aktif</span>
  </button>
  <button class="usermenu__item" disabled title="Menyusul setelah backend punya basis data">
    ${ikon('i-clock', 17)} Riwayat Perjalanan <span class="usermenu__n">Menyusul</span>
  </button>
  <button class="usermenu__item" disabled title="Menyusul">
    ${ikon('i-bell', 17)} Peringatan Area Rawan <span class="usermenu__n">Menyusul</span>
  </button>

  <div class="divider" style="margin:var(--s2) 0"></div>

  <button class="usermenu__item usermenu__item--out" id="btnLogout">
    ${ikon('i-logout', 17)} Keluar
  </button>
</div>`;
}
