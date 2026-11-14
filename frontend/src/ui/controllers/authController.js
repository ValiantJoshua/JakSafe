/*
   Pengendali autentikasi dan akun pengguna (Backend JakSafe Opsi A).
   Terhubung ke API backend (/api/auth dan /api/routes/saved) dengan
   persistensi database MongoDB / fallback lokal.
*/

import { $, $$, show, setText, setPressed } from '../../utils/dom.js';
import { escapeHtml, formatJarak, formatDurasi } from '../../utils/format.js';
import { PROFILES } from '../../config/constants.js';
import { getState, setState, subscribe } from '../../state/appState.js';
import {
  masukPengguna,
  daftarPengguna,
  ambilProfilSaya,
  perbaruiProfil,
  ambilSemuaRuteTersimpan,
  hapusRute,
  ambilRiwayatPerjalanan,
  hapusRiwayat,
  kosongkanRiwayat,
} from '../../api/authApi.js';
import { ambilPeringatanArea } from '../../api/alertsApi.js';
import { registerCustomPlace } from '../../config/jakartaPlaces.js';
import { flyToCoordinates } from '../../map/cesiumViewer.js';
import { toast } from '../toast.js';
import { ikon } from '../icons.js';

let modeAutentikasi = 'login';
let wilayahFilterAktif = 'semua';
let daftarPeringatanAktif = [];

/** Mengembalikan input kata sandi ke kondisi tersembunyi. */
function resetTampilanPassword() {
  const passEl = /** @type {HTMLInputElement|null} */ ($('#loginPass'));
  const btnToggle = $('#btnTogglePass');
  if (passEl) passEl.type = 'password';
  if (btnToggle) {
    btnToggle.setAttribute('aria-pressed', 'false');
    btnToggle.setAttribute('aria-label', 'Tampilkan kata sandi');
    btnToggle.innerHTML = ikon('i-eye', 17);
  }
}

/** Menghapus pesan error inline dan penanda aria-invalid pada form modal. */
function bersihkanErrorAuth() {
  const alertEl = $('#authError');
  if (alertEl) {
    alertEl.innerHTML = '';
    alertEl.hidden = true;
  }
  for (const id of ['#loginName', '#loginEmail', '#loginPass']) {
    $(id)?.removeAttribute('aria-invalid');
  }
}

/**
 * Menampilkan pesan kesalahan inline pada modal autentikasi, dengan tombol
 * aksi opsional (misalnya pindah ke tab Daftar/Masuk) bila relevan.
 */
function tampilkanErrorAuth(pesan, { fieldEl = null, actionLabel = '', onAction = null } = {}) {
  const alertEl = $('#authError');
  if (alertEl) {
    alertEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = pesan;
    alertEl.append(span);
    if (actionLabel && typeof onAction === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'auth-alert__action';
      btn.textContent = actionLabel;
      btn.addEventListener('click', onAction);
      alertEl.append(btn);
    }
    alertEl.hidden = false;
  }
  if (fieldEl) {
    fieldEl.setAttribute('aria-invalid', 'true');
    fieldEl.focus();
  }
}

/** Mengganti mode modal antara 'login' (Masuk) dan 'register' (Daftar Akun). */
function aturModeAuth(mode, { focusField = false } = {}) {
  modeAutentikasi = mode === 'register' ? 'register' : 'login';
  const isRegister = modeAutentikasi === 'register';

  $('#tabLoginMode')?.setAttribute('aria-selected', String(!isRegister));
  $('#tabRegisterMode')?.setAttribute('aria-selected', String(isRegister));

  show($('#registerNameWrap'), isRegister);
  show($('#registerSensitifWrap'), isRegister);

  setText($('#loginTitle'), isRegister ? 'Buat Akun JakSafe' : 'Masuk ke JakSafe');
  setText(
    $('#loginSub'),
    isRegister
      ? 'Daftar gratis untuk simpan rute dan profil kesehatan.'
      : 'Masuk dengan email dan kata sandi Anda.'
  );

  const passEl = /** @type {HTMLInputElement|null} */ ($('#loginPass'));
  if (passEl) {
    passEl.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
  }

  const submitBtn = $('#btnAuthSubmit');
  if (submitBtn && !submitBtn.disabled) {
    submitBtn.innerHTML = `${isRegister ? 'Daftar Sekarang' : 'Masuk Sekarang'} <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>`;
  }

  bersihkanErrorAuth();
  if (focusField) {
    setTimeout(() => $(isRegister ? '#loginName' : '#loginEmail')?.focus(), 40);
  }
}

