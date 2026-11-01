/*
   Pengendali pergantian layar.

   Panel kiri punya empat layar yang saling menggantikan, yaitu pencarian,
   proses, hasil, dan galat. Panggung kanan menampilkan peta interaktif
   3D CesiumJS / 2D Normal Map beserta kendali layer (Traffic, CCTV, AQI)
   sepanjang waktu sehingga pengguna dapat menjelajahi peta Indonesia/Jakarta
   baik sebelum maupun sesudah mencari rute.
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
 * Menampilkan satu layar pada panel kiri dan menyembunyikan sisanya.
 * @param {'siap'|'memproses'|'hasil'|'galat'} nama
 */
function gantiLayar(nama) {
  for (const [kunci, pemilih] of Object.entries(LAYAR)) {
    show($(pemilih), kunci === nama);
  }

  // Pastikan panggung peta beserta kendali HUD selalu tampil
  show($('#mapHolder'), true);
  show($('#mapCtrlWrap'), true);
  show($('#legendWrap'), true);

  // Panel digulirkan ke atas setiap berganti layar.
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
