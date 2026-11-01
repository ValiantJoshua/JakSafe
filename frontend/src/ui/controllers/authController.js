/*
   Pengendali keadaan masuk.

   Sekali lagi perlu ditegaskan, backend belum punya sistem akun, jadi
   tidak ada satu pun permintaan jaringan yang dikirim dari berkas ini.
   Yang terjadi hanya perubahan keadaan di dalam peramban untuk satu sesi.

   Walaupun begitu, keadaan masuk punya akibat nyata pada hasil. Saat
   profil kesehatan menyala, bobot polusi naik dari nol koma tiga lima ke
   nol koma lima dan skor rute benar benar berubah. Jadi kalau pada sesi
   tanya jawab muncul pertanyaan apa gunanya fitur masuk di sini, itulah
   jawabannya, dan perubahannya bisa langsung diperagakan dengan mencari
   rute yang sama dua kali.

   Rute tersimpan juga hanya hidup selama sesi. Belum disimpan ke basis
   data karena endpoint untuk itu belum ada di backend.
*/

import { $, show, setText } from '../../utils/dom.js';
import { getState, setState, subscribe } from '../../state/appState.js';
import { toast } from '../toast.js';
import { ikon } from '../icons.js';

/** Membuka atau menutup jendela masuk. */
function bukaModal(buka) {
  const modal = $('#loginModal');
  if (!modal) return;
  show(modal, buka);
  if (buka) {
    // Fokus dipindahkan ke isian pertama supaya pengguna papan ketik
    // tidak perlu menekan tab berkali kali dari belakang halaman.
    setTimeout(() => $('#loginEmail')?.focus(), 60);
  }
}

/** Membuka atau menutup menu akun. */
function bukaMenu(buka) {
  show($('#userMenu'), buka);
}

/** Menyesuaikan seluruh bagian tampilan yang bergantung pada keadaan masuk. */
function gambarKeadaanMasuk(keadaan) {
  const { masuk, sensitifKesehatan } = keadaan;

  document.body.setAttribute('data-auth', masuk ? 'member' : 'guest');
  show($('#btnLogin'), !masuk);
  show($('#userChip'), masuk);
  show($('#promoBox'), !masuk);
  show($('#savedBox'), masuk);

  // Sapaan ikut berubah supaya perbedaan keadaan terasa, bukan hanya
  // berupa tombol yang berganti bentuk.
  const sapaan = $('#greetBox');
  if (sapaan) {
    sapaan.innerHTML = masuk
      ? `<h1 class="search__title">Halo, <em>Gerald</em></h1>
         <p class="search__sub">Profil kesehatan ${sensitifKesehatan ? 'aktif, bobot polusi dinaikkan saat rute dinilai' : 'nonaktif, bobot penilaian memakai nilai bawaan'}.</p>`
      : `<h1 class="search__title">Mau ke mana <em>hari ini?</em></h1>
         <p class="search__sub">Kami carikan rute yang aman dan sehat, bukan cuma yang paling cepat.</p>`;
  }

  show($('#menuBadgeSensitif'), masuk && sensitifKesehatan);
  setText($('#menuSensitifStat'), sensitifKesehatan ? 'Aktif' : 'Nonaktif');
}

/** Menggambar ulang daftar rute tersimpan. */
function gambarRuteTersimpan(daftar) {
  const wadah = $('#savedList');
  if (!wadah) return;

  if (daftar.length === 0) {
    wadah.innerHTML = '<p class="note">Belum ada rute yang disimpan pada sesi ini.</p>';
    return;
  }

  wadah.innerHTML = daftar.map((r) => `
    <div class="saveditem" data-status="${r.kunciStatus}">
      <span class="saveditem__dot"></span>
      <span class="saveditem__body">
        <span class="saveditem__name">${r.asal} ${ikon('i-arrow-r', 12)} ${r.tujuan}</span>
        <span class="saveditem__meta">Skor ${r.skor} · ${r.label}</span>
      </span>
    </div>`).join('');
}

/**
 * Memasang seluruh perilaku masuk dan keluar. Dipanggil sekali dari main.js.
 */
export function pasangPengendaliAuth() {
  $('#btnLogin')?.addEventListener('click', () => bukaModal(true));
  $('#btnPromoLogin')?.addEventListener('click', () => bukaModal(true));

  for (const tombol of document.querySelectorAll('[data-close-modal]')) {
    tombol.addEventListener('click', () => bukaModal(false));
  }

  // Tombol Escape menutup jendela. Perilaku ini diharapkan pengguna dan
  // termasuk syarat aksesibilitas untuk jendela bertipe dialog.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      bukaModal(false);
      bukaMenu(false);
    }
  });

  $('#loginForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const sensitif = $('#chkSensitif')?.checked ?? false;
    const email = $('#loginEmail')?.value?.trim() || 'pengguna@jaksafe.id';

    setState({ masuk: true, sensitifKesehatan: sensitif });
    setText($('#menuEmail'), email);
    bukaModal(false);
    toast(sensitif
      ? 'Berhasil masuk. Bobot polusi dinaikkan saat rute dinilai.'
      : 'Berhasil masuk.');
  });

  $('#btnGuest')?.addEventListener('click', () => {
    bukaModal(false);
    toast('Lanjut sebagai tamu. Fitur dasar tetap bisa dipakai.');
  });

  $('#userChip')?.addEventListener('click', (e) => {
    e.stopPropagation();
    bukaMenu($('#userMenu')?.hidden ?? false);
  });

  // Klik di luar menu menutup menu. Peristiwa di dalam menu dihentikan
  // penyebarannya supaya menekan tombol di dalamnya tidak ikut menutup.
  $('#userMenu')?.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => bukaMenu(false));

  $('#btnToggleSensitif')?.addEventListener('click', () => {
    const baru = !getState().sensitifKesehatan;
    setState({ sensitifKesehatan: baru });
    toast(baru
      ? 'Profil kesehatan aktif. Cari rute lagi untuk melihat pengaruhnya pada skor.'
      : 'Profil kesehatan nonaktif. Bobot kembali ke nilai bawaan.');
  });

  $('#btnLogout')?.addEventListener('click', () => {
    setState({ masuk: false, sensitifKesehatan: false, ruteTersimpan: [] });
    bukaMenu(false);
    toast('Sudah keluar.');
  });

  subscribe((keadaan, berubah) => {
    if (berubah.some((k) => ['masuk', 'sensitifKesehatan'].includes(k))) {
      gambarKeadaanMasuk(keadaan);
    }
    if (berubah.includes('ruteTersimpan')) {
      gambarRuteTersimpan(keadaan.ruteTersimpan);
    }
  });

  gambarKeadaanMasuk(getState());
  gambarRuteTersimpan(getState().ruteTersimpan);
}
