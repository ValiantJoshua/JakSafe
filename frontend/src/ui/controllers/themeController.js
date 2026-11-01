/*
   Pengendali tema dan ukuran teks.

   Tiga tema yang tersedia punya tugas berbeda, bukan sekadar pilihan rasa.

   Terang adalah tampilan utama sesuai Brand Guide.
   Gelap mengurangi silau saat dipakai malam hari di dalam kendaraan.
   Kontras dibuat untuk pengguna usia lanjut dan pengguna dengan
   penglihatan terbatas. Di tema ini seluruh rona tipis dimatikan, garis
   tepi dipertebal, bayangan dihapus, dan ketebalan garis ikon dinaikkan.
   Seluruh perubahan itu ditulis di tokens.css sebagai penimpaan variabel,
   jadi berkas ini cukup mengganti satu atribut pada elemen html.

   Pilihan pengguna disimpan di localStorage. Ini satu satunya hal yang
   bertahan setelah halaman dimuat ulang, dan sengaja dibungkus try catch
   karena localStorage bisa dimatikan di mode penjelajahan rahasia pada
   sebagian peramban. Kegagalan menyimpan tidak boleh membuat aplikasi
   berhenti, cukup berarti pilihannya tidak diingat.
*/

import { $, $$, setPressed } from '../../utils/dom.js';
import { STORAGE_KEYS } from '../../config/constants.js';

/** Membaca nilai tersimpan dengan aman. */
function baca(kunci) {
  try {
    return localStorage.getItem(kunci);
  } catch {
    return null;
  }
}

/** Menyimpan nilai dengan aman. */
function simpan(kunci, nilai) {
  try {
    localStorage.setItem(kunci, nilai);
  } catch {
    /* penyimpanan tidak tersedia, pilihan tidak diingat */
  }
}

/**
 * Memasang tema pada dokumen dan menandai tombol yang aktif.
 * @param {'terang'|'gelap'|'kontras'} tema
 */
function pasangTema(tema) {
  document.body.setAttribute('data-theme', tema);
  const tombol = $$('.themeswitch__btn');
  setPressed(tombol, tombol.find((t) => t.dataset.themeSet === tema));
  simpan(STORAGE_KEYS.tema, tema);
}

/**
 * Menyalakan atau mematikan mode teks besar.
 * @param {boolean} besar
 */
function pasangUkuranTeks(besar) {
  document.body.setAttribute('data-textsize', besar ? 'large' : 'normal');
  const tombol = $('#btnTextSize');
  if (tombol) tombol.setAttribute('aria-pressed', String(besar));
  simpan(STORAGE_KEYS.ukuranTeks, besar ? 'large' : 'normal');
}

/**
 * Memasang seluruh perilaku tema. Dipanggil sekali dari main.js.
 */
export function pasangPengendaliTema() {
  // Memulihkan pilihan sesi sebelumnya sebelum memasang pendengar, supaya
  // tampilan awal sudah benar dan tidak sempat berkedip ke tema bawaan.
  pasangTema(baca(STORAGE_KEYS.tema) || 'terang');
  pasangUkuranTeks(baca(STORAGE_KEYS.ukuranTeks) === 'large');

  for (const tombol of $$('.themeswitch__btn')) {
    tombol.addEventListener('click', () => pasangTema(tombol.dataset.themeSet));
  }

  const tombolTeks = $('#btnTextSize');
  tombolTeks?.addEventListener('click', () => {
    const sedangBesar = document.body.getAttribute('data-textsize') === 'large';
    pasangUkuranTeks(!sedangBesar);
  });
}