/** Membuka atau menutup jendela masuk. */
function bukaModal(buka) {
  const modal = $('#loginModal');
  if (!modal) return;
  show(modal, buka);
  resetTampilanPassword();
  if (buka) {
    aturModeAuth('login');
    setTimeout(() => $('#loginEmail')?.focus(), 60);
  } else {
    bersihkanErrorAuth();
    const passEl = /** @type {HTMLInputElement|null} */ ($('#loginPass'));
    if (passEl) passEl.value = '';
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
      ? `<h1 class="search__title">Halo, ${escapeHtml(namaPendek)}</h1>
         <p class="search__sub">Profil kesehatan ${sensitifKesehatan ? 'aktif — bobot polusi udara diprioritaskan saat rute dinilai' : 'nonaktif — bobot penilaian memakai standar bawaan'}.</p>`
      : `<h1 class="search__title">Rencanakan Rute Perjalanan</h1>
         <p class="search__sub">Navigasi Jakarta dengan pertimbangan kualitas udara, lalu lintas, dan pantauan CCTV.</p>`;
  }

  show($('#menuBadgeSensitif'), masuk && sensitifKesehatan);
  show($('#btnOpenAdmin'), masuk && pengguna?.role === 'admin');
  const toggleEl = $('#btnToggleSensitif');
  if (toggleEl) {
    toggleEl.setAttribute('aria-checked', String(Boolean(sensitifKesehatan)));
  }
  setText(
    $('#menuSensitifSub'),
    sensitifKesehatan ? 'Bobot polusi dinaikkan' : 'Prioritaskan udara bersih'
  );
  setText($('#menuHistoryCount'), String((keadaan.riwayatPerjalanan || []).length));
}

/** Format waktu ISO ke ringkasan waktu lokal Indonesia. */
function formatWaktuRiwayat(iso) {
  if (!iso) return 'Baru saja';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Baru saja';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

/** Label moda perjalanan Bahasa Indonesia untuk riwayat/rute tersimpan. */
function namaProfil(profileKey) {
  return PROFILES.find((p) => p.key === profileKey)?.nama || 'Mobil';
}

/** Muat satu record rute tersimpan/riwayat ke form pencarian & pilih chip moda. */
function muatRuteDariRecord(r) {
  if (!r) return;
  const origin = r.origin || { name: r.asal, lat: -6.2115, lon: 106.8229 };
  const dest = r.destination || { name: r.tujuan, lat: -6.1754, lon: 106.8272 };

  const originId = origin.id || `custom-loaded-origin-${Date.now()}`;
  const destId = dest.id || `custom-loaded-dest-${Date.now()}`;

  registerCustomPlace({ id: originId, nama: origin.name, area: origin.area || '', lat: origin.lat, lon: origin.lon });
  registerCustomPlace({ id: destId, nama: dest.name, area: dest.area || '', lat: dest.lat, lon: dest.lon });

  const inpOrigin = /** @type {HTMLInputElement|null} */ ($('#inpOrigin'));
  const inpDest = /** @type {HTMLInputElement|null} */ ($('#inpDest'));
  if (inpOrigin) inpOrigin.value = origin.name;
  if (inpDest) inpDest.value = dest.name;

  const savedProfile = ['car', 'motor', 'bike', 'foot'].includes(r.profile) ? r.profile : null;
  const chipSet = $$('.chip[data-profile]');
  const matchingChip = savedProfile ? chipSet.find((c) => c.dataset.profile === savedProfile) : null;
  if (matchingChip) setPressed(chipSet, matchingChip);

  setState({
    tampilan: 'siap',
    idAsal: originId,
    idTujuan: destId,
    ...(savedProfile ? { profil: savedProfile } : {}),
  });
  toast(`Rute dimuat: ${origin.name} → ${dest.name}`);
}

/**
 * Pasang dialog HTML native dengan light-dismiss fallback untuk browser
 * yang belum mendukung atribut `closedby="any"` (Safari).
 */
function pasangDialogModal(dialogId) {
  const dialog = /** @type {HTMLDialogElement|null} */ ($(`#${dialogId}`));
  if (!dialog) return null;

  for (const btn of document.querySelectorAll(`[data-close-dialog="${dialogId}"]`)) {
    btn.addEventListener('click', () => dialog.close('button'));
  }

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const diDalam =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!diDalam) dialog.close('dismiss');
    });
  }
  return dialog;
}

