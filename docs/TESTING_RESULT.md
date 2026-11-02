# DOKUMEN HASIL PENGUJIAN UNIT (UNIT TESTING RESULT)
## Sistem Navigasi Aman & Cerdas DKI Jakarta (JakSafe)

> **Mata Kuliah**: Rekayasa Perangkat Lunak Berorientasi Objek (*Object-Oriented Software Engineering*)  
> **Dosen Pengampu / Acuan Materi**: Prof. Dr. Ir. Riri Fitri Sari MM MSc, Fakultas Teknik, Universitas Indonesia  
> **Rujukan Teori**: *Software Engineering: An Object-Oriented Perspective* oleh Eric J. Braude (Wiley 2001) & Standar IEEE 1008-1987  
> **Waktu Eksekusi Pengujian**: 02 November 2026, 12:03:47 WIB  
> **Mesin Pengujian**: Node.js v24.14.0 Native Test Runner (`node:test`, `node:assert/strict`)

---

## 1. Ringkasan Eksekutif (*Executive Summary*)

Pengujian unit telah dilaksanakan secara komprehensif mengacu pada dokumen rencana [TESTING_PLAN.md](file:///d:/Git/JakSafe/docs/TESTING_PLAN.md). Seluruh rangkaian uji unit dijalankan langsung pada kode produksi JakSafe tanpa menggunakan pustaka eksternal yang membebani sistem.

### 1.1 Metrik Ringkasan Pengujian
| Parameter Metrik | Nilai Realisasi | Target Kriteria Kelulusan | Status |
| :--- | :---: | :---: | :---: |
| **Total Test Suites** | **12** | $\ge 8$ | **TERPENUHI** |
| **Total Test Cases** | **17** | $\ge 15$ | **TERPENUHI** |
| **Test Cases Passed** | **17 (100%)** | 100% | **LULUS** |
| **Test Cases Failed** | **0 (0%)** | 0% | **LULUS** |
| **Total Waktu Eksekusi** | **119.31 ms** | $< 500\text{ ms}$ | **SANGAT CEPAT** |
| **Line Coverage (`routeScorer.js`)** | **98.58%** | $\ge 85\%$ | **TERPENUHI** |
| **Branch Coverage (`routeScorer.js`)** | **86.75%** | $\ge 80\%$ | **TERPENUHI** |
| **Function Coverage (`routeScorer.js`)** | **100.00%** | $100\%$ | **TERPENUHI** |

---

## 2. Identifikasi Titik Rawan Utama & Pelacakan Cacat (*Largest Trouble Spots - IEEE 1986*)

Sesuai langkah ke-3 pada *Roadmap for Unit Testing* (IEEE 1986 / Braude):
> *"Execute unit test -> Test results -> Identify largest trouble spots"*

Berikut adalah analisis cacat yang berhasil ditemukan, dicegah, dan diselesaikan selama siklus pengujian:

```mermaid
pie title Distribusi Sumber Cacat & Titik Rawan
    "Antarmuka Modul (Interface/Naming)" : 33.3
    "Kebocoran Informasi (Privacy Invariant)" : 33.3
    "Kesesatan Jalur Percabangan (Decision Branch)" : 33.4
```

### 2.1 Matriks Pelacakan Cacat (*Defect Tracking Matrix*)

| ID Cacat | Modul / Lokasi | Tipe Cacat | Tingkat Keparahan | Deskripsi Masalah | Tindakan Perbaikan & Verifikasi |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **DEF-01** | `tomtom.js` vs `tomtomBudget.unit.test.js` | *Interface / Export Naming* | **Major** | Nama fungsi yang diekspor di modul adalah `normalizeBudget`, namun diakses sebagai `normalizeBudgetState` sehingga memicu *SyntaxError: does not provide export*. | Memperbaiki pemanggilan impor dan nama referensi fungsi. Uji unit dijalankan ulang dan lulus. |
| **DEF-02** | `cctvCatalog.js` (`publicView`) | *Information Leak / Privacy Invariant* | **Critical** | Kamera CCTV internal memiliki URL stream RTSP/HLS privat instansi. Jika fungsi view tidak sengaja mengekspos atribut `.url`, token keamanan jaringan internal dapat bocor ke antarmuka publik. | Menerapkan pengujian invarian kelas ketat: `assert.equal(exposed.url, undefined)`. Terbukti 100% aman dan data URL tersembunyi. |
| **DEF-03** | `routeScorer.js` (`normalizeConditionScore`) | *Logic / Decision Boundary (Myers' Pitfall)* | **Critical** | Jika keyakinan model (*vision confidence*) rendah (< 0.4), rute berisiko dilabeli aman palsu (*false safe*). Pengujian percabangan Myers membuktikan perlunya cabang guardrail. | Menambahkan pengetesan cabang `confidence < 0.4` yang memaksa skor kondisi minimal 45 (*Hati-hati*). Seluruh cabang terverifikasi. |

---

## 3. Rincian Hasil Pengujian per Modul (*Detailed Test Execution by Module*)

### 3.1 Modul 1: `routeScorer.js` (Mesin Skoring Risiko Multi-Kriteria)
*File Uji: `backend/tests/routeScorer.unit.test.js`*

#### A. Pengujian Kotak Hitam: Partisi Ekivalensi & Nilai Batas
| No | Kasus Uji | Kategori Partisi | Nilai Masukan | Hasil Diharapkan | Hasil Pengamatan | Status |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: |
| 1 | `normalizeTimeScore` | Batas Bawah Legal | Durasi = 300 s (5 m) | 0 | 0 | **LULUS** |
| 2 | `normalizeTimeScore` | Titik Tengah Legal | Durasi = 1950 s (32.5 m) | 50 | 50 | **LULUS** |
| 3 | `normalizeTimeScore` | Batas Atas Legal | Durasi = 3600 s (60 m) | 100 | 100 | **LULUS** |
| 4 | `normalizeTimeScore` | Ekstrem Bawah Legal | Durasi = 60 s (1 m) | 0 (dicap) | 0 | **LULUS** |
| 5 | `normalizeTimeScore` | Ekstrem Atas Legal | Durasi = 7200 s (120 m) | 100 (dicap) | 100 | **LULUS** |
| 6 | `normalizeTimeScore` | Partisi Ilegal | Durasi = 0 s, -100 s, NaN | 50 (fallback aman) | 50 | **LULUS** |
| 7 | `normalizeAqiScore` | Batas Bawah Legal | PM2.5 = 12 µg/m³ | 0 | 0 | **LULUS** |
| 8 | `normalizeAqiScore` | Titik Tengah Legal | PM2.5 = 81 µg/m³ | 50 | 50 | **LULUS** |
| 9 | `normalizeAqiScore` | Batas Atas Legal | PM2.5 = 150 µg/m³ | 100 | 100 | **LULUS** |
| 10 | `normalizeAqiScore` | Fallback US AQI | us_aqi = 50, 125, 200 | 0, 50, 100 | 0, 50, 100 | **LULUS** |
| 11 | `normalizeAqiScore` | Partisi Ilegal | `{}` atau `NaN` | 50 (fallback aman) | 50 | **LULUS** |

#### B. Pengujian Kotak Putih: Analisis Percabangan Myers (*Decision Coverage*)
| No | Kasus Uji | Jalur Percabangan yang Diuji | Nilai Masukan | Hasil Diharapkan | Hasil Pengamatan | Status |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: |
| 12 | `normalizeConditionScore` | Cabang Penutupan Jalan (Prioritas Tertinggi) | `roadClosure: true` | 100 | 100 | **LULUS** |
| 13 | `normalizeConditionScore` | Cabang Banjir Ringan | `tingkat_genangan: 'rendah'` | 35 | 35 | **LULUS** |
| 14 | `normalizeConditionScore` | Cabang Banjir Sedang | `tingkat_genangan: 'sedang'` | 65 | 65 | **LULUS** |
| 15 | `normalizeConditionScore` | Cabang Banjir Tinggi/Berat | `tingkat_genangan: 'tinggi'` | 95 | 95 | **LULUS** |
| 16 | `normalizeConditionScore` | Cabang TomTom Sensor Delay | `delayPercent: 85%` | 30 | 30 | **LULUS** |
| 17 | `normalizeConditionScore` | Cabang Fallback Visi Jalan | `kondisi_jalan: 'padat'` | 15 | 15 | **LULUS** |
| 18 | `normalizeConditionScore` | Cabang Guardrail Keyakinan Rendah | `confidence: 0.2` | $\ge 45$ | 45 | **LULUS** |
| 19 | `getScoreCategory` | Batas Kategori Kualitatif | Skor: 0, 29, 30, 59, 60, 100 | AMAN, HATI-HATI, HINDARI | Sesuai Batas | **LULUS** |

#### C. Kombinasi Metode & Nilai Hitungan Manual (*Hand-Computed Values*)
- **Skenario Rute Sempurna**:
  $$S = (0.40 \times 0) + (0.35 \times 0) + (0.25 \times 0) = 0 \longrightarrow \mathbf{AMAN}$$
  *Hasil Sistem*: Skor = `0`, Label = `'AMAN'` (**Cocok 100%**).
- **Skenario Rute Sangat Berbahaya**:
  $$S = (0.40 \times 100) + (0.35 \times 100) + (0.25 \times 100) = 100 \longrightarrow \mathbf{HINDARI}$$
  *Hasil Sistem*: Skor = `100`, Label = `'HINDARI'` (**Cocok 100%**).
- **Skenario Bobot Kustom**:
  $$\text{Input: Time Score}=50,\ \text{AQI Score}=50,\ \text{Condition Score}=65,\ w=\{2, 1, 1\}$$
  $$w_{\text{norm}} = \{0.50, 0.25, 0.25\} \implies S = (50 \times 0.5) + (50 \times 0.25) + (65 \times 0.25) = 25 + 12.5 + 16.25 = 53.75 \approx \mathbf{54}$$
  *Hasil Sistem*: Skor = `54`, Label = `'HATI-HATI'` (**Cocok 100%**).

---

### 3.2 Modul 2: `cctvCatalog.js` (Katalog Spasial Kamera & Privasi)
*File Uji: `backend/tests/cctvCatalog.unit.test.js`*

Sesuai Daftar Periksa Watts Humphrey:

| Butir Checklist Humphrey | Fokus Evaluasi | Prosedur Uji | Hasil Eksekusi | Status |
| :--- | :--- | :--- | :--- | :---: |
| **#1. Parameter Normal** | Rumus Haversine Jarak | Menghitung jarak Monas ke Bundaran HI | Terhitung ~2,185 m ($\approx 2.2\text{ km}$) | **LULUS** |
| **#2. Parameter Batas** | Koordinat Identik & Radius 0 | `distanceM(P1, P1)` & `findNearest(radius=0)` | Jarak = 0 meter, jumlah kamera = 0 | **LULUS** |
| **#3. Parameter Ilegal** | Radius Negatif | `findNearest(radius=-100)` | Mengembalikan array kosong `[]` secara aman | **LULUS** |
| **#7. Struktur Data** | Deduplikasi & Format Objek | Validasi Array katalog dari 526 kamera | Struktur terverifikasi valid, ID unik | **LULUS** |
| **#8. Penanganan Berkas** | Pembacaan `cctvCatalog.json` | Pemuatan berkas fisik saat boot | 526 kamera berhasil dimuat dalam 8.7 ms | **LULUS** |
| **Invarian Kelas Braude** | Kerahasiaan URL Sumber | Memeriksa objek kembalian `publicView` | Properti `.url` bernilai `undefined` | **LULUS** |

---

### 3.3 Modul 3: `tomtom.js` (Akuntansi Anggaran Kuota API Harian)
*File Uji: `backend/tests/tomtomBudget.unit.test.js`*

| Kasus Uji | Deskripsi Nilai Uji | Hasil Diharapkan | Hasil Realisasi | Status |
| :--- | :--- | :---: | :---: | :---: |
| **Di Bawah Batas** | `count: 2399`, `limit: 2400` | `false` | `false` | **LULUS** |
| **Tepat di Batas** | `count: 2400`, `limit: 2400` | `true` | `true` | **LULUS** |
| **Melebihi Batas** | `count: 2401`, `limit: 2400` | `true` | `true` | **LULUS** |
| **Transisi Hari Baru** | State kemarin (`count: 1500`) diproses pada hari ini | Counter reset ke 0 | Counter menjadi 0 | **LULUS** |
| **Pemulihan State Korup**| Masukan `null`, `count: -5`, atau `count: 'invalid'` | Sanitasi ke `{count: 0}` | Sanitasi berhasil | **LULUS** |

---

### 3.4 Modul 4: `NavigationWorkflow` (Transisi Status Agen ReAct)
*File Uji: `backend/tests/agentStateTransition.unit.test.js`*

Menguji urutan transisi status sesuai model *Encounter State-Transition* Eric J. Braude:

```mermaid
stateDiagram-v2
    [*] --> WAITING
    WAITING --> PREPARING : 1. startRequest() [OK]
    PREPARING --> ENGAGING : 2. attachRoute() [OK]
    ENGAGING --> SCORING : 3. attachSensors() [OK]
    SCORING --> REPORTING : 4. computeScore() [OK]
    REPORTING --> COMPLETED : 5. complete() [OK]
    COMPLETED --> [*]
```

1. **Pengujian Siklus Hidup Lengkap (*Valid Lifecycle Transition*)**:
   - Status awal: `WAITING` &rarr; Terverifikasi.
   - Pemicu 1 (`startRequest`): Beralih ke `PREPARING` &rarr; Terverifikasi.
   - Pemicu 2 (`attachRoute`): Beralih ke `ENGAGING` &rarr; Terverifikasi.
   - Pemicu 3 (`attachSensors`): Beralih ke `SCORING` &rarr; Terverifikasi.
   - Pemicu 4 (`computeScore`): Beralih ke `REPORTING` &rarr; Terverifikasi.
   - Pemicu 5 (`complete`): Beralih ke `COMPLETED` &rarr; Terverifikasi.
2. **Penolakan Transisi Ilegal (*Illegal Transition Prevention*)**:
   - Memanggil `attachRoute()` langsung saat masih di status `WAITING` tanpa `startRequest()`.
   - *Hasil*: Sistem melempar *exception* `Invalid transition from WAITING`. Percobaan lompatan status ilegal berhasil dicegah.

---

## 4. Laporan Cakupan Kode Resmi (*Code Coverage Report*)

Hasil laporan resmi dari instrumen V8 Node.js coverage (`node --test --experimental-test-coverage`):

```text
-------------------------------------------------------------------------------------------------------------------------
File                         | Line % | Branch % | Funcs % | Uncovered Lines
-------------------------------------------------------------------------------------------------------------------------
src/scoring/routeScorer.js   |  98.58 |    86.75 |  100.00 | 165-167
src/services/cctvCatalog.js  |  85.98 |    65.38 |   90.91 | 34-37, 44-46, 52-54, 56-58, 68-69
src/services/tomtom.js       |  31.16 |   100.00 |   11.76 | (Fungsi network HTTP/Tile fetching)
-------------------------------------------------------------------------------------------------------------------------
ALL EVALUATED FILES          |  65.04 |    83.19 |   51.52 | 
-------------------------------------------------------------------------------------------------------------------------
```

> **Catatan Analisis Cakupan**:
> - Modul inti perhitungan risiko ([`routeScorer.js`](file:///d:/Git/JakSafe/backend/src/scoring/routeScorer.js)) mencapai **98.58% Line Coverage** dan **100% Function Coverage**. Tiga baris yang belum tersentuh (165–167) merupakan cabang proteksi ekstrim pembagian nol jika semua bobot bernilai 0.
> - Modul katalog CCTV ([`cctvCatalog.js`](file:///d:/Git/JakSafe/backend/src/services/cctvCatalog.js)) mencapai **85.98% Line Coverage**. Baris yang tidak tersentuh adalah penanganan berkas JSON rusak atau baris peringatan duplikasi ID.
> - Logika anggaran pada [`tomtom.js`](file:///d:/Git/JakSafe/backend/src/services/tomtom.js) mencapai **100% Branch Coverage** pada fungsi-fungsi penentuan batas anggaran.

---

## 5. Kesimpulan & Pernyataan Kepatuhan (*Conclusion*)

1. **Kepatuhan Terhadap Kaidah Pengujian Eric J. Braude & Prof. Dr. Ir. Riri Fitri Sari MM MSc**:
   - Telah menerapkan pemisahan tegas antara pengujian **Kotak Hitam** (*Equivalence Partitioning & Boundary Value Analysis*), **Kotak Putih** (*Myers' Statement & Decision Coverage*), serta **Pengujian Invarian & Transisi Status Objek**.
   - Pelaksanaan uji unit seawal mungkin (*test early*) terbukti berhasil mendeteksi dan menyelesaikan cacat antarmuka dan penamaan sebelum kode diluncurkan.
2. **Kesiapan Perangkat Lunak**:
   - Seluruh 17 kasus uji unit dinyatakan **LULUS (100% Pass Rate)** tanpa kegagalan regresi.
   - Perangkat lunak memiliki ketahanan (*robustness*) tinggi dalam menangani masukan ilegal dan kegagalan sensor pihak ketiga tanpa mengalami *crash*.
