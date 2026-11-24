/*
   Pengendali autentikasi dan akun pengguna (Backend JakSafe Opsi A).
   Terhubung ke API backend (/api/auth dan /api/routes/saved) dengan
   persistensi database MongoDB / fallback lokal.
*/

import { $, $$, show, setText, setPressed } from '../../utils/dom.js';
import { escapeHtml, formatJarak, formatDurasi } from '../../utils/format.js';
import { labelSkorInggris } from '../../domain/scoreLabels.js';
import { PROFILES } from '../../config/constants.js';
import { getState, setState, subscribe } from '../../state/appState.js';
import {
  masukPengguna,
  daftarPengguna,
  ambilKonfigurasiGoogle,
  masukDenganGoogle,
  ambilProfilSaya,
  keluarPengguna,
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
let googleClientIdCache = null;
let googleGsiScriptPromise = null;
let googleTokenClient = null;
let googleTokenClientId = '';

/** Menyelesaikan sesi masuk (Email/Password maupun Google) dan memuat data akun pengguna. */
async function selesaikanSesiMasuk({ token, user, sensitifFallback = false, isNewUser = false }) {
  localStorage.setItem('jaksafe_token', token);
  localStorage.setItem('jaksafe_user', JSON.stringify(user));

  setState({
    masuk: true,
    token,
    pengguna: user,
    sensitifKesehatan: Boolean(user?.healthProfile?.isSensitive ?? sensitifFallback),
  });

  bukaModal(false);
  toast(isNewUser ? `Account created. Welcome, ${user.name}!` : `Welcome, ${user.name}!`);

  try {
    const [routes, history] = await Promise.all([
      ambilSemuaRuteTersimpan(token),
      ambilRiwayatPerjalanan(token),
    ]);
    setState({ ruteTersimpan: routes, riwayatPerjalanan: history });
  } catch (loadErr) {
    console.warn('[auth] Failed to load account data:', loadErr);
  }
}

/** Memuat skrip resmi Google Identity Services secara dinamis saat dibutuhkan. */
function muatSkripGoogleGsi() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.google?.accounts?.oauth2) return Promise.resolve(true);
  if (googleGsiScriptPromise) return googleGsiScriptPromise;

  googleGsiScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-jaksafe-gsi="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.google?.accounts?.oauth2)), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.jaksafeGsi = '1';
    script.onload = () => resolve(Boolean(window.google?.accounts?.oauth2));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return googleGsiScriptPromise;
}

/** Mengambil Google Client ID dari env Vite atau endpoint backend /api/auth/google/config. */
async function ambilGoogleClientId() {
  if (googleClientIdCache !== null) return googleClientIdCache;
  const fromEnv = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  if (fromEnv) {
    googleClientIdCache = fromEnv;
    return fromEnv;
  }
  try {
    const cfg = await ambilKonfigurasiGoogle();
    googleClientIdCache = cfg?.enabled && cfg?.clientId ? String(cfg.clientId).trim() : '';
  } catch {
    googleClientIdCache = '';
  }
  return googleClientIdCache;
}

function perbaruiLabelTombolGoogle(busy = false) {
  const btn = $('#btnGoogleAuth');
  const lbl = $('#lblGoogleAuth');
  if (btn) btn.disabled = busy;
  if (lbl) {
    lbl.textContent = busy
      ? 'Connecting to Google...'
      : (modeAutentikasi === 'register' ? 'Sign up with Google' : 'Continue with Google');
  }
}

/** Menyiapkan tombol "Continue with Google" yang selaras dengan tema JakSafe (terang/gelap). */
async function siapkanTombolGoogle() {
  const wrap = $('#googleAuthWrap');
  const btn = $('#btnGoogleAuth');
  if (!wrap || !btn) return;

  const clientId = await ambilGoogleClientId();
  if (!clientId) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  perbaruiLabelTombolGoogle(false);

  const loaded = await muatSkripGoogleGsi();
  if (!loaded || !window.google?.accounts?.oauth2) {
    wrap.hidden = true;
    return;
  }

  if (!googleTokenClient || googleTokenClientId !== clientId) {
    googleTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      callback: async (response) => {
        if (response?.error || !response?.access_token) {
          perbaruiLabelTombolGoogle(false);
          tampilkanErrorAuth(response?.error_description || 'Google sign-in was cancelled or denied.');
          return;
        }
        bersihkanErrorAuth();
        try {
          const sensitif = modeAutentikasi === 'register' ? ($('#chkSensitif')?.checked ?? false) : false;
          const res = await masukDenganGoogle({
            accessToken: response.access_token,
            isHealthSensitive: sensitif,
          });
          await selesaikanSesiMasuk({
            token: res.token,
            user: res.user,
            sensitifFallback: sensitif,
            isNewUser: Boolean(res.isNewUser),
          });
        } catch (err) {
          console.error('[auth] Google sign-in error:', err);
          tampilkanErrorAuth(err?.message || 'Unable to sign in with Google. Please try again.');
        } finally {
          perbaruiLabelTombolGoogle(false);
        }
      },
      error_callback: () => {
        perbaruiLabelTombolGoogle(false);
      },
    });
    googleTokenClientId = clientId;
  }

  if (!btn.dataset.googleWired) {
    btn.dataset.googleWired = '1';
    btn.addEventListener('click', () => {
      if (!googleTokenClient) return;
      bersihkanErrorAuth();
      perbaruiLabelTombolGoogle(true);
      googleTokenClient.requestAccessToken({ prompt: 'select_account' });
    });
  }
}

