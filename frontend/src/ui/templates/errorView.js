/*
   Layar galat.

   Judul dan isi pesannya tidak ditulis tetap di sini, melainkan diisi
   searchController sesuai jenis kegagalan. Membedakan pesan itu penting
   karena tindakan yang perlu diambil pengguna berbeda beda.

   Backend belum dijalankan   pengguna perlu menjalankan npm run dev di
                              folder backend
   OSRM tidak menemukan rute  pengguna perlu mengganti titik awal atau
                              tujuan, bukan menunggu
   Permintaan melewati waktu  pengguna cukup mencoba lagi

   Pesan tunggal seperti "terjadi kesalahan" akan menyembunyikan
   perbedaan itu dan membuat penelusuran masalah jadi lama.
*/

import { ikon } from '../icons.js';

/**
 * @returns {string} potongan HTML layar galat
 */
export function templateErrorView() {
  return `
<section id="viewError" hidden>
  <div class="card card--raised">
    <div class="errorbox">
      <span class="errorbox__icon">${ikon('i-alert', 30)}</span>
      <h2 class="errorbox__title" id="errTitle"></h2>
      <p class="errorbox__text" id="errText"></p>

      <!-- Petunjuk teknis. Hanya tampil untuk galat yang memang bisa
           ditindaklanjuti dari sisi pengembang, misalnya backend mati. -->
      <pre class="errorbox__hint" id="errHint" hidden></pre>

      <button class="btn btn--primary btn--block press" id="btnRetry">Coba Lagi</button>
    </div>
  </div>
</section>`;
}
