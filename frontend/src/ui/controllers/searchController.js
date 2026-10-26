/*
   Pengendali layar pencarian.

   Berkas ini yang menyambungkan tombol di layar dengan alur di
   domain/navigationService.js. Isinya empat kelompok perilaku, yaitu
   kotak isian beserta daftar sarannya, pemilihan moda perjalanan,
   penekanan tombol cari lengkap dengan pembatalan, dan penanganan galat.

   Soal pembatalan perlu dicatat. Setiap pencarian membuat AbortController
   baru dan menyimpannya di variabel modul. Tombol Batalkan memanggil
   abort pada pengendali itu, dan pencarian baru juga membatalkan yang
   lama lebih dulu. Tanpa penjagaan ini, pengguna yang menekan tombol dua
   kali berturut turut bisa melihat hasil pencarian pertama menimpa hasil
   pencarian kedua, karena jawaban yang lebih lambat datang belakangan.
*/

import { $, $$, show, setPressed, setText } from '../../utils/dom.js';
import { getState, setState } from '../../state/appState.js';
import { findPlaceById, searchPlaces, DEFAULT_TRIP } from '../../config/jakartaPlaces.js';
import { cariRute } from '../../domain/navigationService.js';
import { SEBAB } from '../../api/httpClient.js';
import { SUMBER_HASIL } from '../../config/constants.js';
import { resetTahap, tandaiTahapBerjalan, tutupSemuaTahap, modeAgen } from './progressController.js';
import { gambarHasil } from './resultController.js';
import { toast } from '../toast.js';

/** Pengendali pembatalan untuk pencarian yang sedang berjalan. */
let pengendaliAktif = null;

/** Menuliskan nama tempat ke kotak isian berdasarkan id. */
function isiKotak(idInput, idTempat) {
  const tempat = findPlaceById(idTempat);
  const kotak = $(idInput);
  if (kotak && tempat) kotak.value = tempat.nama;
}

/** Menutup seluruh daftar saran yang sedang terbuka. */
function tutupSemuaSaran() {
  for (const daftar of $$('.saran')) {
    daftar.hidden = true;
    daftar.previousElementSibling?.setAttribute?.('aria-expanded', 'false');
  }
}

/**
 * Memasang perilaku satu kotak isian beserta daftar sarannya.
 *
 * Daftar saran dibangun ulang tiap kali teks berubah. Jumlahnya kecil,
 * paling banyak enam baris, jadi membangun ulang jauh lebih sederhana
 * daripada menyunting baris yang sudah ada, dan tidak terasa lambat.
 *
 * @param {string} idInput
 * @param {string} idSaran
 * @param {'idAsal'|'idTujuan'} kunciKeadaan
 */
function pasangKotakIsian(idInput, idSaran, kunciKeadaan) {
  const kotak = $(idInput);
  const daftar = $(idSaran);
  if (!kotak || !daftar) return;

  const gambarSaran = () => {
    const hasil = searchPlaces(kotak.value);
    if (hasil.length === 0) {
      daftar.innerHTML = '<p class="saran__kosong">Tidak ada lokasi yang cocok.</p>';
    } else {
      daftar.innerHTML = hasil.map((p) => `
        <button class="saran__item" role="option" data-tempat="${p.id}">
          <span class="saran__nama">${p.nama}</span>
          <span class="saran__area">${p.area}</span>
        </button>`).join('');
    }
    daftar.hidden = false;
    kotak.setAttribute('aria-expanded', 'true');
  };

  kotak.addEventListener('focus', gambarSaran);
  kotak.addEventListener('input', gambarSaran);

  // Pemilihan ditangkap di tingkat daftar, bukan dipasang satu per satu
  // pada tiap baris, karena barisnya dibangun ulang terus menerus.
  daftar.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.saran__item');
    if (!item) return;
    // mousedown dipakai, bukan click, supaya pilihan terdaftar sebelum
    // kotak isian kehilangan fokus dan daftarnya tertutup.
    e.preventDefault();
    const tempat = findPlaceById(item.dataset.tempat);
    if (!tempat) return;
    kotak.value = tempat.nama;
    setState({ [kunciKeadaan]: tempat.id });
    daftar.hidden = true;
    kotak.setAttribute('aria-expanded', 'false');
  });

  kotak.addEventListener('blur', () => {
    // Ditunda sebentar supaya klik pada daftar sempat diproses.
    setTimeout(() => {
      daftar.hidden = true;
      kotak.setAttribute('aria-expanded', 'false');
      // Teks yang tidak cocok dengan daftar dikembalikan ke pilihan
      // terakhir yang sah, supaya kotak tidak pernah berisi tempat yang
      // tidak punya koordinat.
      const sekarang = findPlaceById(getState()[kunciKeadaan]);
      if (sekarang && kotak.value !== sekarang.nama) kotak.value = sekarang.nama;
    }, 120);
  });
}

