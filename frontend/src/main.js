/*
   Titik masuk aplikasi.

   Berkas ini yang dipanggil app.html dan satu satunya yang mengimpor CSS.
   Vite menggabungkan seluruh berkas CSS yang diimpor di sini menjadi satu
   berkas gaya, jadi tidak ada lagi deretan tag link di dokumen HTML.

   Urutan impor CSS BERPENGARUH dan tidak boleh diacak.
     tokens      variabel warna, jarak, dan tema, wajib paling atas karena
                 seluruh berkas lain membacanya
     base        penyetelan dasar dan reset
     layout      kerangka halaman
     components  tombol, kartu, lencana, dan sejenisnya
     panels      isi panel kiri dan panggung kanan
     effects     animasi dan efek kedalaman
     parts       bagian yang lahir bersama penyambungan ke backend
     responsive  penyesuaian layar, wajib paling bawah supaya bisa
                 menimpa aturan di atasnya tanpa perlu menaikkan
                 kekhususan pemilih

   Urutan pemasangan modul juga berpengaruh. Kerangka tampilan dirakit
   lebih dulu, baru pengendali dipasang, karena seluruh pengendali mencari
   elemennya lewat id dan id itu baru ada setelah perakitan selesai.
*/

import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/panels.css';
import './styles/effects.css';
import './styles/parts.css';
import './styles/responsive.css';

import { rakitTampilan } from './ui/shell.js';
import { pasangEfekMiring } from './ui/tilt.js';
import { pasangPengendaliTema } from './ui/controllers/themeController.js';
import { pasangPengendaliTampilan } from './ui/controllers/viewController.js';
import { pasangPengendaliBackend } from './ui/controllers/backendController.js';
import { pasangPengendaliAuth } from './ui/controllers/authController.js';
import { pasangPengendaliPencarian } from './ui/controllers/searchController.js';
import { pasangPengendaliHasil } from './ui/controllers/resultController.js';

function mulai() {
  const wadah = document.getElementById('app');
  if (!wadah) {
    // Tidak seharusnya terjadi, tetapi kalau app.html diubah dan div#app
    // terhapus, pesan ini jauh lebih mudah dilacak daripada halaman kosong.
    console.error('[JakSafe] Elemen #app tidak ditemukan di app.html.');
    return;
  }

  rakitTampilan(wadah);

  pasangPengendaliTema();
  pasangPengendaliTampilan();
  pasangPengendaliAuth();
  pasangPengendaliPencarian();
  pasangPengendaliHasil();
  pasangPengendaliBackend();
  pasangEfekMiring();
}

// Modul bertipe module selalu ditunda sampai dokumen selesai diurai, jadi
// pemeriksaan ini hanya penjagaan tambahan kalau berkas ini nanti dimuat
// dengan cara lain.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mulai, { once: true });
} else {
  mulai();
}
