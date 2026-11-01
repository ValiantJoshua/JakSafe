/*
   Pengendali pergantian layar.

   Panel kiri punya empat layar yang saling menggantikan, yaitu pencarian,
   proses, hasil, dan galat. Panggung kanan ikut berganti antara banner
   sambutan dan tempat peta.

   Semua pergantian itu dijalankan dari satu tempat ini, bukan tersebar di
   tiap pengendali. Dengan begitu tidak mungkin terjadi dua layar tampil
   bersamaan, dan menambah layar baru nanti cukup menyentuh satu berkas.

   Pergantian dipicu lewat langganan ke appState, bukan dipanggil langsung
   oleh pengendali lain. Jadi pengendali pencarian cukup menulis keadaan
   baru, dan tampilan menyesuaikan sendiri. Pola ini yang mencegah tampilan
   dan keadaan berbeda isi.
*/

import { $, show } from '../../utils/dom.js';
import { subscribe } from '../../state/appState.js';

/** Peta nama keadaan tampilan ke id elemen layarnya. */
const LAYAR = {
  siap: '#viewSearch',
  memproses: '#viewProgress',
  hasil: '#viewResult',
  galat: '#viewError',
};

/**
 * Menampilkan satu layar dan menyembunyikan sisanya.
 * @param {'siap'|'memproses'|'hasil'|'galat'} nama
 */
function gantiLayar(nama) {
  for (const [kunci, pemilih] of Object.entries(LAYAR)) {
    show($(pemilih), kunci === nama);
  }

  // Banner sambutan hanya pada layar pencarian. Begitu pencarian dimulai,
  // panggung berganti ke tempat peta supaya perhatian pindah ke hasil.
  const diAwal = nama === 'siap';
  show($('#hero'), diAwal);
  show($('#mapHolder'), !diAwal);
  show($('#mapCtrlWrap'), !diAwal);
  show($('#legendWrap'), nama === 'hasil');

  // Panel digulirkan ke atas setiap berganti layar. Tanpa ini, pengguna
  // yang tadi menggulir sampai bawah kartu hasil akan mendapati layar
  // baru sudah dalam keadaan tergulir dan mengira isinya terpotong.
  const panel = $('#panelBody');
  if (panel) panel.scrollTop = 0;
}

/**
 * Memasang langganan pergantian layar. Dipanggil sekali dari main.js.
 */
export function pasangPengendaliTampilan() {
  subscribe((keadaan, berubah) => {
    if (berubah.includes('tampilan')) gantiLayar(keadaan.tampilan);
  });

  // Dijalankan sekali di awal supaya layar pertama sesuai keadaan awal.
  gantiLayar('siap');
}
