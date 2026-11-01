/*
   Layar proses, tampil selama rute sedang dicari.

   Daftar tahapnya dibangun dari TAHAP di domain/navigationService.js,
   bukan ditulis ulang di sini. Ini disengaja supaya tahap yang terlihat
   di layar selalu sama dengan tahap yang benar benar dijalankan. Kalau
   nanti ada tahap baru, cukup ditambah di satu tempat dan tampilannya
   ikut berubah sendiri.

   Catatan untuk jalur agen. Ketika POST /api/navigate sudah berfungsi,
   seluruh pekerjaan terjadi dalam satu panggilan sehingga frontend tidak
   bisa tahu tahap mana yang sedang berlangsung di sisi backend. Untuk
   keadaan itu progressController menandai seluruh tahap sebagai sedang
   berjalan dan menampilkan keterangan bahwa agen sedang bekerja, bukan
   memalsukan kemajuan satu per satu.
*/

import { ikon } from '../icons.js';
import { TAHAP } from '../../domain/navigationService.js';

/** Satu baris tahap. Nomor urutnya dihitung dari posisi di daftar. */
function barisTahap(tahap, nomor) {
  return `
<li class="stage" data-state="wait" data-stage="${tahap.id}">
  <span class="stage__bullet">${nomor}</span>
  <span class="stage__name">${tahap.nama}</span>
  <span class="stage__time"></span>
</li>`;
}

/**
 * @returns {string} potongan HTML layar proses
 */
export function templateProgressView() {
  return `
<section id="viewProgress" hidden>
  <div class="card card--raised">
    <div class="progress__head">
      <div class="progress__ring"><span class="progress__ringcore"></span></div>
      <h2 class="progress__title">Sedang menganalisis rute</h2>
      <p class="progress__sub" id="progressSub">Mengambil data dari backend JakSafe</p>
    </div>

    <ul class="stages" id="stageList">
      ${TAHAP.map((t, i) => barisTahap(t, i + 1)).join('')}
    </ul>

    <div class="divider"></div>

    <!-- Tombol ini benar benar membatalkan permintaan lewat AbortController,
         bukan sekadar menyembunyikan layar. Lihat searchController. -->
    <button class="btn btn--ghost btn--block btn--sm press" id="btnCancel">
      ${ikon('i-x', 15)} Batalkan
    </button>
  </div>
</section>`;
}