/** Menyusun pesan galat yang sesuai jenis kegagalannya. */
function pesanGalat(galat) {
  if (galat?.sebab === SEBAB.TIDAK_TERHUBUNG) {
    return {
      judul: 'Backend JakSafe tidak dapat dihubungi',
      teks: 'Frontend berjalan, tetapi tidak ada yang menjawab di sisi backend. '
        + 'Pencarian rute, data udara, dan kamera semuanya melewati backend, jadi tidak ada yang bisa ditampilkan.',
      petunjuk: 'Buka terminal baru, masuk ke folder backend, lalu jalankan\n  npm install\n  npm run dev\n\nPastikan porta 3001 sesuai dengan VITE_BACKEND_ORIGIN pada .env frontend.',
    };
  }
  if (galat?.sebab === SEBAB.WAKTU_HABIS) {
    return {
      judul: 'Permintaan melewati batas waktu',
      teks: 'Backend menjawab terlalu lama. Biasanya karena layanan luar seperti OSRM sedang lambat. Coba lagi beberapa saat lagi.',
      petunjuk: null,
    };
  }
  if (galat?.status === 404) {
    return {
      judul: 'Rute tidak ditemukan',
      teks: 'Layanan rute tidak menemukan jalan yang menghubungkan kedua titik dengan moda yang dipilih. Coba ganti titik atau pilih moda perjalanan lain.',
      petunjuk: null,
    };
  }
  return {
    judul: 'Pencarian rute gagal',
    teks: galat?.message || 'Terjadi kegagalan yang tidak dikenali saat mencari rute.',
    petunjuk: galat?.jalur ? `Jalur yang gagal\n  ${galat.jalur}` : null,
  };
}

/** Menampilkan layar galat beserta pesannya. */
function tampilkanGalat(galat) {
  const { judul, teks, petunjuk } = pesanGalat(galat);
  setText($('#errTitle'), judul);
  setText($('#errText'), teks);
  const kotakPetunjuk = $('#errHint');
  if (kotakPetunjuk) {
    kotakPetunjuk.textContent = petunjuk || '';
    show(kotakPetunjuk, Boolean(petunjuk));
  }
  setState({ tampilan: 'galat', pesanGalat: teks });
}

