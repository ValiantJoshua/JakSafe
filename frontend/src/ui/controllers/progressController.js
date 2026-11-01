/*
   Pengendali layar proses.

   Tiap baris tahap punya tiga keadaan yang ditulis pada atribut data-state,
   yaitu wait untuk belum dimulai, run untuk sedang berjalan, dan done untuk
   selesai. CSS yang menerjemahkannya menjadi warna bulatan dan denyut.

   Lama tiap tahap diukur dengan performance.now, bukan dikira kira. Angka
   yang muncul di sebelah kanan baris adalah waktu nyata yang dibutuhkan
   panggilan itu. Karena diukur sungguhan, angkanya juga berguna saat
   menelusuri tahap mana yang menjadi penyebab pencarian terasa lambat.

   Untuk jalur agen, lihat catatan di templates/progressView.js. Backend
   mengerjakan semuanya dalam satu panggilan sehingga frontend tidak punya
   informasi per tahap. Dalam keadaan itu seluruh baris ditandai berjalan
   sekaligus dan keterangannya diganti, bukan dipalsukan satu per satu.
*/

import { $, $$, setText } from '../../utils/dom.js';
import { formatLama } from '../../utils/format.js';

/** Penanda waktu mulai tiap tahap. */
let waktuMulai = {};

/** Mengembalikan semua baris tahap ke keadaan awal. */
export function resetTahap() {
  waktuMulai = {};
  for (const baris of $$('.stage')) {
    baris.dataset.state = 'wait';
    setText(baris.querySelector('.stage__time'), '');
  }
  setText($('#progressSub'), 'Mengambil data dari backend JakSafe');
}

/**
 * Menandai satu tahap sedang berjalan, sekaligus menutup tahap sebelumnya.
 *
 * Penutupan tahap sebelumnya dikerjakan di sini, bukan dipanggil terpisah,
 * supaya pemanggil cukup mengabarkan "sekarang masuk tahap ini" dan tidak
 * perlu mengingat tahap mana yang tadi dibuka.
 *
 * @param {string} idTahap
 */
export function tandaiTahapBerjalan(idTahap) {
  const sekarang = performance.now();

  for (const baris of $$('.stage')) {
    if (baris.dataset.state !== 'run') continue;
    baris.dataset.state = 'done';
    const mulai = waktuMulai[baris.dataset.stage];
    if (mulai) setText(baris.querySelector('.stage__time'), formatLama(sekarang - mulai));
  }

  const target = $(`.stage[data-stage="${idTahap}"]`);
  if (target) {
    target.dataset.state = 'run';
    waktuMulai[idTahap] = sekarang;
  }
}

/** Menutup seluruh tahap, dipanggil saat hasil sudah siap. */
export function tutupSemuaTahap() {
  const sekarang = performance.now();
  for (const baris of $$('.stage')) {
    if (baris.dataset.state === 'run') {
      const mulai = waktuMulai[baris.dataset.stage];
      if (mulai) setText(baris.querySelector('.stage__time'), formatLama(sekarang - mulai));
    }
    baris.dataset.state = 'done';
  }
}

/**
 * Mengubah tampilan menjadi mode agen, yaitu satu panggilan panjang ke
 * backend tanpa kabar kemajuan per tahap.
 */
export function modeAgen() {
  for (const baris of $$('.stage')) baris.dataset.state = 'run';
  setText($('#progressSub'), 'Agen di backend sedang memanggil tool dan menilai rute');
}
