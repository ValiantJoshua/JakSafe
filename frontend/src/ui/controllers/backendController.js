/*
   Pengendali penanda sambungan backend.

   Fungsinya sederhana tetapi penting. Backend dan frontend dijalankan
   sebagai dua proses terpisah, dan yang paling sering terjadi saat
   mengerjakan proyek ini adalah menjalankan salah satunya saja lalu
   bingung kenapa tidak ada yang muncul. Penanda kecil di bilah atas
   menjawab itu sebelum pengguna sempat menekan tombol apa pun.

   Pemeriksaan dijalankan sekali saat halaman dibuka lalu diulang tiap
   lima belas detik. Jarak itu dipilih supaya backend yang baru saja
   dijalankan cepat terdeteksi, tanpa membanjiri log server dengan
   permintaan. Endpoint /api/health memang dibuat ringan, hanya membalas
   objek kecil tanpa menyentuh basis data atau layanan luar.

   Status TomTom ikut diperiksa di sini karena sifatnya sama, yaitu
   keterangan kesiapan layanan yang perlu diketahui sebelum mencari rute.
   Kalau kuncinya belum dipasang, pengguna tahu sejak awal bahwa angka
   waktu tempuh nanti belum dikalibrasi dengan kemacetan nyata.
*/

import { $, setText } from '../../utils/dom.js';
import { setState } from '../../state/appState.js';
import { cekKesehatan } from '../../api/healthApi.js';
import { cekStatusLaluLintas } from '../../api/trafficApi.js';

/** Jarak antar pemeriksaan dalam milidetik. */
const JARAK_PERIKSA_MS = 15_000;

/** Memperbarui tampilan penanda sesuai hasil pemeriksaan. */
function gambarPenanda(hidup, laluLintas) {
  const penanda = $('#konStat');
  if (!penanda) return;

  if (!hidup) {
    penanda.dataset.status = 'mati';
    setText($('#konStatTeks'), 'Backend tidak aktif');
    penanda.title = 'Jalankan npm run dev pada folder backend, porta 3001.';
    return;
  }

  if (!laluLintas.tersedia) {
    // Backend hidup tetapi layanan lalu lintas belum siap. Dibedakan
    // warnanya supaya terlihat bahwa ini bukan kegagalan, hanya data
    // tambahan yang belum ada.
    penanda.dataset.status = 'sebagian';
    setText($('#konStatTeks'), 'Backend aktif, TomTom mati');
    penanda.title = laluLintas.adaKunci
      ? 'Kunci TomTom terpasang tetapi kuota harian sudah habis. Penilaian memakai waktu dasar OSRM.'
      : 'Kunci TomTom belum dipasang di backend/.env. Penilaian memakai waktu dasar OSRM.';
    return;
  }

  penanda.dataset.status = 'hidup';
  setText($('#konStatTeks'), 'Backend aktif');
  penanda.title = `Sambungan normal. Pemakaian kuota TomTom hari ini ${laluLintas.terpakai} dari ${laluLintas.kuota}.`;
}

/** Menjalankan satu putaran pemeriksaan. */
async function periksaSekali() {
  const kesehatan = await cekKesehatan();

  // Status TomTom hanya ditanyakan kalau backend memang hidup, supaya
  // tidak ada permintaan sia sia saat server mati.
  const laluLintas = kesehatan.hidup
    ? await cekStatusLaluLintas()
    : { adaKunci: false, tersedia: false, terpakai: 0, kuota: 0 };

  setState({
    backend: { hidup: kesehatan.hidup, diperiksa: true, pesan: kesehatan.pesan },
    laluLintas,
  });
  gambarPenanda(kesehatan.hidup, laluLintas);
}

/**
 * Memasang pemeriksaan berkala. Dipanggil sekali dari main.js.
 * @returns {()=>void} fungsi untuk menghentikan pemeriksaan
 */
export function pasangPengendaliBackend() {
  periksaSekali();
  const penghitung = setInterval(periksaSekali, JARAK_PERIKSA_MS);

  // Saat tab disembunyikan, pemeriksaan dihentikan supaya tidak membebani
  // backend sia sia, lalu dijalankan sekali lagi begitu tab dibuka
  // kembali supaya penandanya langsung mutakhir.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) periksaSekali();
  });

  return () => clearInterval(penghitung);
}
