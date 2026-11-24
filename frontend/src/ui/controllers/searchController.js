/*
   Pengendali layar pencarian.

   Menyambungkan input pengguna ke Geocoding & Address Parser presisi ala Kalceria
   (mendukung perumahan, blok/nomor, RT/RW, gang, jalan spesifik, dan deteksi GPS)
   serta alur navigasi di domain/navigationService.js.
*/

import { $, $$, show, setPressed, setText, escapeHtml } from '../../utils/dom.js';
import { getState, setState } from '../../state/appState.js';
import {
  findPlaceById,
  searchPlacesLive,
  reverseGeocodeLive,
  registerCustomPlace,
  DEFAULT_TRIP,
} from '../../config/jakartaPlaces.js';
import { cariRute } from '../../domain/navigationService.js';
import { catatRiwayatPerjalanan } from '../../api/authApi.js';
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
    daftar.innerHTML = '<p class="saran__kosong" style="color:var(--text-3, #94a3b8)">Searching exact address...</p>';
    daftar.hidden = false;
    kotak.setAttribute('aria-expanded', 'true');

    pengendaliSaran?.abort();
    const ctrl = new AbortController();
    pengendaliSaran = ctrl;
    const hasil = await searchPlacesLive(val, 7, ctrl.signal);
    if (ctrl.signal.aborted) return;

    if (hasil.length === 0) {
      daftar.innerHTML = '<p class="saran__kosong">Location not found. Try typing a street name, neighborhood, building, or coordinates.</p>';
    } else {
      daftar.innerHTML = hasil.map((p) => {
        const headline = escapeHtml(p.headline || p.nama || '');
        const subtitle = escapeHtml(p.subtitle || p.area || '');
        const unitTag = p.unit
          ? `<span class="saran__unit">${escapeHtml(p.unit)}</span>`
          : '';
        return `
        <button type="button" class="saran__item" role="option" data-tempat="${escapeHtml(p.id)}">
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
    window.dispatchEvent(new CustomEvent('jaksafe:mobile-half'));
    setState({ [kunciKeadaan]: tempat.id });
    daftar.hidden = true;
    kotak.setAttribute('aria-expanded', 'false');
    kotak.blur();
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
          window.dispatchEvent(new CustomEvent('jaksafe:mobile-half'));
          setState({ [kunciKeadaan]: hits[0].id });
          daftar.hidden = true;
          kotak.setAttribute('aria-expanded', 'false');
          kotak.blur();
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
      toast('Your browser does not support GPS location detection.');
      return;
    }

    btn.disabled = true;
    if (lbl) lbl.textContent = 'Detecting...';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const place = await reverseGeocodeLive(latitude, longitude);
          inp.value = place.headline || place.nama;
          window.dispatchEvent(new CustomEvent('jaksafe:mobile-half'));
          setState({ idAsal: place.id });
          tutupSemuaSaran();
          toast(`Origin set to: ${place.headline || place.nama}`);
        } catch {
          toast('Failed to resolve GPS coordinates.');
        } finally {
          btn.disabled = false;
          if (lbl) lbl.textContent = 'My Location';
        }
      },
      () => {
        btn.disabled = false;
        if (lbl) lbl.textContent = 'My Location';
        toast('Location permission denied or GPS signal unavailable.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

/** Menyusun pesan galat yang sesuai jenis kegagalannya. */
function pesanGalat(galat) {
  if (galat?.sebab === SEBAB.TIDAK_TERHUBUNG) {
    return {
      judul: 'Unable to reach JakSafe backend',
      teks: 'The frontend is running, but the backend is not responding. '
        + 'Route search, air quality data, and camera feeds all require the backend.',
      petunjuk: 'Open a terminal, go to the backend folder, and run\n  npm install\n  npm run dev\n\nEnsure port 3001 matches VITE_BACKEND_ORIGIN in the frontend .env.',
    };
  }
  if (galat?.sebab === SEBAB.WAKTU_HABIS) {
    return {
      judul: 'Request timed out',
      teks: 'The backend took too long to respond, usually because an external routing service like OSRM is busy. Please try again shortly.',
      petunjuk: null,
    };
  }
  if (galat?.status === 404) {
    return {
      judul: 'No route found',
      teks: 'The routing service could not find a road path connecting these points for the selected travel mode. Try different locations or switch travel mode.',
      petunjuk: null,
    };
  }
  return {
    judul: 'Route search failed',
    teks: galat?.message || 'An unexpected error occurred while searching for a route.',
    petunjuk: galat?.jalur ? `Failed endpoint\n  ${galat.jalur}` : null,
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
    toast('Select both an origin and a destination first.');
    return;
  }
  if (asal.id === tujuan.id) {
    toast('Origin and destination cannot be the same.');
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

    // Catat riwayat perjalanan secara non-blocking bila pengguna sudah masuk
    const saatIni = getState();
    if (saatIni.masuk && saatIni.token && hasilLengkap?.score) {
      catatRiwayatPerjalanan(saatIni.token, {
        origin: {
          id: asal.id || null,
          name: asal.nama,
          area: asal.area || '',
          lat: Number(asal.lat) || 0,
          lon: Number(asal.lon) || 0,
        },
        destination: {
          id: tujuan.id || null,
          name: tujuan.nama,
          area: tujuan.area || '',
          lat: Number(tujuan.lat) || 0,
          lon: Number(tujuan.lon) || 0,
        },
        score: {
          totalScore: Number(hasilLengkap.score.totalScore) || 0,
          label: String(hasilLengkap.score.label || 'AMAN'),
          color: String(hasilLengkap.score.color || '#16a34a'),
        },
        distanceM: Number(hasilLengkap.route?.distanceM) || 0,
        durationS: Number(hasilLengkap.route?.durationS) || 0,
        profile: hasilLengkap.profil,
        summary: String(hasilLengkap.route?.summary || ''),
        source: String(hasilLengkap.sumber || 'preview'),
      })
        .then((res) => {
          if (res?.entry) {
            const terkini = getState().riwayatPerjalanan || [];
            setState({ riwayatPerjalanan: [res.entry, ...terkini].slice(0, 60) });
          }
        })
        .catch((histErr) => {
          console.warn('[history] Gagal mencatat riwayat perjalanan:', histErr?.message);
        });
    }
  } catch (galat) {
    tutupSemuaTahap();
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
    tutupSemuaTahap();
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
