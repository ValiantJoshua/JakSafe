/*
   Pengendali Halaman Konsol Operasional Admin JakSafe (/admin.html).
   Menangani autentikasi admin, tab kesehatan & katalog CCTV, serta tab
   monitoring kuota TomTom, hit-rate cache, rate limiter, dan audit trail agen.
*/

import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/admin.css';

import { spriteIkon, ikon } from '../ui/icons.js';
import { $, $$, show } from '../utils/dom.js';
import {
  escapeHtml,
  formatJarak,
  formatDurasi,
  formatLama,
  KOSONG,
} from '../utils/format.js';
import { pasangPengendaliTema } from '../ui/controllers/themeController.js';
import { masukPengguna, ambilProfilSaya } from '../api/authApi.js';
import {
  ambilDaftarCctvAdmin,
  picuSweepCctvAdmin,
  ujiKameraCctvAdmin,
  tambahKameraCctvAdmin,
  perbaruiKameraCctvAdmin,
  ubahStatusAktifCctvAdmin,
  hapusKameraCctvAdmin,
  pulihkanKameraCctvAdmin,
  ambilMonitoringOverviewAdmin,
  ambilCacheStatsAdmin,
  ambilAuditLogAgenAdmin,
  bersihkanCacheAdmin,
} from '../api/adminApi.js';

const AUTH_TOKEN_KEY = 'jaksafe_token';
const AUTH_USER_KEY = 'jaksafe_user';

const STORE_LABELS = {
  cctvVision: 'Visi CCTV AI',
  cctvHealth: 'Kesehatan kamera',
  routeGeometry: 'Geometri rute OSRM',
  navigation: 'Rekomendasi navigasi',
  geocoding: 'Geocoding alamat',
};

const LIMITER_LABELS = {
  api_general: 'API umum (/api)',
  auth_sensitive: 'Autentikasi (/auth)',
  compute_ai: 'Navigasi & AI (/navigate)',
  traffic_tiles: 'Tile lalu lintas (/tomtom/flow)',
  admin_api: 'Konsol admin (/api/admin)',
};

const keadaan = {
  token: null,
  pengguna: null,
  tabAktif: 'cctv',

  cctvFilter: {
    status: 'all',
    enabled: 'all',
    city: 'all',
    q: '',
    sort: 'status_offline_first',
    limit: 50,
    offset: 0,
  },
  cctvData: null,
  cctvMuat: false,
  sweepTimer: null,
  sedangEditKamera: null,

  monitoringData: null,
  cacheStatsDirect: null,
  logsData: null,
  logsFilter: {
    status: 'all',
    scoreLabel: 'all',
    fallbackOnly: false,
    limit: 40,
  },
  monitoringMuat: false,

  onConfirmAction: null,
};

function bacaLocal(kunci) {
  try {
    return localStorage.getItem(kunci);
  } catch {
    return null;
  }
}

function simpanAuthLocal(token, pengguna) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);

    if (pengguna) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(pengguna));
    else localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    // Abaikan jika penyimpanan dibatasi
  }
}

function formatWaktuId(iso) {
  if (!iso) return KOSONG;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return KOSONG;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(d);
}

