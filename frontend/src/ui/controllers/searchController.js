/*
   Pengendali layar pencarian.

   Menyambungkan input pengguna ke Geocoding & Address Parser presisi ala Kalceria
   (mendukung perumahan, blok/nomor, RT/RW, gang, jalan spesifik, dan deteksi GPS)
   serta alur navigasi di domain/navigationService.js.
*/

import { $, $$, show, setPressed, setText } from '../../utils/dom.js';
import { getState, setState } from '../../state/appState.js';
import {
  findPlaceById,
  searchPlacesLive,
  reverseGeocodeLive,
  registerCustomPlace,
  DEFAULT_TRIP,
} from '../../config/jakartaPlaces.js';
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
  if (kotak && tempat) kotak.value = tempat.headline || tempat.nama;
}

/** Menutup seluruh daftar saran yang sedang terbuka. */
function tutupSemuaSaran() {
  for (const daftar of $$('.saran')) {
    daftar.hidden = true;
    daftar.previousElementSibling?.setAttribute?.('aria-expanded', 'false');
  }
}

/**
 * Memasang perilaku kotak isian dengan pencarian geocoding dinamis (live)
 * dan dekonstruksi alamat presisi ala Kalceria.
 *
 * @param {string} idInput
 * @param {string} idSaran
 * @param {'idAsal'|'idTujuan'} kunciKeadaan
 */
function pasangKotakIsian(idInput, idSaran, kunciKeadaan) {
  const kotak = $(idInput);
  const daftar = $(idSaran);
  if (!kotak || !daftar) return;

  let timerDebounce = null;
  let pengendaliSaran = null;

  const gambarSaran = async () => {
    const val = kotak.value.trim();
    daftar.innerHTML = '<p class="saran__kosong" style="color:var(--text-3, #94a3b8)">Mencari alamat presisi...</p>';
    daftar.hidden = false;
    kotak.setAttribute('aria-expanded', 'true');

    pengendaliSaran?.abort();
    const ctrl = new AbortController();
    pengendaliSaran = ctrl;
    const hasil = await searchPlacesLive(val, 7, ctrl.signal);
    if (ctrl.signal.aborted) return;

    if (hasil.length === 0) {
      daftar.innerHTML = '<p class="saran__kosong">Lokasi tidak ditemukan. Coba ketik nama jalan, perumahan, blok/nomor, atau koordinat.</p>';
    } else {
      daftar.innerHTML = hasil.map((p) => {
        const headline = p.headline || p.nama || '';
        const subtitle = p.subtitle || p.area || '';
        const unitTag = p.unit
          ? `<span class="saran__unit">${p.unit}</span>`
          : '';
        return `
        <button type="button" class="saran__item" role="option" data-tempat="${p.id}">
          <span class="saran__top">
            <span class="saran__nama">${headline}</span>
            ${unitTag}
          </span>
          <span class="saran__area">${subtitle}</span>
        </button>`;
      }).join('');
    }
    daftar.hidden = false;
    kotak.setAttribute('aria-expanded', 'true');
  };

  kotak.addEventListener('focus', () => { gambarSaran(); });
  kotak.addEventListener('input', () => {
    clearTimeout(timerDebounce);
    const val = kotak.value.trim();
    if (!val) {
      setState({ [kunciKeadaan]: null });
    }
    pengendaliSaran?.abort();
    // Debounce 220ms sesuai spesifikasi Kalceria LocationAutocomplete
    timerDebounce = setTimeout(gambarSaran, 220);
  });

  // Pemilihan ditangkap di tingkat daftar saran
  daftar.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.saran__item');
    if (!item) return;
    e.preventDefault();
    const tempat = findPlaceById(item.dataset.tempat);
    if (!tempat) return;
    kotak.value = tempat.headline || tempat.nama;
    setState({ [kunciKeadaan]: tempat.id });
    daftar.hidden = true;
    kotak.setAttribute('aria-expanded', 'false');
  });

  // Bila pengguna menekan Enter pada teks kustom, otomatis pilih hasil pertama yang cocok
  kotak.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const val = kotak.value.trim();
      if (val) {
        const hits = await searchPlacesLive(val, 1);
        if (hits.length > 0) {
          registerCustomPlace(hits[0]);
          kotak.value = hits[0].headline || hits[0].nama;
          setState({ [kunciKeadaan]: hits[0].id });
          daftar.hidden = true;
          kotak.setAttribute('aria-expanded', 'false');
        }
      }
    }
  });

  kotak.addEventListener('blur', () => {
    setTimeout(async () => {
      daftar.hidden = true;
      kotak.setAttribute('aria-expanded', 'false');
      const val = kotak.value.trim();
      if (!val) {
        setState({ [kunciKeadaan]: null });
        return;
      }
      const sekarang = findPlaceById(getState()[kunciKeadaan]);
      const namaSekarang = sekarang ? (sekarang.headline || sekarang.nama) : '';
      if (!sekarang || namaSekarang !== val) {
        const hits = await searchPlacesLive(val, 1);
        if (hits.length > 0) {
          registerCustomPlace(hits[0]);
          kotak.value = hits[0].headline || hits[0].nama;
          setState({ [kunciKeadaan]: hits[0].id });
          return;
        }
        if (sekarang) kotak.value = namaSekarang;
      }
    }, 220);
  });
}

/**
 * Deteksi lokasi saat ini menggunakan GPS perangkat lalu reverse-geocode
 * menjadi alamat jalan/kelurahan/kecamatan Indonesia.
 */
function pasangDeteksiGpsAsal() {
  const btn = $('#btnDetectOrigin');
  const lbl = $('#lblDetectOrigin');
  const inp = $('#inpOrigin');
  if (!btn || !inp) return;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast('Peramban Anda tidak mendukung deteksi lokasi GPS.');
      return;
    }

    btn.disabled = true;
    if (lbl) lbl.textContent = 'Mendeteksi...';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const place = await reverseGeocodeLive(latitude, longitude);
          inp.value = place.headline || place.nama;
          setState({ idAsal: place.id });
          tutupSemuaSaran();
          toast(`Titik awal diatur ke: ${place.headline || place.nama}`);
        } catch {
          toast('Gagal menerjemahkan koordinat GPS.');
        } finally {
          btn.disabled = false;
          if (lbl) lbl.textContent = 'Lokasi Saya';
        }
      },
      () => {
        btn.disabled = false;
        if (lbl) lbl.textContent = 'Lokasi Saya';
        toast('Izin lokasi ditolak atau sinyal GPS tidak tersedia.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
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
    const hasilLengkap = { ...hasil, asal, tujuan, profil: hasil?.profil || hasil?.profile || keadaan.profil || 'car' };
    gambarHasil(hasilLengkap);
    setState({ tampilan: 'hasil', hasil: hasilLengkap });
  } catch (galat) {
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
  setState({ idAsal: DEFAULT_TRIP.origin || null, idTujuan: DEFAULT_TRIP.destination || null });
  if (DEFAULT_TRIP.origin) isiKotak('#inpOrigin', DEFAULT_TRIP.origin);
  if (DEFAULT_TRIP.destination) isiKotak('#inpDest', DEFAULT_TRIP.destination);

  pasangKotakIsian('#inpOrigin', '#saranOrigin', 'idAsal');
  pasangKotakIsian('#inpDest', '#saranDest', 'idTujuan');
  pasangDeteksiGpsAsal();

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
