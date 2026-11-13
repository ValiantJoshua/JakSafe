/*
   Pengendali autentikasi dan akun pengguna (Backend JakSafe Opsi A).
   Terhubung ke API backend (/api/auth dan /api/routes/saved) dengan
   persistensi database MongoDB / fallback lokal.
*/

import { $, show, setText } from '../../utils/dom.js';
import { getState, setState, subscribe } from '../../state/appState.js';
import {
  masukPengguna,
  daftarPengguna,
  ambilProfilSaya,
  perbaruiProfil,
  ambilSemuaRuteTersimpan,
  hapusRute,
} from '../../api/authApi.js';
import { findPlaceById, registerCustomPlace } from '../../config/jakartaPlaces.js';
import { toast } from '../toast.js';
import { ikon } from '../icons.js';

/** Membuka atau menutup jendela masuk. */
function bukaModal(buka) {
  const modal = $('#loginModal');
  if (!modal) return;
  show(modal, buka);
  if (buka) {
    setTimeout(() => $('#loginEmail')?.focus(), 60);
  }
}

/** Membuka atau menutup menu akun. */
function bukaMenu(buka) {
  show($('#userMenu'), buka);
}

/** Mengambil inisial nama untuk avatar. */
function inisialNama(nama) {
  if (!nama) return 'JS';
  const parts = nama.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Menyesuaikan seluruh bagian tampilan yang bergantung pada keadaan masuk. */
function gambarKeadaanMasuk(keadaan) {
  const { masuk, sensitifKesehatan, pengguna } = keadaan;

  document.body.setAttribute('data-auth', masuk ? 'member' : 'guest');
  show($('#btnLogin'), !masuk);
  show($('#userChip'), masuk);
  show($('#promoBox'), !masuk);
  show($('#savedBox'), masuk);

  const namaUser = pengguna?.name || 'Pengguna JakSafe';
  const emailUser = pengguna?.email || '';
  const inisial = inisialNama(namaUser);
  const namaPendek = namaUser.trim().split(/\s+/)[0] || 'Akun';

  setText($('#userChipAva') || document.querySelector('.userchip__ava'), inisial);
  setText($('#userChipNama') || document.querySelector('.userchip__name'), namaPendek);

  const ava = document.querySelector('.usermenu__ava');
  if (ava) ava.textContent = inisial;

  setText($('#menuNama'), namaUser);
  setText($('#menuEmail'), emailUser);

  const sapaan = $('#greetBox');
  if (sapaan) {
    sapaan.innerHTML = masuk
      ? `<h1 class="search__title">Halo, ${namaUser.split(' ')[0]}</h1>
         <p class="search__sub">Profil kesehatan ${sensitifKesehatan ? 'aktif — bobot polusi udara diprioritaskan saat rute dinilai' : 'nonaktif — bobot penilaian memakai standar bawaan'}.</p>`
      : `<h1 class="search__title">Rencanakan Rute Perjalanan</h1>
         <p class="search__sub">Navigasi Jakarta dengan pertimbangan kualitas udara, lalu lintas, dan pantauan CCTV.</p>`;
  }

  show($('#menuBadgeSensitif'), masuk && sensitifKesehatan);
  setText($('#menuSensitifStat'), sensitifKesehatan ? 'Aktif' : 'Nonaktif');
}

/** Menggambar ulang daftar rute tersimpan. */
function gambarRuteTersimpan(daftar) {
  const wadah = $('#savedList');
  if (!wadah) return;

  if (!daftar || daftar.length === 0) {
    wadah.innerHTML = '<p class="note" style="color:var(--text-3); font-size:var(--fs-sm); margin:4px 0;">Belum ada rute yang disimpan di database.</p>';
    return;
  }

  wadah.innerHTML = daftar.map((r, idx) => {
    const asalNama = r.origin?.name || r.asal || 'Awal';
    const tujuanNama = r.destination?.name || r.tujuan || 'Tujuan';
    const totalScore = r.score?.totalScore ?? r.skor ?? '-';
    const label = r.score?.label || r.label || 'AMAN';
    const ruteId = r.id || r._id || '';
    const statusKey = label.toLowerCase().includes('hindari') ? 'hindari' : label.toLowerCase().includes('hati') ? 'hati' : 'aman';

    return `
      <div class="saveditem" data-idx="${idx}" data-route-id="${ruteId}" data-status="${statusKey}">
        <span class="saveditem__dot"></span>
        <span class="saveditem__body press" data-load-route="${idx}" title="Klik untuk memuat rute ini">
          <span class="saveditem__name">${asalNama} ${ikon('i-arrow-r', 12)} ${tujuanNama}</span>
          <span class="saveditem__meta">Skor ${totalScore} · ${label}</span>
        </span>
        <button type="button" class="saveditem__del press" data-delete-route="${ruteId}" title="Hapus rute dari database" aria-label="Hapus rute">
          ${ikon('i-x', 14)}
        </button>
      </div>`;
  }).join('');
}

/**
 * Memasang seluruh perilaku masuk, daftar, profil, dan sinkronisasi database.
 */
export async function pasangPengendaliAuth() {
  $('#btnLogin')?.addEventListener('click', () => bukaModal(true));
  $('#btnPromoLogin')?.addEventListener('click', () => bukaModal(true));

  for (const tombol of document.querySelectorAll('[data-close-modal]')) {
    tombol.addEventListener('click', () => bukaModal(false));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      bukaModal(false);
      bukaMenu(false);
    }
  });

  // Form submit: Login riil ke backend (dengan auto-register jika pengguna baru)
  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail')?.value?.trim();
    const password = $('#loginPass')?.value || '';
    const sensitif = $('#chkSensitif')?.checked ?? false;

    if (!email) {
      toast('Silakan masukkan alamat email');
      return;
    }
    if (!password || password.length < 6) {
      toast('Kata sandi minimal 6 karakter');
      return;
    }

    const submitBtn = $('#loginForm button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Menghubungkan...';
    }

    try {
      let res;
      try {
        // Coba login terlebih dahulu
        res = await masukPengguna({ email, password });
      } catch (loginErr) {
        // Jika akun belum terdaftar (404), lakukan registrasi otomatis
        if (loginErr.status === 404) {
          const namaAwal = email.split('@')[0];
          res = await daftarPengguna({
            email,
            password,
            name: namaAwal.charAt(0).toUpperCase() + namaAwal.slice(1),
            isHealthSensitive: sensitif,
          });
          toast('Akun baru berhasil didaftarkan.');
        } else {
          throw loginErr;
        }
      }

      const { token, user } = res;
      localStorage.setItem('jaksafe_token', token);
      localStorage.setItem('jaksafe_user', JSON.stringify(user));

      setState({
        masuk: true,
        token,
        pengguna: user,
        sensitifKesehatan: Boolean(user?.healthProfile?.isSensitive ?? sensitif),
      });

      bukaModal(false);
      toast(`Selamat datang, ${user.name}!`);

      // Muat rute tersimpan dari backend
      try {
        const routes = await ambilSemuaRuteTersimpan(token);
        setState({ ruteTersimpan: routes });
      } catch (loadErr) {
        console.warn('[auth] Gagal mengambil rute tersimpan:', loadErr);
      }
    } catch (err) {
      console.error('[auth] Login error:', err);
      toast(err.message || 'Gagal masuk. Periksa email dan kata sandi Anda.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Masuk Sekarang <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>`;
      }
    }
  });

  $('#btnGuest')?.addEventListener('click', () => {
    bukaModal(false);
    toast('Lanjut sebagai tamu. Fitur dasar tetap bisa dipakai.');
  });

  $('#userChip')?.addEventListener('click', (e) => {
    e.stopPropagation();
    bukaMenu($('#userMenu')?.hidden ?? false);
  });

  $('#userMenu')?.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => bukaMenu(false));

  // Toggle status sensitif kesehatan (tersimpan permanen ke backend)
  $('#btnToggleSensitif')?.addEventListener('click', async () => {
    const { token, sensitifKesehatan, masuk } = getState();
    const baru = !sensitifKesehatan;

    setState({ sensitifKesehatan: baru });

    if (masuk && token) {
      try {
        const updated = await perbaruiProfil(token, { isHealthSensitive: baru });
        const user = updated.user || updated;
        localStorage.setItem('jaksafe_user', JSON.stringify(user));
        setState({ pengguna: user });
      } catch (err) {
        console.warn('[auth] Gagal update profil di server:', err);
      }
    }

    toast(baru
      ? 'Profil kesehatan aktif (tersimpan). Bobot polusi dinaikkan saat rute dinilai.'
      : 'Profil kesehatan nonaktif (tersimpan). Bobot kembali normal.');
  });

  // Tombol Keluar (Logout)
  $('#btnLogout')?.addEventListener('click', () => {
    localStorage.removeItem('jaksafe_token');
    localStorage.removeItem('jaksafe_user');
    setState({
      masuk: false,
      token: null,
      pengguna: null,
      sensitifKesehatan: false,
      ruteTersimpan: [],
    });
    bukaMenu(false);
    toast('Anda telah keluar.');
  });

  // Pasang aksi klik dan hapus pada daftar rute tersimpan
  $('#savedList')?.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-delete-route]');
    if (delBtn) {
      e.stopPropagation();
      const routeId = delBtn.dataset.deleteRoute;
      const { token, ruteTersimpan } = getState();
      if (!routeId || !token) return;

      try {
        await hapusRute(token, routeId);
        const filtered = ruteTersimpan.filter((r) => String(r.id || r._id) !== String(routeId));
        setState({ ruteTersimpan: filtered });
        toast('Rute berhasil dihapus dari database.');
      } catch (err) {
        toast('Gagal menghapus rute.');
      }
      return;
    }

    const loadItem = e.target.closest('[data-load-route]');
    if (loadItem) {
      const idx = Number(loadItem.dataset.loadRoute);
      const { ruteTersimpan } = getState();
      const r = ruteTersimpan[idx];
      if (!r) return;

      const origin = r.origin || { name: r.asal, lat: -6.2115, lon: 106.8229 };
      const dest = r.destination || { name: r.tujuan, lat: -6.1754, lon: 106.8272 };

      const originId = origin.id || `custom-saved-origin-${Date.now()}`;
      const destId = dest.id || `custom-saved-dest-${Date.now()}`;

      registerCustomPlace({ id: originId, nama: origin.name, area: origin.area || '', lat: origin.lat, lon: origin.lon });
      registerCustomPlace({ id: destId, nama: dest.name, area: dest.area || '', lat: dest.lat, lon: dest.lon });

      const inpOrigin = /** @type {HTMLInputElement|null} */ ($('#inpOrigin'));
      const inpDest = /** @type {HTMLInputElement|null} */ ($('#inpDest'));
      if (inpOrigin) inpOrigin.value = origin.name;
      if (inpDest) inpDest.value = dest.name;

      setState({ idAsal: originId, idTujuan: destId });
      toast(`Rute dimuat: ${origin.name} → ${dest.name}`);
    }
  });

  subscribe((keadaan, berubah) => {
    if (berubah.some((k) => ['masuk', 'sensitifKesehatan', 'pengguna'].includes(k))) {
      gambarKeadaanMasuk(keadaan);
    }
    if (berubah.includes('ruteTersimpan')) {
      gambarRuteTersimpan(keadaan.ruteTersimpan);
    }
  });

  gambarKeadaanMasuk(getState());
  gambarRuteTersimpan(getState().ruteTersimpan);

  // Inisialisasi awal jika ada token tersimpan di browser
  const { token, masuk } = getState();
  if (masuk && token) {
    try {
      const meRes = await ambilProfilSaya(token);
      if (meRes.user) {
        localStorage.setItem('jaksafe_user', JSON.stringify(meRes.user));
        setState({
          pengguna: meRes.user,
          sensitifKesehatan: Boolean(meRes.user.healthProfile?.isSensitive),
        });
      }
      const routes = await ambilSemuaRuteTersimpan(token);
      setState({ ruteTersimpan: routes });
    } catch (tokenErr) {
      console.warn('[auth] Sesi lama berakhir atau tidak valid:', tokenErr?.message);
      localStorage.removeItem('jaksafe_token');
      localStorage.removeItem('jaksafe_user');
      setState({ masuk: false, token: null, pengguna: null, sensitifKesehatan: false });
    }
  }
}
