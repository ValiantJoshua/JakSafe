/*
   Tetapan global frontend JakSafe.

   Aturan main berkas ini, semua angka dan teks yang dipakai di lebih dari
   satu modul ditaruh di sini supaya tidak ada nilai ajaib yang tersebar.
   Nilai yang menirukan perilaku backend diberi penanda jelas pada
   komentarnya, supaya saat backend berubah ketahuan mana yang harus ikut
   disesuaikan.
*/

/**
 * Awalan semua jalur API.
 *
 * Nilainya "/api" karena dev server Vite meneruskan jalur itu ke
 * jaksafe-backend, lihat vite.config.js. Dengan begitu kode frontend tidak
 * pernah menuliskan http://localhost:3001 secara langsung, dan saat nanti
 * dipasang ke server sungguhan cukup mengubah satu variabel lingkungan.
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

/**
 * Batas waktu permintaan HTTP dalam milidetik, dipisah per jenis karena
 * beban kerjanya memang berbeda jauh.
 *
 * Angka ini dipilih sedikit lebih longgar daripada batas waktu di sisi
 * backend, supaya kalau terjadi kegagalan yang muncul adalah pesan error
 * asli dari backend, bukan pesan "timeout" dari frontend yang menutupi
 * penyebab sebenarnya. Batas backend, OSRM 12 detik dan Open-Meteo 10 detik,
 * lihat backend/src/services/osrm.js dan openMeteo.js.
 */
export const TIMEOUT_MS = {
  cepat: 8_000,       // health, status TomTom
  rute: 15_000,       // /api/route, memanggil OSRM publik
  udara: 13_000,      // /api/aqi, memanggil Open-Meteo
  cctv: 15_000,       // /api/cctv/frame, mengunduh gambar kamera
  navigasi: 60_000,   // /api/navigate, agen bisa memanggil banyak tool
};

/**
 * Ambang nilai dan label rute.
 *
 * CERMINAN BACKEND. Nilai ini harus sama persis dengan SCORE_LABELS pada
 * backend/src/scoring/routeScorer.js. Disalin ke sini supaya tampilan bisa
 * memberi warna pada hasil tanpa menunggu balasan server, misalnya saat
 * menggambar legenda peta sebelum ada rute sama sekali.
 */
export const SCORE_BANDS = [
  { key: 'aman', max: 29, label: 'AMAN', warna: 'var(--st-aman)' },
  { key: 'hati', max: 59, label: 'HATI-HATI', warna: 'var(--st-hati)' },
  { key: 'hindari', max: 100, label: 'HINDARI', warna: 'var(--st-hindari)' },
];

/**
 * Bobot tiap kriteria penilaian.
 *
 * CERMINAN BACKEND, lihat DEFAULT_WEIGHTS pada routeScorer.js. Dipakai
 * tampilan untuk menulis angka persen pada kartu Rincian Penilaian. Kalau
 * backend mengirim bobotnya sendiri di dalam breakdown, angka dari backend
 * yang dipakai dan nilai di sini hanya jadi cadangan.
 */
export const DEFAULT_WEIGHTS = {
  time: 0.40,
  aqi: 0.35,
  condition: 0.25,
};

/**
 * Skala PM2.5 untuk penanda pada kartu Kualitas Udara.
 *
 * Batas batasnya mengikuti pembagian yang dipakai backend saat
 * menormalkan PM2.5, yaitu bersih di bawah 12 dan sangat kotor di atas 150.
 * Empat pita di bawah ini hanya untuk keperluan tampilan, bukan untuk
 * menghitung skor.
 */
export const PM25_BANDS = [
  { sampai: 12, nama: 'Baik', kelas: 'aman' },
  { sampai: 55, nama: 'Sedang', kelas: 'hati' },
  { sampai: 150, nama: 'Sensitif', kelas: 'hati' },
  { sampai: Infinity, nama: 'Buruk', kelas: 'hindari' },
];

/**
 * Pengaturan pengambilan contoh titik di sepanjang rute.
 *
 * Backend membatasi /api/aqi maksimal dua belas titik dalam satu panggilan,
 * lihat MAX_POINTS pada openMeteo.js. Angka lima dipilih supaya masih jauh
 * di bawah batas, cukup mewakili rute kota, dan tidak membuat permintaan
 * jadi lambat. Titik untuk TomTom dibuat lebih sedikit karena tiap
 * panggilan segmen memakan jatah kuota harian.
 */
export const SAMPLING = {
  titikUdara: 5,
  titikLaluLintas: 3,
  radiusKameraM: 1200,
};

/** Moda perjalanan yang dikenal backend, lihat PROFILE_ALIASES pada osrm.js. */
export const PROFILES = [
  { key: 'car', nama: 'Mobil', ikon: 'i-car' },
  { key: 'bike', nama: 'Motor', ikon: 'i-bike' },
  { key: 'foot', nama: 'Jalan Kaki', ikon: 'i-walk' },
];

/**
 * Asal hasil navigasi.
 *
 * AGEN berarti hasil datang dari POST /api/navigate di backend.
 * PRATINJAU berarti endpoint itu belum ada, sehingga frontend merangkai
 * sendiri hasilnya dari endpoint data yang sudah jadi. Lihat
 * src/domain/navigationService.js untuk penjelasan lengkapnya.
 */
export const SUMBER_HASIL = {
  AGEN: 'backend-agent',
  PRATINJAU: 'frontend-preview',
};

/** Kunci penyimpanan lokal. Hanya untuk kenyamanan tampilan, bukan data penting. */
export const STORAGE_KEYS = {
  tema: 'jaksafe.tema',
  ukuranTeks: 'jaksafe.ukuranTeks',
};