function formatUkuranByte(bytes) {
  const num = Number(bytes || 0);
  if (!Number.isFinite(num) || num <= 0) return '0 KB';
  if (num < 1024 * 1024) return `${Math.round(num / 1024)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

function statusDotHtml(tone, label) {
  return `<span class="status-line"><span class="status-dot status-dot--${escapeHtml(tone)}" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

function cameraHealthHtml(status) {
  if (status === 'online') return statusDotHtml('ok', 'Online');
  if (status === 'offline') return statusDotHtml('danger', 'Offline');
  return statusDotHtml('warn', 'Belum diuji');
}

function scoreStatusHtml(score) {
  const rawLabel = score?.label || 'Tidak dinilai';
  const total = Number.isFinite(score?.totalScore) ? ` · ${score.totalScore}` : '';
  if (rawLabel === 'AMAN') return statusDotHtml('ok', `Aman${total}`);
  if (rawLabel === 'HATI-HATI') return statusDotHtml('warn', `Hati-hati${total}`);
  if (rawLabel === 'HINDARI') return statusDotHtml('danger', `Hindari${total}`);
  return statusDotHtml('muted', rawLabel);
}

function tampilkanPesan(teks, tone = 'ok') {
  const banner = $('#adminToast');
  if (!banner) return;
  const dot = $('#adminToastDot');
  if (dot) {
    const dotTone = tone === 'error' ? 'danger' : tone === 'warn' ? 'warn' : 'ok';
    dot.className = `status-dot status-dot--${dotTone}`;
  }
  const txt = $('#adminToastText');
  if (txt) txt.textContent = teks;
  show(banner, true);
}

function sembunyikanPesan() {
  show($('#adminToast'), false);
}

function hentikanPollingSweep() {
  if (keadaan.sweepTimer) {
    clearTimeout(keadaan.sweepTimer);
    keadaan.sweepTimer = null;
  }
}

function keluarSesiAdmin() {
  hentikanPollingSweep();
  keadaan.token = null;
  keadaan.pengguna = null;
  keadaan.cctvData = null;
  keadaan.monitoringData = null;
  keadaan.cacheStatsDirect = null;
  keadaan.logsData = null;
  simpanAuthLocal(null, null);
  perbaruiTampilanAuth();
}

function rakitKerangka() {
  const root = $('#adminApp');
  if (!root) return;

  root.innerHTML = `
${spriteIkon()}

<a class="skip-link" href="#mainContent">Lewati ke konten utama</a>

<header class="admin-topbar">
  <a class="admin-brand" href="/app.html" aria-label="Kembali ke aplikasi peta JakSafe">
    <span class="admin-brand__mark">${ikon('i-shield', 16)}</span>
    <span class="admin-brand__text">
      <span class="admin-brand__name">JakSafe</span>
      <span class="admin-brand__sub">Konsol Operasional</span>
    </span>
  </a>

  <div class="admin-topbar__right">
    <div class="admin-userpill" id="adminUserPill" hidden>
      <span class="status-dot status-dot--ok" aria-hidden="true"></span>
      <strong id="adminUserName">Admin</strong>
      <span id="adminUserEmail" class="cell-sub"></span>
      <span class="role-tag">Admin</span>
    </div>

    <div class="themeswitch" role="group" aria-label="Pilih tema tampilan">
      <button type="button" class="themeswitch__btn" data-theme-set="terang" aria-pressed="true">Terang</button>
      <button type="button" class="themeswitch__btn" data-theme-set="gelap" aria-pressed="false">Gelap</button>
    </div>

    <a class="btn btn--sm" href="/app.html">${ikon('i-arrow', 16)} Peta Utama</a>
    <button type="button" class="btn btn--sm btn--quiet" id="btnAdminLogout" hidden>
      ${ikon('i-logout', 16)} Keluar
    </button>
  </div>
</header>

<main class="admin-main" id="mainContent" tabindex="-1">
  <div class="admin-toast" id="adminToast" role="status" aria-live="polite" hidden>
    <span class="admin-toast__content">
      <span class="status-dot status-dot--ok" id="adminToastDot" aria-hidden="true"></span>
      <span id="adminToastText"></span>
    </span>
    <button type="button" class="btn btn--sm" id="btnCloseToast" aria-label="Tutup pemberitahuan">Tutup</button>
  </div>

  <!-- Gerbang Masuk / Verifikasi Role Admin -->
  <section class="auth-gate" id="adminAuthGate" aria-labelledby="authGateTitle" hidden>
    <div class="auth-gate__head">
      <div class="auth-gate__icon">${ikon('i-shield', 16)}</div>
      <div>
        <h1 id="authGateTitle">Akses Konsol Administrator</h1>
        <p class="auth-gate__sub" id="authGateSub">
          Masuk dengan akun administrator JakSafe untuk mengelola katalog CCTV dan memantau telemetri backend
        </p>
      </div>
    </div>

    <div class="form-error" id="authRoleMismatchBox" role="alert" hidden>
      Akun <strong id="mismatchEmailText"></strong> terdaftar sebagai pengguna standar (<code>user</code>) dan tidak memiliki akses ke konsol admin
      <div class="auth-gate__actions">
        <button type="button" class="btn btn--sm" id="btnSwitchAccount">Ganti Akun Admin</button>
        <a class="btn btn--sm" href="/app.html">Kembali ke Peta</a>
      </div>
    </div>

    <form id="adminLoginForm" novalidate>
      <div class="form-error" id="adminLoginError" role="alert" hidden></div>

      <div class="field">
        <label for="loginEmail">Email administrator</label>
        <input id="loginEmail" name="email" type="email" autocomplete="username" required placeholder="admin@jaksafe.id">
      </div>

      <div class="field">
        <label for="loginPassword">Kata sandi</label>
        <div class="pwd-wrap">
          <input id="loginPassword" name="password" type="password" autocomplete="current-password" minlength="6" required placeholder="Minimal 6 karakter">
          <button type="button" class="pwd-wrap__toggle" id="btnToggleLoginPwd" aria-pressed="false" aria-label="Tampilkan kata sandi">
            Lihat
          </button>
        </div>
      </div>

      <button type="submit" class="btn btn--primary" id="btnLoginSubmit" style="width:100%">
        Masuk Konsol Admin
      </button>
    </form>

    <div class="auth-gate__note">
      Akun administrator dikonfigurasi lewat <code>ADMIN_EMAIL</code> / <code>ADMIN_EMAILS</code> atau skrip <code>npm run admin:seed</code>
    </div>
  </section>

  <!-- Konten Dashboard Admin -->
  <div id="adminDashboard" hidden>
    <div class="admin-pagehead">
      <div>
        <h1 id="dashboardHeading">Konsol Operasional &amp; Telemetri</h1>
        <p>Kesehatan 500+ kamera CCTV Jakarta, kuota tile TomTom, hit-rate cache, dan audit agen rute</p>
      </div>
    </div>

    <div class="admin-tabs" role="tablist" aria-label="Bagian Konsol Admin">
      <button
        type="button"
        class="admin-tab"
        role="tab"
        id="tab-cctv"
        aria-selected="true"
        aria-controls="panel-cctv"
        tabindex="0"
        data-tab="cctv"
      >
        Kesehatan &amp; Katalog CCTV
      </button>
      <button
        type="button"
        class="admin-tab"
        role="tab"
        id="tab-monitoring"
        aria-selected="false"
        aria-controls="panel-monitoring"
        tabindex="-1"
        data-tab="monitoring"
      >
        Kuota, Cache &amp; Performa Agen
      </button>
    </div>

    <!-- TAB 1: KESEHATAN & KATALOG CCTV -->
    <section role="tabpanel" id="panel-cctv" aria-labelledby="tab-cctv">
      <div class="kpi-grid" id="cctvSummaryGrid" aria-label="Ringkasan kesehatan kamera"></div>

      <div class="panel">
        <div class="panel__head">
          <div>
            <h2 class="panel__title">Katalog &amp; Kesehatan Kamera CCTV</h2>
            <p class="panel__sub">
              Perubahan disimpan ke store override persisten tanpa menyentuh berkas dasar <code>cctvCatalog.json</code>
            </p>
          </div>
          <div class="toolbar__actions">
            <button type="button" class="btn" id="btnRunSweep">
              ${ikon('i-clock', 16)} <span id="btnRunSweepLabel">Sweep Kamera</span>
            </button>
            <button type="button" class="btn btn--primary" id="btnAddCamera">
              ${ikon('i-plus', 16)} Tambah Kamera
            </button>
          </div>
        </div>

        <search>
          <form class="filter-form" id="cctvFilterForm">
            <div class="filter-item filter-item--grow">
              <label for="fCctvQ">Cari kamera</label>
              <input id="fCctvQ" name="q" type="search" placeholder="Cari ID, simpang, atau error">
            </div>

            <div class="filter-item">
              <label for="fCctvStatus">Kesehatan</label>
              <select id="fCctvStatus" name="status">
                <option value="all">Semua status</option>
                <option value="offline">Offline</option>
                <option value="online">Online</option>
                <option value="unknown">Belum diuji</option>
              </select>
            </div>

            <div class="filter-item">
              <label for="fCctvEnabled">Layanan publik</label>
              <select id="fCctvEnabled" name="enabled">
                <option value="all">Semua layanan</option>
                <option value="true">Aktif di peta</option>
                <option value="false">Dinonaktifkan</option>
              </select>
            </div>

            <div class="filter-item">
              <label for="fCctvCity">Wilayah</label>
              <select id="fCctvCity" name="city">
                <option value="all">Semua wilayah</option>
              </select>
            </div>

            <div class="filter-item">
              <label for="fCctvSort">Urutkan</label>
              <select id="fCctvSort" name="sort">
                <option value="status_offline_first">Offline dulu</option>
                <option value="latency_desc">Latensi tertinggi</option>
                <option value="name">Nama (A–Z)</option>
                <option value="status_online_first">Online dulu</option>
              </select>
            </div>

            <button type="submit" class="btn btn--primary">Terapkan</button>
            <button type="button" class="btn" id="btnFilterOfflineOnly">Hanya Offline</button>
            <button type="button" class="btn btn--quiet" id="btnResetCctvFilter">Reset</button>
          </form>
        </search>

        <div class="table-wrap" id="cctvTableRegion" role="region" aria-label="Tabel katalog kamera CCTV" tabindex="0">
          <table class="admin-table admin-table--cctv">
            <caption class="sr-only">Daftar kamera CCTV beserta status kesehatan, alasan error, latensi, dan kontrol katalog</caption>
            <thead>
              <tr>
                <th scope="col">Kamera</th>
                <th scope="col">Kesehatan &amp; Alasan Error</th>
                <th scope="col" class="col-num">Latensi</th>
                <th scope="col">Layanan</th>
                <th scope="col">Aksi</th>
              </tr>
            </thead>
            <tbody id="cctvTableBody">
              <tr><td colspan="5" class="empty-box">Memuat daftar kamera</td></tr>
            </tbody>
          </table>
        </div>

        <div class="table-footer" id="cctvPagination">
          <span id="cctvPageInfo">Menampilkan 0 kamera</span>
          <div class="toolbar__actions">
            <button type="button" class="btn btn--sm" id="btnCctvPrev" disabled>Sebelumnya</button>
            <button type="button" class="btn btn--sm" id="btnCctvNext" disabled>Berikutnya</button>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 2: KUOTA, CACHE & PERFORMA AGEN -->
    <section role="tabpanel" id="panel-monitoring" aria-labelledby="tab-monitoring" hidden>
      <div class="panel__head">
        <div>
          <h2 class="panel__title">Telemetri Layanan &amp; Audit Performa Agen</h2>
          <p class="panel__sub" id="monitorLastSync">Memuat ringkasan telemetri</p>
        </div>
        <div class="toolbar__actions">
          <button type="button" class="btn" id="btnRefreshMonitoring">
            ${ikon('i-clock', 16)} Muat Ulang
          </button>
          <button type="button" class="btn btn--danger" id="btnClearAllCache">
            Kosongkan Semua Cache
          </button>
        </div>
      </div>

      <!-- Asymmetric 2/3 Chart + 1/3 Quota Ledger -->
      <div class="monitor-split">
        <section class="panel" aria-labelledby="tomtomChartTitle">
          <div class="panel__head">
            <div>
              <h2 class="panel__title" id="tomtomChartTitle">Riwayat Pemakaian Kuota TomTom (7 Hari UTC)</h2>
              <p class="panel__sub">Panggilan tile upstream setelah deduplikasi cache RAM &amp; disk; aksen biru menandai hari UTC berjalan</p>
            </div>
          </div>
          <div class="chart-box" id="tomtomHistoryChart"></div>
        </section>

        <section class="panel" aria-labelledby="tomtomQuotaTitle">
          <div class="panel__head">
            <div>
              <h2 class="panel__title" id="tomtomQuotaTitle">Kuota Harian &amp; Cache Tile</h2>
              <p class="panel__sub" id="tomtomDateLabel">Tanggal UTC —</p>
            </div>
            <span id="tomtomKeyBadge"></span>
          </div>

          <div class="quota-meter" id="tomtomQuotaMeter">
            <div class="quota-meter__head">
              <span id="tomtomUsageLabel">0 / 8.000 tile</span>
              <span id="tomtomPercentLabel" class="mono">0%</span>
            </div>
            <div class="quota-meter__track">
              <div class="quota-meter__fill" id="tomtomQuotaFill"></div>
            </div>
          </div>

          <ul class="kv-list" id="tomtomTileStats" aria-label="Rincian cache tile TomTom"></ul>
        </section>
      </div>

      <!-- Performa Agen ReAct & Rate Limit -->
      <section class="panel" aria-labelledby="execPerfTitle">
        <div class="panel__head">
          <div>
            <h2 class="panel__title" id="execPerfTitle">Performa Agen ReAct &amp; Distribusi Keselamatan Rute</h2>
            <p class="panel__sub" id="execStorageSub">Sumber audit trail: —</p>
          </div>
        </div>

        <div class="kpi-grid kpi-grid--3" id="execKpiGrid"></div>

        <div class="agent-split">
          <div>
            <h3 class="subblock-title">Proporsi Skor Keselamatan Rute</h3>
            <div class="dist-bar" id="scoreDistBar" role="img" aria-label="Proporsi skor Aman, Hati-hati, dan Hindari"></div>
            <div class="dist-legend" id="scoreDistLegend"></div>

            <h3 class="subblock-title" style="margin-top:24px">Penggunaan Model Gemini</h3>
            <ul class="kv-list" id="modelUsageList"></ul>
          </div>

          <div>
            <h3 class="subblock-title">Batas Laju API (Rate Limiter)</h3>
            <ul class="kv-list" id="rateLimitList"></ul>
          </div>
        </div>
      </section>

      <!-- Cache Hit Rate -->
      <section class="panel" aria-labelledby="cacheStatsTitle">
        <div class="panel__head">
          <div>
            <h2 class="panel__title" id="cacheStatsTitle">Statistik Cache &amp; Hit-Rate (<code>/api/cache/stats</code>)</h2>
            <p class="panel__sub" id="cacheAggregateSub">Memuat hit-rate agregat</p>
          </div>
        </div>

        <div class="table-wrap" role="region" aria-label="Tabel statistik store cache" tabindex="0">
          <table class="admin-table admin-table--cache">
            <caption class="sr-only">Hit rate, jumlah entri, TTL, dan kontrol pembersihan tiap cache LRU backend</caption>
            <thead>
              <tr>
                <th scope="col">Store Cache</th>
                <th scope="col" class="col-num">Hit Rate</th>
                <th scope="col" class="col-num">Hits / Misses</th>
                <th scope="col" class="col-num">Entri Aktif</th>
                <th scope="col" class="col-num">TTL Bawaan</th>
                <th scope="col">Aksi</th>
              </tr>
            </thead>
            <tbody id="cacheStatsBody">
              <tr><td colspan="6" class="empty-box">Memuat statistik cache</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Audit Trail ExecutionLog -->
      <section class="panel" aria-labelledby="execLogsTitle">
        <div class="panel__head">
          <div>
            <h2 class="panel__title" id="execLogsTitle">Audit Trail Eksekusi Agen (<code>ExecutionLog</code>)</h2>
            <p class="panel__sub">Jejak permintaan navigasi, latensi eksekusi, model LLM aktif, dan rincian langkah ReAct</p>
          </div>
        </div>

        <form class="filter-form" id="logsFilterForm">
          <div class="filter-item">
            <label for="fLogStatus">Status</label>
            <select id="fLogStatus" name="status">
              <option value="all">Semua status</option>
              <option value="success">Sukses</option>
              <option value="failed">Gagal</option>
            </select>
          </div>

          <div class="filter-item">
            <label for="fLogScore">Kategori skor</label>
            <select id="fLogScore" name="scoreLabel">
              <option value="all">Semua kategori</option>
              <option value="AMAN">Aman</option>
              <option value="HATI-HATI">Hati-hati</option>
              <option value="HINDARI">Hindari</option>
            </select>
          </div>

          <label class="filter-check">
            <input type="checkbox" id="fLogFallbackOnly" name="fallbackOnly">
            Hanya fallback Gemini
          </label>

          <button type="submit" class="btn btn--primary">Terapkan</button>
        </form>

        <div class="table-wrap" role="region" aria-label="Tabel audit trail eksekusi agen" tabindex="0">
          <table class="admin-table admin-table--logs">
            <caption class="sr-only">Riwayat eksekusi ReAct agent termasuk skor, model Gemini, fallback, dan durasi</caption>
            <thead>
              <tr>
                <th scope="col">Waktu &amp; ID</th>
                <th scope="col">Asal &rarr; Tujuan</th>
                <th scope="col">Moda</th>
                <th scope="col">Skor</th>
                <th scope="col">Model Gemini</th>
                <th scope="col" class="col-num">Durasi</th>
                <th scope="col">Jejak</th>
              </tr>
            </thead>
            <tbody id="execLogsBody">
              <tr><td colspan="7" class="empty-box">Memuat log eksekusi</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </div>
</main>

<!-- Modal Tambah / Edit Kamera CCTV -->
<dialog class="admin-dialog" id="cameraDialog" closedby="any" aria-labelledby="cameraDialogTitle">
  <form id="cameraForm">
    <div class="admin-dialog__head">
      <h2 id="cameraDialogTitle">Tambah Kamera CCTV</h2>
      <button type="button" class="btn btn--sm btn--quiet" data-close-dialog="cameraDialog" aria-label="Tutup modal">&times;</button>
    </div>

    <div class="admin-dialog__body">
      <div class="form-error" id="cameraFormError" role="alert" hidden></div>

      <div class="form-grid-2">
        <div class="field">
          <label for="camId">ID kamera (opsional saat tambah)</label>
          <input id="camId" name="id" type="text" pattern="[A-Za-z0-9_-]{2,80}" placeholder="jaksel-kemang-01">
        </div>
        <div class="field">
          <label for="camName">Nama lokasi kamera *</label>
          <input id="camName" name="name" type="text" required placeholder="Simpang Kemang Raya">
        </div>
      </div>

      <div class="field">
        <label for="camUrl">URL snapshot gambar (HTTP/HTTPS publik) *</label>
        <input id="camUrl" name="url" type="url" required placeholder="https://example.org/cctv/frame.jpg">
      </div>

      <div class="field">
        <label for="camHlsUrl">URL live stream HLS (.m3u8, opsional)</label>
        <input id="camHlsUrl" name="hlsUrl" type="url" placeholder="https://example.org/live/stream.m3u8">
      </div>

      <div class="form-grid-2">
        <div class="field">
          <label for="camCity">Wilayah kota</label>
          <input id="camCity" name="city" type="text" placeholder="Jakarta Selatan">
        </div>
        <div class="field">
          <label for="camProvider">Penyedia sumber</label>
          <input id="camProvider" name="provider" type="text" placeholder="Dishub DKI">
        </div>
      </div>

      <div class="form-grid-2">
        <div class="field">
          <label for="camLat">Latitude *</label>
          <input id="camLat" name="lat" type="number" step="any" min="-90" max="90" required placeholder="-6.2607">
        </div>
        <div class="field">
          <label for="camLon">Longitude *</label>
          <input id="camLon" name="lon" type="number" step="any" min="-180" max="180" required placeholder="106.8135">
        </div>
      </div>

      <div class="form-grid-2">
        <div class="field">
          <label for="camHeading">Arah hadap (0–360&deg;)</label>
          <input id="camHeading" name="headingDeg" type="number" step="any" min="0" max="360" placeholder="90">
        </div>
        <div class="field">
          <label for="camFov">Sudut pandang FOV (10–180&deg;)</label>
          <input id="camFov" name="fovDeg" type="number" step="any" min="10" max="180" placeholder="70">
        </div>
      </div>

      <div class="form-grid-2">
        <div class="field">
          <label for="camRange">Jarak pantau maks (10–5000 m)</label>
          <input id="camRange" name="rangeM" type="number" step="any" min="10" max="5000" placeholder="120">
        </div>
        <label class="filter-check">
          <input type="checkbox" id="camEnabled" name="enabled" checked>
          Aktifkan di layanan publik
        </label>
      </div>
    </div>

    <div class="admin-dialog__foot">
      <button type="button" class="btn" data-close-dialog="cameraDialog">Batal</button>
      <button type="submit" class="btn btn--primary" id="btnSaveCamera">Simpan Kamera</button>
    </div>
  </form>
</dialog>

<!-- Modal Detail Jejak ExecutionLog -->
<dialog class="admin-dialog" id="traceDialog" closedby="any" aria-labelledby="traceDialogTitle">
  <div class="admin-dialog__head">
    <h2 id="traceDialogTitle">Jejak Penalaran Agen</h2>
    <button type="button" class="btn btn--sm btn--quiet" data-close-dialog="traceDialog" aria-label="Tutup modal">&times;</button>
  </div>
  <div class="admin-dialog__body" id="traceDialogBody"></div>
  <div class="admin-dialog__foot">
    <button type="button" class="btn btn--primary" data-close-dialog="traceDialog">Tutup</button>
  </div>
</dialog>

<!-- Modal Konfirmasi Aksi Destruktif -->
<dialog class="admin-dialog" id="confirmDialog" closedby="any" aria-labelledby="confirmDialogTitle">
  <div class="admin-dialog__head">
    <h2 id="confirmDialogTitle">Konfirmasi Aksi</h2>
    <button type="button" class="btn btn--sm btn--quiet" data-close-dialog="confirmDialog" aria-label="Tutup modal">&times;</button>
  </div>
  <div class="admin-dialog__body">
    <p id="confirmDialogMessage" style="margin:0;line-height:1.55"></p>
  </div>
  <div class="admin-dialog__foot">
    <button type="button" class="btn" data-close-dialog="confirmDialog">Batal</button>
    <button type="button" class="btn btn--danger" id="btnConfirmProceed">Lanjutkan</button>
  </div>
</dialog>
`;
}

function perbaruiTampilanAuth() {
  const user = keadaan.pengguna;
  const isLoggedIn = Boolean(keadaan.token && user);
  const isAdmin = Boolean(isLoggedIn && user.role === 'admin');

  show($('#adminUserPill'), isAdmin);
  show($('#btnAdminLogout'), isAdmin);
  show($('#adminDashboard'), isAdmin);
  show($('#adminAuthGate'), !isAdmin);

  if (isAdmin) {
    $('#adminUserName').textContent = user.name || 'Administrator';
    $('#adminUserEmail').textContent = user.email || '';
    muatDaftarCctv();
    if (keadaan.tabAktif === 'monitoring') {
      muatDataMonitoring();
    }
    return;
  }

  hentikanPollingSweep();

  if (isLoggedIn && user.role !== 'admin') {
    $('#mismatchEmailText').textContent = user.email || 'Anda';
    show($('#authRoleMismatchBox'), true);
    show($('#adminLoginForm'), false);
  } else {
    show($('#authRoleMismatchBox'), false);
    show($('#adminLoginForm'), true);
  }
}

function bukaKonfirmasi({ title, message, confirmLabel = 'Lanjutkan', onConfirm }) {
  const dlg = $('#confirmDialog');
  if (!dlg) return;
  $('#confirmDialogTitle').textContent = title;
  $('#confirmDialogMessage').textContent = message;
  $('#btnConfirmProceed').textContent = confirmLabel;
  keadaan.onConfirmAction = onConfirm;
  dlg.showModal();
}

function aktifkanTab(namaTab, { fokusTab = false } = {}) {
  keadaan.tabAktif = namaTab === 'monitoring' ? 'monitoring' : 'cctv';

  for (const btn of $$('.admin-tab')) {
    const selected = btn.dataset.tab === keadaan.tabAktif;
    btn.setAttribute('aria-selected', String(selected));
    btn.setAttribute('tabindex', selected ? '0' : '-1');
    if (selected && fokusTab) btn.focus();
  }

  show($('#panel-cctv'), keadaan.tabAktif === 'cctv');
  show($('#panel-monitoring'), keadaan.tabAktif === 'monitoring');

  if (keadaan.pengguna?.role === 'admin') {
    if (keadaan.tabAktif === 'monitoring' && !keadaan.monitoringData) {
      muatDataMonitoring();
    }
  }
}

/* ── TAB 1: CCTV ── */

function perbaruiDropdownWilayah(cities = []) {
  const select = $('#fCctvCity');
  if (!select) return;
  const current = keadaan.cctvFilter.city || 'all';
  const options = ['<option value="all">Semua wilayah</option>'];
  for (const city of cities) {
    options.push(`<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`);
  }
  select.innerHTML = options.join('');
  select.value = cities.includes(current) ? current : 'all';
}

function sinkronkanTombolSweep(sweepInProgress) {
  const btn = $('#btnRunSweep');
  const lbl = $('#btnRunSweepLabel');
  if (!btn || !lbl) return;
  btn.disabled = Boolean(sweepInProgress);
  lbl.textContent = sweepInProgress ? 'Sweep Berjalan...' : 'Sweep Kamera';
}

function jadwalkanPollingSweep() {
  hentikanPollingSweep();
  keadaan.sweepTimer = setTimeout(() => {
    if (keadaan.pengguna?.role === 'admin') {
      muatDaftarCctv({ senyap: true });
    }
  }, 2500);
}

async function muatDaftarCctv({ senyap = false } = {}) {
  if (!keadaan.token) return;
  keadaan.cctvMuat = true;
  if (!senyap && !keadaan.cctvData) {
    $('#cctvTableBody').innerHTML = '<tr><td colspan="5" class="empty-box">Memuat daftar kamera CCTV</td></tr>';
  }

  try {
    const res = await ambilDaftarCctvAdmin(keadaan.token, keadaan.cctvFilter);
    keadaan.cctvData = res;
    perbaruiDropdownWilayah(res.cities || []);
    renderRingkasanCctv(res.summary, res.catalogStats);
    renderTabelCctv(res);

    const berjalan = Boolean(res.summary?.sweepInProgress);
    sinkronkanTombolSweep(berjalan);
    if (berjalan) jadwalkanPollingSweep();
    else hentikanPollingSweep();
  } catch (err) {
    if (err.status === 401) {
      keluarSesiAdmin();
      tampilkanPesan('Sesi admin berakhir, silakan masuk kembali', 'warn');
      return;
    }
    tampilkanPesan(err.message || 'Gagal memuat katalog CCTV', 'error');
    if (!keadaan.cctvData) {
      $('#cctvTableBody').innerHTML = `<tr><td colspan="5" class="empty-box">${escapeHtml(err.message)}</td></tr>`;
    }
  } finally {
    keadaan.cctvMuat = false;
  }
}

function renderRingkasanCctv(summary = {}, catalogStats = {}) {
  const grid = $('#cctvSummaryGrid');
  if (!grid) return;

  const fmt = new Intl.NumberFormat('id-ID');
  const activeTotal = Number(catalogStats.activeTotal ?? summary.total ?? 0);
  const catalogTotal = Number(catalogStats.catalogTotal ?? summary.total ?? 0);
  const disabledCount = Number(catalogStats.disabledCount || 0);
  const customCount = Number(catalogStats.customCount || 0);
  const online = Number(summary.online ?? 0);
  const offline = Number(summary.offline ?? 0);
  const unknown = Number(summary.unknown ?? 0);
  const avgLat = summary.avgLatencyMs !== null && summary.avgLatencyMs !== undefined
    ? `${fmt.format(Math.round(summary.avgLatencyMs))} ms`
    : KOSONG;
  const pctOnline = activeTotal > 0 ? Math.round((online / activeTotal) * 100) : 0;

  grid.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-card__label">
        <span>Katalog aktif</span>
        <span class="mono">${fmt.format(catalogTotal)} total</span>
      </div>
      <div class="kpi-card__value">${fmt.format(activeTotal)}</div>
      <div class="kpi-card__meta">
        ${fmt.format(disabledCount)} nonaktif · ${fmt.format(customCount)} kustom
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card__label">
        <span>Kamera online</span>
        <span class="status-dot status-dot--ok" aria-hidden="true"></span>
      </div>
      <div class="kpi-card__value">${fmt.format(online)}</div>
      <div class="kpi-card__meta">${pctOnline}% dari kamera aktif</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card__label">
        <span>Kamera offline</span>
        <span class="status-dot status-dot--danger" aria-hidden="true"></span>
      </div>
      <div class="kpi-card__value">${fmt.format(offline)}</div>
      <div class="kpi-card__meta">${fmt.format(unknown)} belum diuji sejak startup</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card__label">
        <span>Latensi rata-rata</span>
        <span class="mono">HTTP probe</span>
      </div>
      <div class="kpi-card__value">${escapeHtml(avgLat)}</div>
      <div class="kpi-card__meta">
        Sweep terakhir: ${escapeHtml(formatWaktuId(summary.lastSweepAt))}
      </div>
    </div>
  `;
}

function renderTabelCctv(res) {
  const tbody = $('#cctvTableBody');
  if (!tbody) return;

  const cameras = Array.isArray(res?.cameras) ? res.cameras : [];
  if (cameras.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-box">Tidak ada kamera yang cocok dengan filter saat ini</td></tr>';
  } else {
    tbody.innerHTML = cameras.map((cam) => {
      const originFlags = [
        cam.isCustom ? '<span class="meta-tag">Kustom</span>' : '',
        !cam.isCustom && cam.hasOverride ? '<span class="meta-tag">Dimodifikasi</span>' : '',
        cam.hasLiveStream ? '<span class="meta-tag">HLS</span>' : '',
      ].filter(Boolean).join('');

      const reason = cam.statusReason
        ? `<div class="cell-sub">${escapeHtml(cam.statusReason)}</div>`
        : '<div class="cell-sub">Tanpa kendala tercatat</div>';

      const latStr = cam.latencyMs !== null && cam.latencyMs !== undefined
        ? `<span class="mono">${Math.round(cam.latencyMs)} ms</span>`
        : KOSONG;
      const checkedStr = cam.checkedAt
        ? `<div class="cell-sub">${escapeHtml(formatWaktuId(cam.checkedAt))}</div>`
        : '<div class="cell-sub">Belum dicek</div>';

      const isEnabled = cam.enabled !== false;
      const serviceStatus = isEnabled
        ? statusDotHtml('ok', 'Aktif publik')
        : statusDotHtml('muted', 'Nonaktif');

      const toggleLabel = isEnabled ? 'Nonaktifkan' : 'Aktifkan';
      const showRestore = !cam.isCustom && (cam.hasOverride || !isEnabled);

      return `
        <tr data-cam-id="${escapeHtml(cam.id)}" data-disabled="${String(!isEnabled)}">
          <td>
            <div class="cell-stack">
              <div class="cell-title">${escapeHtml(cam.name)}</div>
              <div class="cell-sub mono">${escapeHtml(cam.id)}</div>
              <div class="cell-sub">${escapeHtml(cam.city || 'Jakarta')} · ${escapeHtml(cam.provider || 'Dishub DKI')}</div>
              ${originFlags ? `<div class="cell-tags">${originFlags}</div>` : ''}
            </div>
          </td>
          <td>
            <div class="cell-stack">
              <div>${cameraHealthHtml(cam.status)}</div>
              ${reason}
            </div>
          </td>
          <td class="col-num">
            <div class="cell-stack cell-stack--end">
              <div>${latStr}</div>
              ${checkedStr}
            </div>
          </td>
          <td>${serviceStatus}</td>
          <td>
            <div class="cell-actions">
              <button type="button" class="btn btn--sm" data-cam-action="probe" data-id="${escapeHtml(cam.id)}">Uji</button>
              <button type="button" class="btn btn--sm" data-cam-action="edit" data-id="${escapeHtml(cam.id)}">Edit</button>
              <button type="button" class="btn btn--sm" data-cam-action="toggle" data-id="${escapeHtml(cam.id)}">${toggleLabel}</button>
              ${showRestore ? `<button type="button" class="btn btn--sm" data-cam-action="restore" data-id="${escapeHtml(cam.id)}">Pulihkan</button>` : ''}
              <button type="button" class="btn btn--sm btn--danger" data-cam-action="delete" data-id="${escapeHtml(cam.id)}">Hapus</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  const total = Number(res?.totalMatched || 0);
  const offset = Number(res?.offset || 0);
  const shownStart = total > 0 ? offset + 1 : 0;
  const shownEnd = Math.min(offset + cameras.length, total);

  $('#cctvPageInfo').textContent = `Menampilkan ${shownStart}–${shownEnd} dari ${total} kamera cocok (total katalog ${res?.totalCatalog || 0})`;
  $('#btnCctvPrev').disabled = offset <= 0;
  $('#btnCctvNext').disabled = offset + cameras.length >= total;
}

function bukaModalKamera(cam = null) {
  const dlg = $('#cameraDialog');
  if (!dlg) return;

  keadaan.sedangEditKamera = cam;
  show($('#cameraFormError'), false);

  const isEdit = Boolean(cam);
  $('#cameraDialogTitle').textContent = isEdit ? `Edit Kamera: ${cam.name}` : 'Tambah Kamera CCTV';
  $('#btnSaveCamera').textContent = isEdit ? 'Simpan Perubahan' : 'Tambahkan ke Katalog';

  const idInput = $('#camId');
  idInput.value = cam?.id || '';
  idInput.readOnly = isEdit;
  $('#camName').value = cam?.name || '';
  $('#camUrl').value = cam?.url || '';
  $('#camHlsUrl').value = cam?.hlsUrl || '';
  $('#camCity').value = cam?.city || '';
  $('#camProvider').value = cam?.provider || '';
  $('#camLat').value = cam?.lat ?? '';
  $('#camLon').value = cam?.lon ?? '';
  $('#camHeading').value = cam?.headingDeg ?? '';
  $('#camFov').value = cam?.fovDeg ?? '';
  $('#camRange').value = cam?.rangeM ?? '';
  $('#camEnabled').checked = cam ? cam.enabled !== false : true;

  dlg.showModal();
}

async function tanganiAksiBarisCctv(action, id) {
  const cam = (keadaan.cctvData?.cameras || []).find((c) => c.id === id);
  if (!cam) return;

  if (action === 'edit') {
    bukaModalKamera(cam);
    return;
  }

  if (action === 'probe') {
    try {
      tampilkanPesan(`Menguji koneksi ${cam.name}...`, 'warn');
      const res = await ujiKameraCctvAdmin(keadaan.token, id);
      const lat = Number.isFinite(res.probe?.latencyMs) ? `${Math.round(res.probe.latencyMs)} ms` : KOSONG;
      tampilkanPesan(
        `Hasil uji ${cam.name}: ${res.probe?.status || 'unknown'} (${lat}) — ${res.probe?.reason || 'OK'}`,
        res.probe?.status === 'online' ? 'ok' : 'warn'
      );
      await muatDaftarCctv({ senyap: true });
    } catch (err) {
      tampilkanPesan(err.message || 'Gagal menguji kamera', 'error');
    }
    return;
  }

  if (action === 'toggle') {
    const nextEnabled = cam.enabled === false;
    try {
      const res = await ubahStatusAktifCctvAdmin(keadaan.token, id, nextEnabled);
      tampilkanPesan(res.message || 'Status layanan kamera diperbarui', 'ok');
      await muatDaftarCctv({ senyap: true });
    } catch (err) {
      tampilkanPesan(err.message || 'Gagal mengubah status kamera', 'error');
    }
    return;
  }

  if (action === 'restore') {
    try {
      const res = await pulihkanKameraCctvAdmin(keadaan.token, id);
      tampilkanPesan(res.message || 'Kamera dipulihkan ke konfigurasi standar', 'ok');
      await muatDaftarCctv({ senyap: true });
    } catch (err) {
      tampilkanPesan(err.message || 'Gagal memulihkan kamera', 'error');
    }
    return;
  }

  if (action === 'delete') {
    const msg = cam.isCustom
      ? `Hapus permanen kamera kustom "${cam.name}" (${cam.id}) dari store override?`
      : `Sembunyikan kamera bawaan "${cam.name}" (${cam.id}) dari layanan aktif? Data dasar di cctvCatalog.json tetap utuh dan dapat dipulihkan.`;
    bukaKonfirmasi({
      title: 'Hapus Kamera dari Katalog Aktif',
      message: msg,
      confirmLabel: cam.isCustom ? 'Hapus Permanen' : 'Sembunyikan Kamera',
      onConfirm: async () => {
        try {
          const res = await hapusKameraCctvAdmin(keadaan.token, id);
          tampilkanPesan(res.message || 'Kamera dihapus dari daftar aktif', 'ok');
          await muatDaftarCctv({ senyap: true });
        } catch (err) {
          tampilkanPesan(err.message || 'Gagal menghapus kamera', 'error');
        }
      },
    });
  }
}

/* ── TAB 2: MONITORING KUOTA, CACHE & AGEN ── */

async function muatDataMonitoring() {
  if (!keadaan.token) return;
  keadaan.monitoringMuat = true;
  try {
    const [overview, directCache, logsRes] = await Promise.all([
      ambilMonitoringOverviewAdmin(keadaan.token),
      ambilCacheStatsAdmin(keadaan.token),
      ambilAuditLogAgenAdmin(keadaan.token, keadaan.logsFilter),
    ]);
    keadaan.monitoringData = overview;
    keadaan.cacheStatsDirect = directCache;
    keadaan.logsData = logsRes;

    $('#monitorLastSync').textContent = `Sinkronisasi terakhir ${formatWaktuId(overview.time)} WIB`;
    renderTomTomSection(overview.tomtom);
    renderCacheSection(directCache);
    renderExecutionStatsSection(overview.execution, overview.rateLimits);
    renderLogsTable(logsRes);
  } catch (err) {
    if (err.status === 401) {
      keluarSesiAdmin();
      tampilkanPesan('Sesi admin berakhir, silakan masuk kembali', 'warn');
      return;
    }
    tampilkanPesan(err.message || 'Gagal memuat data monitoring sistem', 'error');
  } finally {
    keadaan.monitoringMuat = false;
  }
}

function renderTomTomSection(tt = {}) {
  const keyBadge = $('#tomtomKeyBadge');
  if (keyBadge) {
    keyBadge.innerHTML = tt.hasKey
      ? statusDotHtml('ok', 'API key aktif')
      : statusDotHtml('danger', 'API key kosong');
  }

  $('#tomtomDateLabel').textContent = `Tanggal UTC ${tt.date || KOSONG} · sisa ${new Intl.NumberFormat('id-ID').format(tt.remaining || 0)} tile`;
  const count = Number(tt.dailyCount || 0);
  const limit = Number(tt.budgetLimit || 8000);
  const pct = Number(tt.usagePercent || 0);
  const fmt = new Intl.NumberFormat('id-ID');

  $('#tomtomUsageLabel').textContent = `${fmt.format(count)} dari ${fmt.format(limit)} tile`;
  $('#tomtomPercentLabel').textContent = `${pct}%`;

  const fill = $('#tomtomQuotaFill');
  if (fill) {
    const scale = Math.min(1, Math.max(0, limit > 0 ? count / limit : 0));
    fill.style.setProperty('--quota-scale', scale.toFixed(4));
    fill.dataset.level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
  }

  $('#tomtomTileStats').innerHTML = `
    <li class="kv-row">
      <span class="kv-row__label">Tile tersimpan di RAM</span>
      <span class="kv-row__val">${fmt.format(tt.memCacheEntries || 0)} entri</span>
    </li>
    <li class="kv-row">
      <span class="kv-row__label">Cache segmen arus lalu lintas</span>
      <span class="kv-row__val">${fmt.format(tt.segmentCacheEntries || 0)} koridor</span>
    </li>
    <li class="kv-row">
      <span class="kv-row__label">Berkas tile di disk (.cache)</span>
      <span class="kv-row__val">${fmt.format(tt.diskTileFiles || 0)} berkas</span>
    </li>
    <li class="kv-row">
      <span class="kv-row__label">Ukuran pemakaian disk</span>
      <span class="kv-row__val">${escapeHtml(formatUkuranByte(tt.diskSizeBytes))}</span>
    </li>
  `;

  renderTomTomHistoryChart(tt.dailyHistory || [], limit);
}

function renderTomTomHistoryChart(history = [], limit = 8000) {
  const container = $('#tomtomHistoryChart');
  if (!container) return;

  if (!Array.isArray(history) || history.length === 0) {
    container.innerHTML = '<div class="empty-box">Belum ada riwayat penggunaan kuota harian</div>';
    return;
  }

  const fmt = new Intl.NumberFormat('id-ID');
  const maxVal = Math.max(100, ...history.map((d) => Number(d.count || 0)));
  const midVal = Math.round(maxVal / 2);

  const chartW = 640;
  const chartH = 220;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 24;
  const padBottom = 32;
  const plotW = chartW - padLeft - padRight;
  const plotH = chartH - padTop - padBottom;
  const colW = plotW / history.length;

  const baseY = padTop + plotH;
  const midY = padTop + Math.round(plotH / 2);

  const bars = history.map((d, i) => {
    const val = Number(d.count || 0);
    const barH = val > 0 ? Math.max(4, Math.round((val / maxVal) * plotH)) : 2;
    const x = Math.round(padLeft + i * colW + colW * 0.22);
    const w = Math.round(colW * 0.56);
    const y = baseY - barH;
    const shortDate = String(d.date || '').slice(5);
    const isToday = i === history.length - 1;
    const ratio = limit > 0 ? val / limit : 0;

    // Satu aksen utama (biru navigasi) pada hari aktif; hari lampau memakai langkah netral tenang
    const fill = ratio >= 0.9
      ? 'var(--st-hindari)'
      : isToday
        ? 'var(--jk-blue-1)'
        : 'var(--border-strong)';
    const cx = x + Math.round(w / 2);

    return `
      <g>
        <title>${escapeHtml(d.date)}: ${fmt.format(val)} tile upstream (batas ${fmt.format(limit)})</title>
        <rect x="${x}" y="${y}" width="${w}" height="${barH}" rx="4" fill="${fill}"></rect>
        <text x="${cx}" y="${Math.max(14, y - 8)}" text-anchor="middle" font-family="var(--font-mono)" font-size="12" font-weight="${isToday ? '500' : '400'}" fill="${isToday ? 'var(--text-1)' : 'var(--text-3)'}">${fmt.format(val)}</text>
        <text x="${cx}" y="${chartH - 8}" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="${isToday ? 'var(--text-1)' : 'var(--text-3)'}">${escapeHtml(shortDate)}</text>
      </g>
    `;
  }).join('');

  container.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${chartW} ${chartH}" role="img" aria-label="Grafik batang jumlah panggilan tile TomTom 7 hari terakhir">
      <line x1="${padLeft}" y1="${padTop}" x2="${chartW - padRight}" y2="${padTop}" stroke="var(--border)" stroke-dasharray="3 3" stroke-width="1"></line>
      <line x1="${padLeft}" y1="${midY}" x2="${chartW - padRight}" y2="${midY}" stroke="var(--border)" stroke-dasharray="3 3" stroke-width="1"></line>
      <line x1="${padLeft}" y1="${baseY}" x2="${chartW - padRight}" y2="${baseY}" stroke="var(--border-strong)" stroke-width="1"></line>

      <text x="${padLeft - 8}" y="${padTop + 4}" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--text-3)">${fmt.format(maxVal)}</text>
      <text x="${padLeft - 8}" y="${midY + 4}" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--text-3)">${fmt.format(midVal)}</text>
      <text x="${padLeft - 8}" y="${baseY + 4}" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--text-3)">0</text>

      ${bars}
    </svg>
  `;
}

function renderCacheSection(cachePayload = {}) {
  const summary = cachePayload.summary || {};
  const stores = cachePayload.cache || {};
  const fmt = new Intl.NumberFormat('id-ID');

  $('#cacheAggregateSub').textContent =
    `Hit-rate gabungan ${summary.overallHitRate || '0.0%'} · ${fmt.format(summary.totalHits || 0)} hits · ${fmt.format(summary.totalMisses || 0)} misses · kapasitas ${fmt.format(summary.totalSize || 0)}/${fmt.format(summary.totalMax || 0)}`;

  const tbody = $('#cacheStatsBody');
  if (!tbody) return;

  const entries = Object.entries(stores);
  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-box">Data cache tidak tersedia</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(([key, st]) => {
    const label = STORE_LABELS[key] || st.name || key;
    const ttlMinutes = Math.round(Number(st.defaultTtlMs || 0) / 60_000);
    const ttlLabel = ttlMinutes >= 60 ? `${(ttlMinutes / 60).toFixed(1).replace('.0', '')} jam` : `${ttlMinutes} mnt`;

    return `
      <tr>
        <td>
          <div class="cell-stack">
            <span class="cell-title">${escapeHtml(label)}</span>
            <span class="cell-sub mono">${escapeHtml(st.name || key)}</span>
          </div>
        </td>
        <td class="col-num mono">${escapeHtml(st.hitRate || '0.0%')}</td>
        <td class="col-num mono">${fmt.format(Number(st.hits || 0))} / ${fmt.format(Number(st.misses || 0))}</td>
        <td class="col-num mono">${fmt.format(Number(st.size || 0))} / ${fmt.format(Number(st.max || 0))}</td>
        <td class="col-num mono">${escapeHtml(ttlLabel)}</td>
        <td>
          <button type="button" class="btn btn--sm" data-cache-clear="${escapeHtml(key)}">Bersihkan</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderExecutionStatsSection(exec = {}, rateLimits = []) {
  const fmt = new Intl.NumberFormat('id-ID');
  $('#execStorageSub').textContent = `Penyimpanan aktif: ${exec.storage || 'local-fallback'} · ringkasan deterministik cadangan: ${fmt.format(exec.summaryFallbackCount || 0)} kali`;

  const avgLat = exec.avgDurationMs !== null && exec.avgDurationMs !== undefined ? formatLama(exec.avgDurationMs) : KOSONG;
  const p95Lat = exec.p95DurationMs !== null && exec.p95DurationMs !== undefined ? formatLama(exec.p95DurationMs) : KOSONG;
  const maxLat = exec.maxDurationMs !== null && exec.maxDurationMs !== undefined ? formatLama(exec.maxDurationMs) : KOSONG;
  const fallbackCount = Number(exec.fallbackCount || 0);

  $('#execKpiGrid').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-card__label">
        <span>Total eksekusi agen</span>
        <span class="mono">${escapeHtml(exec.storage || 'local')}</span>
      </div>
      <div class="kpi-card__value">${fmt.format(Number(exec.totalExecutions || 0))}</div>
      <div class="kpi-card__meta">${fmt.format(Number(exec.successCount || 0))} sukses · ${fmt.format(Number(exec.failedCount || 0))} gagal</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card__label">
        <span>Latensi rata-rata</span>
        <span class="mono">ReAct loop</span>
      </div>
      <div class="kpi-card__value">${escapeHtml(avgLat)}</div>
      <div class="kpi-card__meta">P95 ${escapeHtml(p95Lat)} · maks ${escapeHtml(maxLat)}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card__label">
        <span>Fallback model Gemini</span>
        <span class="status-dot status-dot--${fallbackCount > 0 ? 'warn' : 'ok'}" aria-hidden="true"></span>
      </div>
      <div class="kpi-card__value">${fmt.format(fallbackCount)}</div>
      <div class="kpi-card__meta">${Number(exec.fallbackRatePercent || 0)}% dari total eksekusi</div>
    </div>
  `;

  // Distribusi skor AMAN / HATI-HATI / HINDARI
  const dist = exec.scoreDistribution || {};
  const totalScored = (dist.AMAN || 0) + (dist['HATI-HATI'] || 0) + (dist.HINDARI || 0) + (dist.UNKNOWN || 0);
  const segs = [
    { key: 'Aman', cls: 'aman', dot: 'ok', count: dist.AMAN || 0 },
    { key: 'Hati-hati', cls: 'hati', dot: 'warn', count: dist['HATI-HATI'] || 0 },
    { key: 'Hindari', cls: 'hindari', dot: 'danger', count: dist.HINDARI || 0 },
    { key: 'Lainnya', cls: 'unknown', dot: 'muted', count: dist.UNKNOWN || 0 },
  ];

  $('#scoreDistBar').innerHTML = totalScored > 0
    ? segs.filter((s) => s.count > 0).map((s) => {
      const pct = Math.max(2, Math.round((s.count / totalScored) * 100));
      return `<div class="dist-bar__seg--${s.cls}" style="width:${pct}%" title="${s.key}: ${s.count}"></div>`;
    }).join('')
    : '';

  $('#scoreDistLegend').innerHTML = segs.map((s) => {
    const pct = totalScored > 0 ? Math.round((s.count / totalScored) * 100) : 0;
    return `
      <span class="dist-legend__item">
        <span class="status-dot status-dot--${s.dot}" aria-hidden="true"></span>
        <span>${escapeHtml(s.key)}</span>
        <span class="mono">${fmt.format(s.count)} (${pct}%)</span>
      </span>
    `;
  }).join('');

  // Rincian penggunaan model LLM sebagai daftar terstruktur
  const models = Array.isArray(exec.modelUsage) ? exec.modelUsage : [];
  $('#modelUsageList').innerHTML = models.length > 0
    ? models.map((m) => `
        <li class="kv-row">
          <span class="kv-row__label mono">${escapeHtml(m.model)}</span>
          <span class="kv-row__val">${fmt.format(Number(m.count || 0))} eksekusi</span>
        </li>
      `).join('')
    : '<li class="kv-row"><span class="kv-row__label">Belum ada eksekusi tercatat</span><span class="kv-row__val">0</span></li>';

  // Rate limits sebagai ledger baris sejajar
  $('#rateLimitList').innerHTML = (Array.isArray(rateLimits) ? rateLimits : []).map((rl) => {
    const winMin = Math.round(Number(rl.windowMs || 60_000) / 60_000);
    const blocked = Number(rl.blocked || 0);
    return `
      <li class="kv-row">
        <div>
          <div class="kv-row__label">${escapeHtml(LIMITER_LABELS[rl.name] || rl.name)}</div>
          <div class="cell-sub mono">Batas ${escapeHtml(String(rl.max))} / ${winMin} mnt</div>
        </div>
        <div class="cell-stack cell-stack--end">
          <span class="kv-row__val">${fmt.format(Number(rl.allowed || 0))} lolos</span>
          <span class="cell-sub mono">${blocked > 0 ? `${fmt.format(blocked)} diblokir (429)` : '0 diblokir'}</span>
        </div>
      </li>
    `;
  }).join('');
}

function formatTitikRute(titik) {
  if (!titik || typeof titik !== 'object') return KOSONG;
  const label = String(titik.label || titik.name || titik.nama || '').trim();
  if (label) return label;
  const lat = Number(titik.lat);
  const lon = Number(titik.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
  return KOSONG;
}

function renderLogsTable(logsRes = {}) {
  const tbody = $('#execLogsBody');
  if (!tbody) return;

  const logs = Array.isArray(logsRes.logs) ? logsRes.logs : [];
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-box">Belum ada log eksekusi agen yang cocok dengan filter</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map((item, idx) => {
    const originName = formatTitikRute(item.origin);
    const destName = formatTitikRute(item.destination);
    const koridor = item.route?.summary ? ` · Via ${escapeHtml(item.route.summary)}` : '';
    const routeMeta = item.route
      ? `${formatJarak(item.route.distanceM)} · ${formatDurasi(item.route.durationS)}${koridor}`
      : (item.error ? escapeHtml(item.error) : KOSONG);
    const modelName = item.modelTelemetry?.modelUsed || KOSONG;
    const fallbackTag = item.modelTelemetry?.fallbackOccurred
      ? '<span class="meta-tag">Fallback</span>'
      : '';
    const statusLine = item.status === 'failed'
      ? statusDotHtml('danger', 'Gagal')
      : statusDotHtml('ok', 'Sukses');

    return `
      <tr>
        <td>
          <div class="cell-stack">
            <span>${escapeHtml(formatWaktuId(item.timestamp))}</span>
            <span class="cell-sub mono">${escapeHtml(item.requestId || KOSONG)}</span>
            <div>${statusLine}</div>
          </div>
        </td>
        <td>
          <div class="cell-stack">
            <span class="cell-title">${escapeHtml(originName)} &rarr; ${escapeHtml(destName)}</span>
            <span class="cell-sub">${routeMeta}</span>
          </div>
        </td>
        <td class="mono">${escapeHtml(item.profile || 'car')}</td>
        <td>${scoreStatusHtml(item.score)}</td>
        <td>
          <div class="cell-stack">
            <span class="mono">${escapeHtml(modelName)}</span>
            ${fallbackTag ? `<div class="cell-tags">${fallbackTag}</div>` : ''}
          </div>
        </td>
        <td class="col-num">
          <div class="cell-stack cell-stack--end">
            <span class="mono">${escapeHtml(formatLama(item.totalDurationMs))}</span>
            <span class="cell-sub">${Number(item.stepCount ?? item.reasoning?.length ?? 0)} langkah</span>
          </div>
        </td>
        <td>
          <button type="button" class="btn btn--sm" data-log-index="${idx}">Lihat Jejak</button>
        </td>
      </tr>
    `;
  }).join('');
}

function bukaModalJejakLog(item) {
  const dlg = $('#traceDialog');
  const body = $('#traceDialogBody');
  if (!dlg || !body || !item) return;

  const steps = Array.isArray(item.reasoning) ? item.reasoning : [];
  const tel = item.modelTelemetry || {};
  const originName = formatTitikRute(item.origin);
  const destName = formatTitikRute(item.destination);
  const primaryModelName = tel.preferredModel || tel.primaryModel || tel.modelUsed || KOSONG;

  body.innerHTML = `
    <div class="trace-meta">
      <div><span class="cell-sub">Request ID:</span> <span class="mono">${escapeHtml(item.requestId)}</span></div>
      <div><span class="cell-sub">Rute:</span> ${escapeHtml(originName)} &rarr; ${escapeHtml(destName)} (${escapeHtml(item.profile)})</div>
      <div><span class="cell-sub">Model utama &rarr; dipakai:</span> <span class="mono">${escapeHtml(primaryModelName)}</span> &rarr; <span class="mono">${escapeHtml(tel.modelUsed || KOSONG)}</span></div>
      ${item.route?.summary ? `<div><span class="cell-sub">Koridor:</span> ${escapeHtml(item.route.summary)}</div>` : ''}
      ${item.error ? `<div class="form-error">${escapeHtml(item.error)}</div>` : ''}
    </div>

    <h3 class="subblock-title">Langkah Penalaran (${steps.length})</h3>
    ${steps.length > 0
      ? `<ol class="trace-list">
          ${steps.map((s) => `
            <li class="trace-step">
              <div class="trace-step__top">
                <span>Langkah ${escapeHtml(s.step)} · <span class="mono">${escapeHtml(s.action)}</span></span>
                <span class="mono">${escapeHtml(formatLama(s.durationMs))}</span>
              </div>
              <p class="trace-step__thought">${escapeHtml(s.thought || 'Tanpa catatan penalaran')}</p>
            </li>
          `).join('')}
        </ol>`
      : '<p class="cell-sub">Tidak ada langkah ReAct terekam</p>'}
  `;

  dlg.showModal();
}

/* ── EVENT LISTENERS ── */

function pasangPengendali() {
  for (const dlg of $$('.admin-dialog')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  for (const btn of $$('[data-close-dialog]')) {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.closeDialog;
      $(`#${targetId}`)?.close();
    });
  }

  $('#btnCloseToast')?.addEventListener('click', sembunyikanPesan);

  $('#btnConfirmProceed')?.addEventListener('click', async () => {
    const fn = keadaan.onConfirmAction;
    keadaan.onConfirmAction = null;
    $('#confirmDialog')?.close();
    if (typeof fn === 'function') await fn();
  });

  $('#btnToggleLoginPwd')?.addEventListener('click', (e) => {
    const input = $('#loginPassword');
    const btn = e.currentTarget;
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(isHidden));
    btn.setAttribute('aria-label', isHidden ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    btn.textContent = isHidden ? 'Tutup' : 'Lihat';
  });

  $('#adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;

    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    const errBox = $('#adminLoginError');
    const submitBtn = $('#btnLoginSubmit');
    show(errBox, false);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Memverifikasi...';

    try {
      const res = await masukPengguna({ email, password });
      keadaan.token = res.token;
      keadaan.pengguna = res.user;
      simpanAuthLocal(res.token, res.user);
      perbaruiTampilanAuth();
      if (res.user?.role === 'admin') {
        tampilkanPesan('Sesi administrator aktif', 'ok');
      }
    } catch (err) {
      errBox.textContent = err.message || 'Gagal masuk ke konsol admin';
      show(errBox, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Masuk Konsol Admin';
    }
  });

  $('#btnSwitchAccount')?.addEventListener('click', keluarSesiAdmin);
  $('#btnAdminLogout')?.addEventListener('click', () => {
    keluarSesiAdmin();
    tampilkanPesan('Sesi administrator ditutup', 'ok');
  });

  // Tab switching (click + keyboard roving tabindex: ArrowLeft, ArrowRight, Home, End)
  const tabs = $$('.admin-tab');
  for (const tab of tabs) {
    tab.addEventListener('click', () => aktifkanTab(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(tab);
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx >= 0) {
        e.preventDefault();
        aktifkanTab(tabs[nextIdx].dataset.tab, { fokusTab: true });
      }
    });
  }

  // Filter CCTV (explicit submit)
  $('#cctvFilterForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    keadaan.cctvFilter.q = $('#fCctvQ').value.trim();
    keadaan.cctvFilter.status = $('#fCctvStatus').value;
    keadaan.cctvFilter.enabled = $('#fCctvEnabled').value;
    keadaan.cctvFilter.city = $('#fCctvCity').value;
    keadaan.cctvFilter.sort = $('#fCctvSort').value;
    keadaan.cctvFilter.offset = 0;
    muatDaftarCctv();
  });

  $('#btnFilterOfflineOnly')?.addEventListener('click', () => {
    $('#fCctvStatus').value = 'offline';
    keadaan.cctvFilter.status = 'offline';
    keadaan.cctvFilter.offset = 0;
    muatDaftarCctv();
  });

  $('#btnResetCctvFilter')?.addEventListener('click', () => {
    $('#fCctvQ').value = '';
    $('#fCctvStatus').value = 'all';
    $('#fCctvEnabled').value = 'all';
    $('#fCctvCity').value = 'all';
    $('#fCctvSort').value = 'status_offline_first';
    keadaan.cctvFilter = {
      status: 'all',
      enabled: 'all',
      city: 'all',
      q: '',
      sort: 'status_offline_first',
      limit: 50,
      offset: 0,
    };
    muatDaftarCctv();
  });

  $('#btnCctvPrev')?.addEventListener('click', () => {
    keadaan.cctvFilter.offset = Math.max(0, keadaan.cctvFilter.offset - keadaan.cctvFilter.limit);
    muatDaftarCctv();
  });

  $('#btnCctvNext')?.addEventListener('click', () => {
    keadaan.cctvFilter.offset += keadaan.cctvFilter.limit;
    muatDaftarCctv();
  });

  $('#btnRunSweep')?.addEventListener('click', async () => {
    try {
      sinkronkanTombolSweep(true);
      const res = await picuSweepCctvAdmin(keadaan.token, { wait: false });
      tampilkanPesan('Pemeriksaan kesehatan seluruh kamera berjalan di latar belakang', 'ok');
      if (res.summary) {
        renderRingkasanCctv(res.summary, keadaan.cctvData?.catalogStats);
      }
      jadwalkanPollingSweep();
    } catch (err) {
      sinkronkanTombolSweep(false);
      tampilkanPesan(err.message || 'Gagal memulai pemeriksaan kamera', 'error');
    }
  });

  $('#btnAddCamera')?.addEventListener('click', () => bukaModalKamera(null));

  $('#cameraForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;

    const errBox = $('#cameraFormError');
    show(errBox, false);

    const isEdit = Boolean(keadaan.sedangEditKamera);
    const payload = {
      name: $('#camName').value.trim(),
      url: $('#camUrl').value.trim(),
      hlsUrl: $('#camHlsUrl').value.trim() || null,
      city: $('#camCity').value.trim() || null,
      provider: $('#camProvider').value.trim() || null,
      lat: Number($('#camLat').value),
      lon: Number($('#camLon').value),
      headingDeg: $('#camHeading').value !== '' ? Number($('#camHeading').value) : null,
      fovDeg: $('#camFov').value !== '' ? Number($('#camFov').value) : null,
      rangeM: $('#camRange').value !== '' ? Number($('#camRange').value) : null,
      enabled: $('#camEnabled').checked,
    };

    const customId = $('#camId').value.trim();
    if (!isEdit && customId) {
      payload.id = customId;
    }

    const saveBtn = $('#btnSaveCamera');
    saveBtn.disabled = true;
    try {
      const res = isEdit
        ? await perbaruiKameraCctvAdmin(keadaan.token, keadaan.sedangEditKamera.id, payload)
        : await tambahKameraCctvAdmin(keadaan.token, payload);
      $('#cameraDialog')?.close();
      tampilkanPesan(res.message || 'Data kamera disimpan', 'ok');
      await muatDaftarCctv({ senyap: true });
    } catch (err) {
      errBox.textContent = err.message || 'Gagal menyimpan data kamera';
      show(errBox, true);
    } finally {
      saveBtn.disabled = false;
    }
  });

  $('#cctvTableBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cam-action]');
    if (!btn) return;
    tanganiAksiBarisCctv(btn.dataset.camAction, btn.dataset.id);
  });

  $('#btnRefreshMonitoring')?.addEventListener('click', () => muatDataMonitoring());

  $('#btnClearAllCache')?.addEventListener('click', () => {
    bukaKonfirmasi({
      title: 'Kosongkan Seluruh Cache Memori',
      message: 'Seluruh store cache (visi CCTV, kesehatan kamera, rute OSRM, navigasi, dan geocoding) akan dikosongkan.',
      confirmLabel: 'Kosongkan Semua',
      onConfirm: async () => {
        try {
          const res = await bersihkanCacheAdmin(keadaan.token, 'all');
          tampilkanPesan(res.message || 'Seluruh cache dibersihkan', 'ok');
          await muatDataMonitoring();
        } catch (err) {
          tampilkanPesan(err.message || 'Gagal membersihkan cache', 'error');
        }
      },
    });
  });

  $('#cacheStatsBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cache-clear]');
    if (!btn) return;
    const store = btn.dataset.cacheClear;
    try {
      const res = await bersihkanCacheAdmin(keadaan.token, store);
      tampilkanPesan(res.message || `Cache ${store} dibersihkan`, 'ok');
      await muatDataMonitoring();
    } catch (err) {
      tampilkanPesan(err.message || 'Gagal membersihkan cache', 'error');
    }
  });

  $('#logsFilterForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    keadaan.logsFilter.status = $('#fLogStatus').value;
    keadaan.logsFilter.scoreLabel = $('#fLogScore').value;
    keadaan.logsFilter.fallbackOnly = $('#fLogFallbackOnly').checked;
    try {
      const logsRes = await ambilAuditLogAgenAdmin(keadaan.token, keadaan.logsFilter);
      keadaan.logsData = logsRes;
      renderLogsTable(logsRes);
    } catch (err) {
      tampilkanPesan(err.message || 'Gagal memfilter log eksekusi', 'error');
    }
  });

  $('#execLogsBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-log-index]');
    if (!btn) return;
    const idx = Number(btn.dataset.logIndex);
    const item = (keadaan.logsData?.logs || [])[idx];
    if (item) bukaModalJejakLog(item);
  });
}

async function inisialisasi() {
  rakitKerangka();
  pasangPengendaliTema();
  pasangPengendali();

  const token = bacaLocal(AUTH_TOKEN_KEY);
  const rawUser = bacaLocal(AUTH_USER_KEY);
  let parsedUser = null;
  if (rawUser) {
    try {
      parsedUser = JSON.parse(rawUser);
    } catch {
      parsedUser = null;
    }
  }

  if (token) {
    keadaan.token = token;
    keadaan.pengguna = parsedUser;
    try {
      const profil = await ambilProfilSaya(token);
      if (profil?.user) {
        keadaan.pengguna = profil.user;
        simpanAuthLocal(token, profil.user);
      }
    } catch (err) {
      if (err.status === 401) {
        keadaan.token = null;
        keadaan.pengguna = null;
        simpanAuthLocal(null, null);
      }
    }
  }

  perbaruiTampilanAuth();
}

inisialisasi();