/** Menggambar daftar Riwayat Perjalanan di dalam #historyDialog. */
function gambarDialogRiwayat(daftar = []) {
  const listEl = $('#historyList');
  const sumEl = $('#historySummaryText');
  const btnClear = $('#btnClearHistory');
  setText($('#menuHistoryCount'), String(daftar.length));

  if (sumEl) {
    sumEl.textContent = daftar.length > 0
      ? `${daftar.length} perjalanan terakhir tercatat`
      : 'Belum ada riwayat perjalanan tercatat';
  }
  if (btnClear) btnClear.hidden = daftar.length === 0;
  if (!listEl) return;

  if (daftar.length === 0) {
    listEl.innerHTML = '<li class="jempty">Belum ada pencarian rute yang tersimpan ke riwayat Anda.</li>';
    return;
  }

  listEl.innerHTML = daftar.map((item, idx) => {
    const entryId = escapeHtml(item.id || item._id || '');
    const asal = escapeHtml(item.origin?.name || 'Titik Awal');
    const tujuan = escapeHtml(item.destination?.name || 'Tujuan');
    const koridor = item.summary ? escapeHtml(item.summary) : '';
    const skor = escapeHtml(item.score?.totalScore ?? '-');
    const labelSkor = escapeHtml(item.score?.label || 'AMAN');
    const sevClass = String(item.score?.label || '').toLowerCase().includes('hindari')
      ? 'siaga'
      : String(item.score?.label || '').toLowerCase().includes('hati')
        ? 'waspada'
        : 'pantau';
    const jarak = formatJarak(item.distanceM || 0);
    const durasi = formatDurasi(item.durationS || 0);
    const moda = escapeHtml(namaProfil(item.profile));
    const waktu = escapeHtml(formatWaktuRiwayat(item.createdAt));

    return `
      <li class="jitem" data-sev="${sevClass}">
        <div class="jitem__top">
          <span class="jitem__title">${asal} → ${tujuan}</span>
          <span class="jitem__tag">${moda}</span>
        </div>
        <div class="jitem__meta">
          <span>${waktu}</span>
          <span>·</span>
          <span>Skor ${skor} (${labelSkor})</span>
          ${item.distanceM ? `<span>·</span><span>${jarak} · ${durasi}</span>` : ''}
        </div>
        ${koridor ? `<p class="jitem__desc">Via ${koridor}</p>` : ''}
        <div class="jitem__foot">
          <div class="jitem__btns">
            <button type="button" class="jitem__btn jitem__btn--primary press" data-load-history="${idx}">Muat Rute</button>
            <button type="button" class="jitem__btn jitem__btn--del press" data-delete-history="${entryId}" aria-label="Hapus riwayat ini">Hapus</button>
          </div>
        </div>
      </li>`;
  }).join('');
}