/** Menjalankan satu pencarian rute dari awal sampai hasil atau galat. */
async function jalankanPencarian() {
  const keadaan = getState();
  const asal = findPlaceById(keadaan.idAsal);
  const tujuan = findPlaceById(keadaan.idTujuan);

  if (!asal || !tujuan) {
    toast('Pilih titik awal dan tujuan dulu.');
    return;
  }
  if (asal.id === tujuan.id) {
    toast('Titik awal dan tujuan tidak boleh sama.');
    return;
  }

  // Pencarian sebelumnya dihentikan supaya jawabannya tidak menimpa yang baru.
  pengendaliAktif?.abort();
  pengendaliAktif = new AbortController();

  resetTahap();
  setState({ tampilan: 'memproses', hasil: null, pesanGalat: null });

  // Kalau endpoint agen ternyata aktif, tahap per tahap tidak akan pernah
  // dilaporkan. Penanda ini yang membedakannya, dan dipakai untuk memilih
  // tampilan progres yang jujur.
  let adaKabarTahap = false;

  try {
    const hasil = await cariRute({
      asal,
      tujuan,
      profil: keadaan.profil,
      sensitifKesehatan: keadaan.masuk && keadaan.sensitifKesehatan,
      signal: pengendaliAktif.signal,
      saatTahap: (idTahap) => {
        adaKabarTahap = true;
        tandaiTahapBerjalan(idTahap);
      },
    });

    if (!adaKabarTahap && hasil.sumber === SUMBER_HASIL.AGEN) modeAgen();
    tutupSemuaTahap();

    // Nama tempat ditempelkan ke hasil supaya layar hasil tidak perlu
    // mencarinya lagi ke daftar tempat.
    gambarHasil({ ...hasil, asal, tujuan });
    setState({ tampilan: 'hasil', hasil: { ...hasil, asal, tujuan } });
  } catch (galat) {
    // Pembatalan oleh pengguna bukan kegagalan, jadi tidak memunculkan
    // layar galat, cukup kembali ke layar pencarian.
    if (galat?.sebab === SEBAB.DIBATALKAN || pengendaliAktif?.signal.aborted) {
      setState({ tampilan: 'siap' });
      return;
    }
    tampilkanGalat(galat);
  }
}

/**
 * Memasang seluruh perilaku layar pencarian. Dipanggil sekali dari main.js.
 */
export function pasangPengendaliPencarian() {
  // Mengisi kotak dengan pasangan bawaan supaya pengguna bisa langsung
  // menekan tombol cari tanpa mengetik apa pun saat pertama membuka.
  setState({ idAsal: DEFAULT_TRIP.origin, idTujuan: DEFAULT_TRIP.destination });
  isiKotak('#inpOrigin', DEFAULT_TRIP.origin);
  isiKotak('#inpDest', DEFAULT_TRIP.destination);

  pasangKotakIsian('#inpOrigin', '#saranOrigin', 'idAsal');
  pasangKotakIsian('#inpDest', '#saranDest', 'idTujuan');

  $('#btnSwap')?.addEventListener('click', () => {
    const { idAsal, idTujuan } = getState();
    setState({ idAsal: idTujuan, idTujuan: idAsal });
    isiKotak('#inpOrigin', idTujuan);
    isiKotak('#inpDest', idAsal);
  });

  const tombolProfil = $$('.chip[data-profile]');
  for (const tombol of tombolProfil) {
    tombol.addEventListener('click', () => {
      setPressed(tombolProfil, tombol);
      setState({ profil: tombol.dataset.profile });
    });
  }

  // Kartu pintasan hanya mengisi kotak isian, tidak langsung mencari,
  // supaya pengguna masih sempat mengubah moda perjalanan lebih dulu.
  $('#routeCards')?.addEventListener('click', (e) => {
    const kartu = e.target.closest('[data-pintasan-asal]');
    if (!kartu) return;
    const { pintasanAsal, pintasanTujuan } = kartu.dataset;
    setState({ idAsal: pintasanAsal, idTujuan: pintasanTujuan });
    isiKotak('#inpOrigin', pintasanAsal);
    isiKotak('#inpDest', pintasanTujuan);
    tutupSemuaSaran();
    $('#btnSearch')?.focus();
  });

  $('#btnSearch')?.addEventListener('click', jalankanPencarian);
  $('#btnRetry')?.addEventListener('click', jalankanPencarian);

  $('#btnCancel')?.addEventListener('click', () => {
    pengendaliAktif?.abort();
    setState({ tampilan: 'siap' });
  });

  $('#btnAgain')?.addEventListener('click', () => {
    setState({ tampilan: 'siap' });
  });

  // Menekan Enter di salah satu kotak isian langsung mencari. Ini
  // kebiasaan yang diharapkan pengguna pada kotak pencarian mana pun.
  for (const id of ['#inpOrigin', '#inpDest']) {
    $(id)?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      tutupSemuaSaran();
      e.target.blur();
      jalankanPencarian();
    });
  }
}
