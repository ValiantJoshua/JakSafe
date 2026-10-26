/*
   Penerjemah skor menjadi label, warna, dan kalimat.

   Backend sudah mengirim label dan warna di dalam objek score, jadi
   tampilan seharusnya memakai yang dari backend. Berkas ini dipakai untuk
   dua keadaan yang tidak terjangkau oleh balasan itu.

   Pertama, saat belum ada hasil sama sekali. Legenda warna di pojok peta
   dan kartu rute populer perlu tahu warna tiap pita skor sebelum ada rute
   yang dinilai.

   Kedua, saat backend mengirim skor tetapi tanpa label, misalnya pada
   daftar rute pilihan lain yang mungkin dibuat ringkas.

   Nilai ambangnya diambil dari SCORE_BANDS di config/constants.js yang
   mencerminkan SCORE_LABELS milik backend.
*/

import { SCORE_BANDS } from '../config/constants.js';

/**
 * @typedef {object} PitaSkor
 * @property {'aman'|'hati'|'hindari'} key
 * @property {string} label
 * @property {string} warna  nilai siap pakai untuk CSS
 */

/**
 * Menentukan pita skor dari sebuah nilai.
 * Nilai di luar jangkauan nol sampai seratus dijepit lebih dulu supaya
 * data yang aneh dari backend tidak membuat tampilan kehilangan warna.
 *
 * @param {number} skor
 * @returns {PitaSkor}
 */
export function pitaDariSkor(skor) {
  const nilai = Math.max(0, Math.min(100, Number(skor) || 0));
  return SCORE_BANDS.find((b) => nilai <= b.max) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

/**
 * Mengubah label teks dari backend menjadi kunci pita.
 * Backend mengirim label dalam huruf besar, misalnya "HATI-HATI".
 *
 * @param {string} label
 * @returns {'aman'|'hati'|'hindari'}
 */
export function kunciDariLabel(label) {
  const teks = String(label || '').toUpperCase();
  if (teks === 'AMAN') return 'aman';
  if (teks === 'HINDARI') return 'hindari';
  return 'hati';
}

/**
 * Kalimat pembuka yang menerangkan arti skor kepada pengguna awam.
 *
 * Kalimat ini sengaja tidak menyebut angka, karena angkanya sudah terlihat
 * besar di tengah kartu. Yang dibutuhkan pengguna di sini adalah tindakan
 * apa yang sebaiknya diambil.
 *
 * @param {'aman'|'hati'|'hindari'} kunci
 * @returns {string}
 */
export function kalimatArti(kunci) {
  if (kunci === 'aman') return 'Rute ini layak dilewati sekarang.';
  if (kunci === 'hindari') return 'Sebaiknya cari waktu atau rute lain.';
  return 'Masih bisa dilewati, tetapi perlu kewaspadaan.';
}

/**
 * Menyusun alasan rekomendasi dari objek penilaian yang dikirim backend.
 *
 * Aturannya bertingkat supaya kalimatnya tidak pernah bertentangan dengan
 * label yang tertulis besar di atasnya.
 *
 * Pertama, faktor yang nilainya melewati lima puluh disebut satu per satu,
 * karena itulah yang benar benar menyeret skor naik.
 *
 * Kedua, kalau tidak ada yang melewati lima puluh tetapi skor akhirnya
 * sudah masuk pita hati-hati atau hindari, yang disebut adalah faktor
 * penyumbang terbesar. Tanpa aturan kedua ini akan muncul keadaan aneh
 * berupa label HATI-HATI yang alasannya berbunyi tidak ada hambatan.
 *
 * Ketiga, barulah kalimat yang menyatakan rute memang lapang.
 *
 * @param {object} score  objek score dari backend, atau bagian breakdown-nya
 * @returns {string}
 */
export function susunAlasan(score) {
  // Menerima dua bentuk, objek score utuh atau langsung bagian breakdown,
  // supaya pemanggil lama tidak rusak.
  const breakdown = score?.breakdown || score;
  if (!breakdown?.time) return 'Penilaian belum lengkap untuk rute ini.';

  const totalScore = Number(score?.totalScore);
  const bagian = [];
  const { time, aqi, condition } = breakdown;

  if (condition?.roadClosure) {
    bagian.push('ada ruas yang dilaporkan tertutup');
  } else if (Number(condition?.score) >= 50) {
    bagian.push(condition.floodDetected
      ? 'kamera menangkap genangan di ruas jalan'
      : 'kondisi jalan sedang padat');
  }

  if (Number(aqi?.score) >= 50) {
    const pm = Number(aqi.pm2_5);
    bagian.push(Number.isFinite(pm)
      ? `kualitas udara kurang baik dengan PM2.5 sekitar ${Math.round(pm)}`
      : 'kualitas udara kurang baik');
  }

  if (Number(time?.score) >= 50) {
    const menit = Number(time.effectiveDurationMin);
    bagian.push(Number.isFinite(menit)
      ? `waktu tempuh cukup lama, sekitar ${menit} menit`
      : 'waktu tempuh cukup lama');
  }

  if (bagian.length === 0) {
    // Skor sudah di luar pita aman walaupun tidak ada satu faktor pun yang
    // menonjol. Artinya ketiganya sama sama sedang, jadi yang disebut
    // adalah penyumbang terbesarnya supaya alasannya tetap masuk akal.
    if (Number.isFinite(totalScore) && totalScore > 29) {
      const urut = [
        { nama: 'waktu tempuh', nilai: Number(time?.score) || 0 },
        { nama: 'tingkat polusi udara', nilai: Number(aqi?.score) || 0 },
        { nama: 'kondisi jalan', nilai: Number(condition?.score) || 0 },
      ].sort((a, b) => b.nilai - a.nilai);
      return `Tidak ada satu faktor pun yang menonjol, tetapi ketiganya sama sama sedang sehingga skornya terangkat. Penyumbang terbesarnya adalah ${urut[0].nama}.`;
    }
    return 'Tidak ada hambatan berarti pada rute ini. Waktu tempuh wajar, udara masih layak, dan kondisi jalan normal.';
  }

  const gabungan = bagian.length === 1
    ? bagian[0]
    : `${bagian.slice(0, -1).join(', ')}, dan ${bagian[bagian.length - 1]}`;

  return `Skor rute ini dipengaruhi oleh ${gabungan}.`;
}