/** Merapikan nama kamera katalog ALL-CAPS & prefiks internal menjadi label terbaca. */
function formatNamaKamera(rawName) {
  const cleaned = String(rawName || '')
    .replace(/\b(JKP|JKB|JKT|JKU|JKS)\s+/gi, '')
    .replace(/\b(SATPOL\s+PP|POLDA|BINAMARGA|DBM)\b/gi, '')
    .replace(/\(?\s*CCTV[-–\s]*\d+\s*\)?/gi, '')
    .replace(/[-–]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const keepUpper = new Set(['JL.', 'MH.', 'S.', 'H.', 'DI.', 'MT.', 'TB.', 'HI', 'JPO', 'ATP', 'KM']);
  return cleaned
    .split(/\s+/)
    .map((word) => {
      const upper = word.toUpperCase();
      if (keepUpper.has(upper) || /^[A-Z]\d+$/.test(upper) || /^\d/.test(upper)) {
        return upper === 'JL.' ? 'Jl.' : upper === 'MH.' ? 'MH.' : upper;
      }
      if (word.length <= 2) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Menggambar daftar Peringatan Area Rawan di dalam #alertsDialog. */
function gambarDialogPeringatan(alerts = [], meta = {}) {
  const listEl = $('#alertsList');
  const metaEl = $('#alertsMetaText');
  const siagaCount = alerts.filter((a) => a.severity === 'siaga').length;

  setText($('#menuAlertCount'), siagaCount > 0 ? `${siagaCount} Siaga` : 'Pantau');

  if (metaEl) {
    const sumberCuaca = meta.weatherAvailable ? 'Cuaca langsung' : 'Data koridor';
    metaEl.textContent = `${alerts.length} koridor · ${siagaCount} Siaga · ${sumberCuaca}`;
  }
  if (!listEl) return;

  if (alerts.length === 0) {
    listEl.innerHTML = '<li class="jempty">Tidak ada peringatan koridor untuk filter wilayah saat ini.</li>';
    return;
  }

  listEl.innerHTML = alerts.map((a, idx) => {
    const hasRain = Number.isFinite(a.precipitationMm) && a.precipitationMm > 0;
    const rainText = hasRain ? `${escapeHtml(a.precipitationMm)} mm/jam` : (a.weatherLabel ? escapeHtml(a.weatherLabel) : '');
    const camShort = formatNamaKamera(a.cameraName);
    const metaParts = [a.region, camShort ? `Kamera ${camShort}` : ''].filter(Boolean).map(escapeHtml);
    const sourceText = (a.signals || [])
      .filter((s) => s !== 'Riwayat Koridor Rawan')
      .map(escapeHtml)
      .join(' · ') || 'Pantauan koridor historis';

    return `
      <li class="arow" data-sev="${escapeHtml(a.severity || 'pantau')}">
        <div class="arow__head">
          <div class="arow__titlegroup">
            <span class="astat" data-sev="${escapeHtml(a.severity || 'pantau')}">
              <span class="astat__dot" aria-hidden="true"></span>
              <span>${escapeHtml(a.severityLabel || 'Pantau')}</span>
            </span>
            <h3 class="arow__title">${escapeHtml(a.corridor)}</h3>
          </div>
          ${rainText ? `<span class="arow__rain">${rainText}</span>` : ''}
        </div>

        <p class="arow__meta">${metaParts.join(' · ')}</p>
        <p class="arow__desc">${escapeHtml(a.summary)}</p>
        ${a.mitigation && a.severity !== 'pantau' ? `<p class="arow__mit">Saran: ${escapeHtml(a.mitigation)}</p>` : ''}

        <div class="arow__foot">
          <span class="arow__source">${sourceText}</span>
          <button type="button" class="arow__mapbtn press" data-focus-alert="${idx}">Lihat di peta</button>
        </div>
      </li>`;
  }).join('');
}

/** Muat daftar peringatan area rawan terkini dari backend. */
async function muatPeringatanArea({ region = wilayahFilterAktif, render = true } = {}) {
  const data = await ambilPeringatanArea({ region, minSeverity: 'pantau' });
  daftarPeringatanAktif = Array.isArray(data?.alerts) ? data.alerts : [];
  if (render) {
    gambarDialogPeringatan(daftarPeringatanAktif, data);
  } else {
    const siagaCount = daftarPeringatanAktif.filter((a) => a.severity === 'siaga').length;
    setText($('#menuAlertCount'), siagaCount > 0 ? `${siagaCount} Siaga` : 'Pantau');
  }
  return data;
}

/** Menggambar ulang daftar rute tersimpan (pintasan rute statis tanpa skor/status). */
function gambarRuteTersimpan(daftar) {
  const wadah = $('#savedList');
  if (!wadah) return;

  if (!daftar || daftar.length === 0) {
    wadah.innerHTML = '<p class="note" style="color:var(--text-3); font-size:var(--fs-sm); margin:4px 0;">Belum ada rute yang disimpan di database.</p>';
    return;
  }

  wadah.innerHTML = daftar.map((r, idx) => {
    const asalNama = escapeHtml(r.origin?.name || r.asal || 'Awal');
    const tujuanNama = escapeHtml(r.destination?.name || r.tujuan || 'Tujuan');
    const ruteId = escapeHtml(r.id || r._id || '');
    const moda = escapeHtml(namaProfil(r.profile));
    const jarak = Number(r.distanceM) > 0 ? formatJarak(r.distanceM) : '';
    const metaTeks = jarak ? `${moda} · ${jarak}` : moda;

    return `
      <div class="saveditem" data-idx="${idx}" data-route-id="${ruteId}">
        <span class="saveditem__ico" aria-hidden="true">${ikon('i-route', 14)}</span>
        <span class="saveditem__body press" data-load-route="${idx}" title="Klik untuk memuat rute ini">
          <span class="saveditem__name">${asalNama} ${ikon('i-arrow-r', 12)} ${tujuanNama}</span>
          <span class="saveditem__meta">${metaTeks}</span>
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

  $('#tabLoginMode')?.addEventListener('click', () => aturModeAuth('login', { focusField: true }));
  $('#tabRegisterMode')?.addEventListener('click', () => aturModeAuth('register', { focusField: true }));

  $('#btnTogglePass')?.addEventListener('click', () => {
    const passEl = /** @type {HTMLInputElement|null} */ ($('#loginPass'));
    const btnToggle = $('#btnTogglePass');
    if (!passEl || !btnToggle) return;
    const tampilkan = passEl.type === 'password';
    passEl.type = tampilkan ? 'text' : 'password';
    btnToggle.setAttribute('aria-pressed', String(tampilkan));
    btnToggle.setAttribute('aria-label', tampilkan ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    btnToggle.innerHTML = ikon(tampilkan ? 'i-eye-off' : 'i-eye', 17);
  });

  for (const id of ['#loginName', '#loginEmail', '#loginPass']) {
    $(id)?.addEventListener('input', () => {
      $(id)?.removeAttribute('aria-invalid');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      bukaModal(false);
      bukaMenu(false);
    }
  });

  // Form submit: Masuk atau Daftar Akun secara eksplisit (tidak auto-register diam-diam)
  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    bersihkanErrorAuth();

    const emailEl = /** @type {HTMLInputElement|null} */ ($('#loginEmail'));
    const passEl = /** @type {HTMLInputElement|null} */ ($('#loginPass'));
    const nameEl = /** @type {HTMLInputElement|null} */ ($('#loginName'));

    const email = emailEl?.value?.trim() || '';
    const password = passEl?.value || '';
    const sensitif = $('#chkSensitif')?.checked ?? false;
    const isRegister = modeAutentikasi === 'register';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      tampilkanErrorAuth('Masukkan alamat email yang valid (contoh: nama@email.com).', { fieldEl: emailEl });
      return;
    }
    if (!password || password.length < 6) {
      tampilkanErrorAuth('Kata sandi minimal 6 karakter.', { fieldEl: passEl });
      return;
    }

    const submitBtn = $('#btnAuthSubmit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = isRegister ? 'Mendaftarkan...' : 'Menghubungkan...';
    }

    try {
      let res;
      if (isRegister) {
        const namaInput = nameEl?.value?.trim() || '';
        const awalan = email.split('@')[0] || 'Pengguna';
        const nama = namaInput || (awalan.charAt(0).toUpperCase() + awalan.slice(1));
        res = await daftarPengguna({
          email,
          password,
          name: nama,
          isHealthSensitive: sensitif,
        });
        toast('Akun baru berhasil didaftarkan.');
      } else {
        res = await masukPengguna({ email, password });
      }

      const { token, user } = res;
      localStorage.setItem('jaksafe_token', token);
      localStorage.setItem('jaksafe_user', JSON.stringify(user));

      setState({
        masuk: true,
        token,
        pengguna: user,
        sensitifKesehatan: Boolean(user?.healthProfile?.isSensitive ?? (isRegister ? sensitif : false)),
      });

      bukaModal(false);
      toast(`Selamat datang, ${user.name}!`);

      // Muat rute tersimpan & riwayat perjalanan dari backend
      try {
        const [routes, history] = await Promise.all([
          ambilSemuaRuteTersimpan(token),
          ambilRiwayatPerjalanan(token),
        ]);
        setState({ ruteTersimpan: routes, riwayatPerjalanan: history });
      } catch (loadErr) {
        console.warn('[auth] Gagal mengambil data akun:', loadErr);
      }
    } catch (err) {
      console.error('[auth] Auth error:', err);
      if (!isRegister && err.status === 404) {
        tampilkanErrorAuth(
          'Email ini belum terdaftar. Periksa kembali ejaan email Anda atau buat akun baru.',
          {
            fieldEl: emailEl,
            actionLabel: 'Daftar dengan email ini',
            onAction: () => aturModeAuth('register', { focusField: true }),
          }
        );
      } else if (!isRegister && err.status === 401) {
        tampilkanErrorAuth('Email atau kata sandi salah.', { fieldEl: passEl });
      } else if (isRegister && err.status === 409) {
        tampilkanErrorAuth(
          'Email ini sudah terdaftar. Silakan masuk dengan akun tersebut.',
          {
            fieldEl: emailEl,
            actionLabel: 'Pindah ke tab Masuk',
            onAction: () => aturModeAuth('login', { focusField: false }),
          }
        );
      } else {
        tampilkanErrorAuth(err.message || 'Gagal memproses akun. Periksa koneksi dan coba lagi.');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        const label = modeAutentikasi === 'register' ? 'Daftar Sekarang' : 'Masuk Sekarang';
        submitBtn.innerHTML = `${label} <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>`;
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

  // Inisialisasi native <dialog> untuk Riwayat & Peringatan Area Rawan
  const historyDialog = pasangDialogModal('historyDialog');
  const alertsDialog = pasangDialogModal('alertsDialog');

  const syncAlertPrefControls = () => {
    const { masuk, pengguna } = getState();
    show($('#alertPrefBar'), Boolean(masuk));
    const pref = pengguna?.alertPreferences || {};
    const chk = /** @type {HTMLInputElement|null} */ ($('#chkAlertRouteAuto'));
    const sel = /** @type {HTMLSelectElement|null} */ ($('#selAlertSeverity'));
    const enabled = pref.enabled !== false;
    if (chk) chk.checked = enabled;
    if (sel) {
      sel.value = ['pantau', 'waspada', 'siaga'].includes(pref.minSeverity) ? pref.minSeverity : 'waspada';
      sel.disabled = !enabled;
    }
  };

  const bukaDialogPeringatan = async () => {
    bukaMenu(false);
    syncAlertPrefControls();
    if (alertsDialog && !alertsDialog.open) alertsDialog.showModal();
    try {
      await muatPeringatanArea({ region: wilayahFilterAktif, render: true });
    } catch {
      toast('Gagal memuat daftar area rawan.');
    }
  };

  // Buka dialog Riwayat Perjalanan dari Menu Akun
  $('#btnOpenHistory')?.addEventListener('click', async () => {
    bukaMenu(false);
    gambarDialogRiwayat(getState().riwayatPerjalanan || []);
    if (historyDialog && !historyDialog.open) historyDialog.showModal();

    const { token } = getState();
    if (token) {
      try {
        const history = await ambilRiwayatPerjalanan(token);
        setState({ riwayatPerjalanan: history });
      } catch (err) {
        console.warn('[history] Gagal menyegarkan riwayat:', err?.message);
      }
    }
  });

  // Aksi pada daftar Riwayat Perjalanan (Muat Rute / Hapus / Kosongkan)
  $('#historyList')?.addEventListener('click', async (e) => {
    const loadBtn = e.target.closest('[data-load-history]');
    if (loadBtn) {
      const idx = Number(loadBtn.dataset.loadHistory);
      const entry = (getState().riwayatPerjalanan || [])[idx];
      if (entry) {
        muatRuteDariRecord(entry);
        historyDialog?.close();
      }
      return;
    }

    const delBtn = e.target.closest('[data-delete-history]');
    if (delBtn) {
      const id = delBtn.dataset.deleteHistory;
      const { token, riwayatPerjalanan } = getState();
      if (!id || !token) return;
      try {
        await hapusRiwayat(token, id);
        setState({
          riwayatPerjalanan: (riwayatPerjalanan || []).filter((h) => String(h.id || h._id) !== String(id)),
        });
        toast('Entri riwayat dihapus.');
      } catch {
        toast('Gagal menghapus entri riwayat.');
      }
    }
  });

  $('#btnClearHistory')?.addEventListener('click', async () => {
    const { token } = getState();
    if (!token) return;
    try {
      await kosongkanRiwayat(token);
      setState({ riwayatPerjalanan: [] });
      toast('Seluruh riwayat perjalanan dibersihkan.');
    } catch {
      toast('Gagal membersihkan riwayat.');
    }
  });

  // Buka dialog Peringatan Area Rawan dari Menu Akun atau banner rute
  $('#btnOpenAlerts')?.addEventListener('click', bukaDialogPeringatan);
  document.addEventListener('jaksafe:open-alerts', bukaDialogPeringatan);

  $('#alertRegionChips')?.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-region]');
    if (!chip) return;
    wilayahFilterAktif = chip.dataset.region || 'semua';
    setPressed($$('#alertRegionChips [data-region]'), chip);
    try {
      await muatPeringatanArea({ region: wilayahFilterAktif, render: true });
    } catch {
      toast('Gagal menyaring wilayah.');
    }
  });

  $('#btnRefreshAlerts')?.addEventListener('click', async () => {
    try {
      await muatPeringatanArea({ region: wilayahFilterAktif, render: true });
      toast('Status koridor rawan diperbarui.');
    } catch {
      toast('Gagal memperbarui data koridor.');
    }
  });

  const simpanPrefPeringatan = async () => {
    const { masuk, token } = getState();
    if (!masuk || !token) return;
    const chk = /** @type {HTMLInputElement|null} */ ($('#chkAlertRouteAuto'));
    const sel = /** @type {HTMLSelectElement|null} */ ($('#selAlertSeverity'));
    if (sel && chk) sel.disabled = !chk.checked;
    const alertPreferences = {
      enabled: chk ? chk.checked : true,
      minSeverity: sel ? sel.value : 'waspada',
    };
    try {
      const updated = await perbaruiProfil(token, { alertPreferences });
      const user = updated.user || updated;
      localStorage.setItem('jaksafe_user', JSON.stringify(user));
      setState({ pengguna: user });
      toast('Preferensi peringatan area rawan disimpan.');
    } catch {
      toast('Gagal menyimpan preferensi peringatan.');
    }
  };
  $('#chkAlertRouteAuto')?.addEventListener('change', simpanPrefPeringatan);
  $('#selAlertSeverity')?.addEventListener('change', simpanPrefPeringatan);

  $('#alertsList')?.addEventListener('click', (e) => {
    const focusBtn = e.target.closest('[data-focus-alert]');
    if (!focusBtn) return;
    const item = daftarPeringatanAktif[Number(focusBtn.dataset.focusAlert)];
    if (!item || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lon))) return;
    alertsDialog?.close();
    flyToCoordinates({ lon: Number(item.lon), lat: Number(item.lat), height: 950 });
    toast(`Kamera peta diarahkan ke ${item.corridor}`);
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
      riwayatPerjalanan: [],
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
      muatRuteDariRecord(ruteTersimpan[idx]);
    }
  });

  subscribe((keadaan, berubah) => {
    if (berubah.some((k) => ['masuk', 'sensitifKesehatan', 'pengguna'].includes(k))) {
      gambarKeadaanMasuk(keadaan);
      syncAlertPrefControls();
    }
    if (berubah.includes('ruteTersimpan')) {
      gambarRuteTersimpan(keadaan.ruteTersimpan);
    }
    if (berubah.includes('riwayatPerjalanan')) {
      gambarDialogRiwayat(keadaan.riwayatPerjalanan || []);
    }
  });

  gambarKeadaanMasuk(getState());
  gambarRuteTersimpan(getState().ruteTersimpan);
  gambarDialogRiwayat(getState().riwayatPerjalanan || []);
  syncAlertPrefControls();

  // Muat ringkasan jumlah titik Siaga untuk lencana menu tanpa memblokir inisialisasi
  muatPeringatanArea({ region: 'semua', render: false }).catch(() => {});

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
      const [routes, history] = await Promise.all([
        ambilSemuaRuteTersimpan(token),
        ambilRiwayatPerjalanan(token),
      ]);
      setState({ ruteTersimpan: routes, riwayatPerjalanan: history });
    } catch (tokenErr) {
      console.warn('[auth] Sesi lama berakhir atau tidak valid:', tokenErr?.message);
      localStorage.removeItem('jaksafe_token');
      localStorage.removeItem('jaksafe_user');
      setState({ masuk: false, token: null, pengguna: null, sensitifKesehatan: false, riwayatPerjalanan: [] });
    }
  }
}