/** Mengembalikan input kata sandi ke kondisi tersembunyi. */
function resetTampilanPassword() {
  const passEl = /** @type {HTMLInputElement|null} */ ($('#loginPass'));
  const btnToggle = $('#btnTogglePass');
  if (passEl) passEl.type = 'password';
  if (btnToggle) {
    btnToggle.setAttribute('aria-pressed', 'false');
    btnToggle.setAttribute('aria-label', 'Show password');
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

  setText($('#loginTitle'), isRegister ? 'Create JakSafe Account' : 'Sign In to JakSafe');
  setText(
    $('#loginSub'),
    isRegister
      ? 'Sign up free to save routes and your health profile.'
      : 'Sign in with your email and password.'
  );

  const passEl = /** @type {HTMLInputElement|null} */ ($('#loginPass'));
  if (passEl) {
    passEl.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
  }

  const submitBtn = $('#btnAuthSubmit');
  if (submitBtn && !submitBtn.disabled) {
    submitBtn.innerHTML = `${isRegister ? 'Create Account' : 'Sign In'} <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>`;
  }
  if (!$('#btnGoogleAuth')?.disabled) {
    perbaruiLabelTombolGoogle(false);
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
    void siapkanTombolGoogle();
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

  const namaUser = pengguna?.name || 'JakSafe User';
  const emailUser = pengguna?.email || '';
  const inisial = inisialNama(namaUser);
  const namaPendek = namaUser.trim().split(/\s+/)[0] || 'Account';

  setText($('#userChipAva') || document.querySelector('.userchip__ava'), inisial);
  setText($('#userChipNama') || document.querySelector('.userchip__name'), namaPendek);

  const ava = document.querySelector('.usermenu__ava');
  if (ava) ava.textContent = inisial;

  setText($('#menuNama'), namaUser);
  setText($('#menuEmail'), emailUser);

  const sapaan = $('#greetBox');
  if (sapaan) {
    sapaan.innerHTML = masuk
      ? `<h1 class="search__title">Hello, ${escapeHtml(namaPendek)}</h1>
         <p class="search__sub">Health profile ${sensitifKesehatan ? 'enabled — air pollution carries higher weight during route scoring' : 'disabled — default scoring weights applied'}.</p>`
      : `<h1 class="search__title">Plan Your Route</h1>
         <p class="search__sub">Navigate Jakarta with live air quality, traffic flow, and CCTV road checks.</p>`;
  }

  show($('#menuBadgeSensitif'), masuk && sensitifKesehatan);
  show($('#btnOpenAdmin'), masuk && pengguna?.role === 'admin');
  const toggleEl = $('#btnToggleSensitif');
  if (toggleEl) {
    toggleEl.setAttribute('aria-checked', String(Boolean(sensitifKesehatan)));
  }
  setText(
    $('#menuSensitifSub'),
    sensitifKesehatan ? 'Higher weight on air quality' : 'Prioritize cleaner air'
  );
  setText($('#menuHistoryCount'), String((keadaan.riwayatPerjalanan || []).length));
}

/** Format waktu ISO ke ringkasan waktu lokal Inggris. */
function formatWaktuRiwayat(iso) {
  if (!iso) return 'Just now';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Just now';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt);
}

/** Label moda perjalanan untuk riwayat/rute tersimpan. */
function namaProfil(profileKey) {
  return PROFILES.find((p) => p.key === profileKey)?.nama || 'Car';
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
  toast(`Route loaded: ${origin.name} → ${dest.name}`);
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
      ? `${daftar.length} recent ${daftar.length === 1 ? 'trip' : 'trips'} recorded`
      : 'No trip history recorded yet';
  }
  if (btnClear) btnClear.hidden = daftar.length === 0;
  if (!listEl) return;

  if (daftar.length === 0) {
    listEl.innerHTML = '<li class="jempty">No route searches saved to your history yet.</li>';
    return;
  }

  listEl.innerHTML = daftar.map((item, idx) => {
    const entryId = escapeHtml(item.id || item._id || '');
    const asal = escapeHtml(item.origin?.name || 'Origin');
    const tujuan = escapeHtml(item.destination?.name || 'Destination');
    const koridor = item.summary ? escapeHtml(item.summary) : '';
    const skor = escapeHtml(item.score?.totalScore ?? '-');
    const labelSkor = escapeHtml(labelSkorInggris(item.score?.label || 'AMAN'));
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
          <span>Score ${skor} (${labelSkor})</span>
          ${item.distanceM ? `<span>·</span><span>${jarak} · ${durasi}</span>` : ''}
        </div>
        ${koridor ? `<p class="jitem__desc">Via ${koridor}</p>` : ''}
        <div class="jitem__foot">
          <div class="jitem__btns">
            <button type="button" class="jitem__btn jitem__btn--primary press" data-load-history="${idx}">Load Route</button>
            <button type="button" class="jitem__btn jitem__btn--del press" data-delete-history="${entryId}" aria-label="Delete this history entry">Delete</button>
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

  setText($('#menuAlertCount'), siagaCount > 0 ? `${siagaCount} Alert` : 'Monitor');

  if (metaEl) {
    const sumberCuaca = meta.weatherAvailable ? 'Live weather' : 'Corridor data';
    metaEl.textContent = `${alerts.length} corridors · ${siagaCount} Alert · ${sumberCuaca}`;
  }
  if (!listEl) return;

  if (alerts.length === 0) {
    listEl.innerHTML = '<li class="jempty">No corridor alerts for the selected region filter.</li>';
    return;
  }

  const labelLevel = (sev, rawLabel) => {
    if (sev === 'siaga') return 'Alert';
    if (sev === 'waspada') return 'Caution';
    if (sev === 'pantau') return 'Monitor';
    return rawLabel || 'Monitor';
  };

  listEl.innerHTML = alerts.map((a, idx) => {
    const hasRain = Number.isFinite(a.precipitationMm) && a.precipitationMm > 0;
    const rainText = hasRain ? `${escapeHtml(a.precipitationMm)} mm/h` : (a.weatherLabel ? escapeHtml(a.weatherLabel) : '');
    const camShort = formatNamaKamera(a.cameraName);
    const metaParts = [a.region, camShort ? `Camera ${camShort}` : ''].filter(Boolean).map(escapeHtml);
    const sourceText = (a.signals || [])
      .filter((s) => s !== 'Riwayat Koridor Rawan')
      .map(escapeHtml)
      .join(' · ') || 'Historical corridor watch';

    return `
      <li class="arow" data-sev="${escapeHtml(a.severity || 'pantau')}">
        <div class="arow__head">
          <div class="arow__titlegroup">
            <span class="astat" data-sev="${escapeHtml(a.severity || 'pantau')}">
              <span class="astat__dot" aria-hidden="true"></span>
              <span>${escapeHtml(labelLevel(a.severity, a.severityLabel))}</span>
            </span>
            <h3 class="arow__title">${escapeHtml(a.corridor)}</h3>
          </div>
          ${rainText ? `<span class="arow__rain">${rainText}</span>` : ''}
        </div>

        <p class="arow__meta">${metaParts.join(' · ')}</p>
        <p class="arow__desc">${escapeHtml(a.summary)}</p>
        ${a.mitigation && a.severity !== 'pantau' ? `<p class="arow__mit">Advice: ${escapeHtml(a.mitigation)}</p>` : ''}

        <div class="arow__foot">
          <span class="arow__source">${sourceText}</span>
          <button type="button" class="arow__mapbtn press" data-focus-alert="${idx}">View on Map</button>
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
    setText($('#menuAlertCount'), siagaCount > 0 ? `${siagaCount} Alert` : 'Monitor');
  }
  return data;
}

/** Menggambar ulang daftar rute tersimpan (pintasan rute statis tanpa skor/status). */
function gambarRuteTersimpan(daftar) {
  const wadah = $('#savedList');
  if (!wadah) return;

  if (!daftar || daftar.length === 0) {
    wadah.innerHTML = '<p class="note" style="color:var(--text-3); font-size:var(--fs-sm); margin:4px 0;">No saved routes in your account yet.</p>';
    return;
  }

  wadah.innerHTML = daftar.map((r, idx) => {
    const asalNama = escapeHtml(r.origin?.name || r.asal || 'Origin');
    const tujuanNama = escapeHtml(r.destination?.name || r.tujuan || 'Destination');
    const ruteId = escapeHtml(r.id || r._id || '');
    const moda = escapeHtml(namaProfil(r.profile));
    const jarak = Number(r.distanceM) > 0 ? formatJarak(r.distanceM) : '';
    const metaTeks = jarak ? `${moda} · ${jarak}` : moda;

    return `
      <div class="saveditem" data-idx="${idx}" data-route-id="${ruteId}">
        <span class="saveditem__ico" aria-hidden="true">${ikon('i-route', 14)}</span>
        <span class="saveditem__body press" data-load-route="${idx}" title="Click to load this route">
          <span class="saveditem__name">${asalNama} ${ikon('i-arrow-r', 12)} ${tujuanNama}</span>
          <span class="saveditem__meta">${metaTeks}</span>
        </span>
        <button type="button" class="saveditem__del press" data-delete-route="${ruteId}" title="Remove saved route" aria-label="Delete route">
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
    btnToggle.setAttribute('aria-label', tampilkan ? 'Hide password' : 'Show password');
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
      tampilkanErrorAuth('Enter a valid email address (e.g. name@email.com).', { fieldEl: emailEl });
      return;
    }
    if (!password || password.length < 6) {
      tampilkanErrorAuth('Password must be at least 6 characters.', { fieldEl: passEl });
      return;
    }

    const submitBtn = $('#btnAuthSubmit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = isRegister ? 'Creating account...' : 'Signing in...';
    }

    try {
      let res;
      if (isRegister) {
        const namaInput = nameEl?.value?.trim() || '';
        const awalan = email.split('@')[0] || 'User';
        const nama = namaInput || (awalan.charAt(0).toUpperCase() + awalan.slice(1));
        res = await daftarPengguna({
          email,
          password,
          name: nama,
          isHealthSensitive: sensitif,
        });
        toast('Account created successfully.');
      } else {
        res = await masukPengguna({ email, password });
      }

      const { token, user } = res;
      await selesaikanSesiMasuk({
        token,
        user,
        sensitifFallback: isRegister ? sensitif : false,
        isNewUser: isRegister,
      });
    } catch (err) {
      console.error('[auth] Auth error:', err);
      if (!isRegister && err.status === 404) {
        tampilkanErrorAuth(
          'This email is not registered yet. Check your spelling or create a new account.',
          {
            fieldEl: emailEl,
            actionLabel: 'Sign up with this email',
            onAction: () => aturModeAuth('register', { focusField: true }),
          }
        );
      } else if (!isRegister && err.status === 401) {
        tampilkanErrorAuth('Incorrect email or password.', { fieldEl: passEl });
      } else if (isRegister && err.status === 409) {
        tampilkanErrorAuth(
          'This email is already registered. Please sign in with that account.',
          {
            fieldEl: emailEl,
            actionLabel: 'Switch to Sign In',
            onAction: () => aturModeAuth('login', { focusField: false }),
          }
        );
      } else {
        tampilkanErrorAuth(err.message || 'Unable to sign in. Check your connection and try again.');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        const label = modeAutentikasi === 'register' ? 'Create Account' : 'Sign In';
        submitBtn.innerHTML = `${label} <span class="btn__dot">${ikon('i-arrow-r', 16)}</span>`;
      }
    }
  });

  $('#btnGuest')?.addEventListener('click', () => {
    bukaModal(false);
    toast('Continuing as guest. Core routing features remain available.');
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
      ? 'Health profile enabled. Air pollution carries higher weight during route scoring.'
      : 'Health profile disabled. Default scoring weights restored.');
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
      toast('Failed to load flood alerts.');
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
        console.warn('[history] Failed to refresh history:', err?.message);
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
        toast('History entry deleted.');
      } catch {
        toast('Failed to delete history entry.');
      }
    }
  });

  $('#btnClearHistory')?.addEventListener('click', async () => {
    const { token } = getState();
    if (!token) return;
    try {
      await kosongkanRiwayat(token);
      setState({ riwayatPerjalanan: [] });
      toast('Trip history cleared.');
    } catch {
      toast('Failed to clear trip history.');
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
      toast('Failed to filter region.');
    }
  });

  $('#btnRefreshAlerts')?.addEventListener('click', async () => {
    try {
      await muatPeringatanArea({ region: wilayahFilterAktif, render: true });
      toast('Corridor alert status refreshed.');
    } catch {
      toast('Failed to refresh corridor data.');
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
      toast('Flood alert preferences saved.');
    } catch {
      toast('Failed to save alert preferences.');
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
    toast(`Map focused on ${item.corridor}`);
  });

  // Tombol Keluar (Logout)
  $('#btnLogout')?.addEventListener('click', () => {
    const oldToken = getState().token || localStorage.getItem('jaksafe_token');
    if (oldToken) {
      keluarPengguna(oldToken).catch(() => {});
    }
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
    toast('You have signed out.');
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
        toast('Saved route removed.');
      } catch (err) {
        toast('Failed to delete route.');
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
