/*
   Penyimpan keadaan aplikasi.

   Proyek ini tidak memakai pustaka pengelola keadaan apa pun, jadi berkas
   ini yang memegang satu satunya sumber kebenaran. Polanya sederhana,
   sebuah objek keadaan ditambah daftar pendengar yang dipanggil setiap kali
   keadaan berubah.

   Kenapa tidak membiarkan tiap modul menyimpan keadaannya sendiri. Karena
   satu potong keadaan sering dipakai beberapa bagian sekaligus. Status
   masuk, misalnya, menentukan isi sapaan di panel kiri, tampilnya daftar
   rute tersimpan, bentuk tombol di topbar, dan bobot polusi saat penilaian.
   Kalau tiap bagian menyimpan salinannya sendiri, cepat atau lambat akan
   ada bagian yang tertinggal dan menampilkan keadaan lama.

   Keadaan di sini hanya untuk satu sesi di peramban. Tidak ada yang
   dikirim ke mana pun. Satu satunya hal yang bertahan setelah halaman
   dimuat ulang adalah pilihan tema dan ukuran teks, dan itu disimpan
   terpisah lewat localStorage pada themeController.
*/

/**
 * @typedef {object} Keadaan
 * @property {'siap'|'memproses'|'hasil'|'galat'} tampilan  layar yang sedang aktif
 * @property {{hidup:boolean, diperiksa:boolean, pesan?:string}} backend
 * @property {{adaKunci:boolean, tersedia:boolean, terpakai:number, kuota:number}} laluLintas
 * @property {boolean} masuk                 pengguna sedang masuk
 * @property {boolean} sensitifKesehatan     profil kesehatan dinyalakan
 * @property {string} idAsal                 id tempat pada jakartaPlaces
 * @property {string} idTujuan
 * @property {'car'|'bike'|'foot'} profil
 * @property {string|null} tahapAktif        id tahap yang sedang berjalan
 * @property {object|null} hasil             HasilNavigasi terakhir
 * @property {string|null} pesanGalat
 * @property {object[]} ruteTersimpan
 */

/** @type {Keadaan} */
const keadaan = {
  tampilan: 'siap',
  backend: { hidup: false, diperiksa: false },
  laluLintas: { adaKunci: false, tersedia: false, terpakai: 0, kuota: 0 },
  masuk: false,
  sensitifKesehatan: false,
  idAsal: 'sudirman',
  idTujuan: 'monas',
  profil: 'car',
  tahapAktif: null,
  hasil: null,
  pesanGalat: null,
  ruteTersimpan: [],
};

/** @type {Set<(keadaan:Keadaan, kunciBerubah:string[])=>void>} */
const pendengar = new Set();

/**
 * Membaca salinan keadaan sekarang.
 * Yang dikembalikan salinan dangkal supaya pemanggil tidak bisa mengubah
 * keadaan diam diam tanpa lewat setState, sehingga setiap perubahan pasti
 * memicu pembaruan tampilan.
 *
 * @returns {Keadaan}
 */
export function getState() {
  return { ...keadaan };
}

/**
 * Mengubah sebagian keadaan lalu memberi tahu semua pendengar.
 *
 * Kunci yang nilainya tidak benar benar berubah diabaikan. Penyaringan ini
 * mencegah pembaruan tampilan yang sia sia, misalnya saat pemeriksaan
 * kesehatan backend berjalan tiap sepuluh detik dan hasilnya selalu sama.
 *
 * @param {Partial<Keadaan>} sebagian
 */
export function setState(sebagian) {
  const berubah = [];
  for (const [kunci, nilai] of Object.entries(sebagian)) {
    if (!Object.is(keadaan[kunci], nilai)) {
      keadaan[kunci] = nilai;
      berubah.push(kunci);
    }
  }
  if (berubah.length === 0) return;
  for (const fn of pendengar) fn(getState(), berubah);
}

/**
 * Mendaftarkan pendengar perubahan keadaan.
 *
 * @param {(keadaan:Keadaan, kunciBerubah:string[])=>void} fn
 * @returns {()=>void} fungsi untuk berhenti mendengarkan
 */
export function subscribe(fn) {
  pendengar.add(fn);
  return () => pendengar.delete(fn);
}
