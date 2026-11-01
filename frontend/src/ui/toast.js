/*
   Pemberitahuan singkat di sudut layar.

   Dipakai untuk kabar yang tidak perlu menghentikan pekerjaan pengguna,
   misalnya rute berhasil disimpan atau profil kesehatan dinyalakan. Kabar
   yang menghentikan pekerjaan, seperti pencarian gagal, tidak memakai ini
   melainkan layar galat, karena pesan yang hilang sendiri setelah beberapa
   detik tidak cocok untuk hal yang perlu ditindaklanjuti.

   Elemen toast memakai atribut aria-live sehingga pembaca layar ikut
   mengumumkan isinya tanpa memindahkan fokus pengguna.
*/

import { $ } from '../utils/dom.js';

let penghitung = null;

/**
 * Menampilkan pemberitahuan singkat.
 *
 * @param {string} teks
 * @param {number} [lamaMs=2600]
 */
export function toast(teks, lamaMs = 2600) {
  const kotak = $('#toast');
  const isi = $('#toastText');
  if (!kotak || !isi) return;

  isi.textContent = teks;
  kotak.hidden = false;

  // Kelas ditambahkan pada bingkai berikutnya supaya transisi CSS sempat
  // melihat keadaan awal dan animasi masuknya benar benar berjalan.
  requestAnimationFrame(() => kotak.classList.add('is-on'));

  clearTimeout(penghitung);
  penghitung = setTimeout(() => {
    kotak.classList.remove('is-on');
    // Disembunyikan setelah animasi keluar selesai supaya tidak berkedip.
    setTimeout(() => { kotak.hidden = true; }, 240);
  }, lamaMs);
}
