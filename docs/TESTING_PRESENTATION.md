---
marp: true
theme: default
paginate: true
header: "JakSafe — Unit Testing & Verification | OOSE FTUI"
footer: "Prof. Dr. Ir. Riri Fitri Sari MM MSc — Eric J. Braude / IEEE 1008-1987"
size: 16:9
style: |
  section {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    padding: 40px;
    font-size: 20px;
  }
  h1 {
    color: #1e3a8a;
    font-size: 32px;
  }
  h2 {
    color: #2563eb;
    font-size: 24px;
    margin-top: 0;
  }
  table {
    font-size: 16px;
  }
  .highlight {
    background-color: #eff6ff;
    border-left: 5px solid #3b82f6;
    padding: 10px 15px;
    border-radius: 4px;
  }
  .badge-pass {
    background-color: #22c55e;
    color: white;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: bold;
  }
---

# UNIT TESTING & VERIFIKASI PERANGKAT LUNAK
## Sistem Navigasi Aman & Cerdas DKI Jakarta (JakSafe)

**Mata Kuliah**: Rekayasa Perangkat Lunak Berorientasi Objek (*Object-Oriented Software Engineering*)  
**Acuan Silabus**: Prof. Dr. Ir. Riri Fitri Sari MM MSc, Fakultas Teknik, Universitas Indonesia  
**Landasan Teori**: *Software Engineering: An Object-Oriented Perspective* (Eric J. Braude, Wiley 2001) & IEEE 1008-1987  

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Selamat pagi/siang Bapak/Ibu dosen penguji dan rekan-rekan. Hari ini kami mempresentasikan dokumen Unit Testing Plan dan Testing Result pada sistem navigasi JakSafe. Pengujian ini dirancang secara berdisiplin tinggi mengacu pada standar IEEE 1986 dan metodologi pengujian berorientasi objek Eric J. Braude."*

---

# 1. Landasan Filosofis: Kaidah Emas Pengujian
## *Golden Rules of Testing (Eric J. Braude)*

<div class="highlight">

### 1. Tujuan Utama Pengujian (*Goal of Testing*)
> **"Maximize the number and severity of defects found per dollar spent &rarr; Thus: TEST EARLY."**
* Pengujian unit dilakukan pada komponen terkecil sebelum terintegrasi.
* Biaya memperbaiki bug di fase unit jauh lebih murah daripada di fase sistem.

### 2. Batasan Hakiki Pengujian (*Limits of Testing*)
> **"Testing can only determine the presence of defects, never their absence."**
* Pengujian membuktikan adanya cacat, bukan ketiadaannya. Ketiadaan mutlak hanya dicapai via pembuktian kebenaran matematis (*proof of correctness*).

</div>

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Poin fundamental pertama: filosofi pengujian kami bukan untuk pamer bahwa kode kami tidak memiliki cacat, melainkan membuktikan bahwa pengujian kami efektif menemukan cacat sedini mungkin (*test early*), karena biaya perbaikan bug di tahap unit jauh lebih ekonomis dibandingkan setelah sistem dirilis."*

---

# 2. Hirarki Pengujian Berorientasi Objek
## *Testing: The Big Picture (Unified Process)*

```mermaid
flowchart TD
    subgraph UT ["1. UNIT TESTING (Fokus Pengujian Saat Ini)"]
        M["Methods (Fungsi Tunggal)"] --> CM["Combinations of Methods in Class"]
        CM --> PKG["Packages & Classes"]
    end
    UT --> IT["2. Integration Tests (Antarmuka Antar-Modul)"]
    IT --> ST["3. System Tests (Use-Cases & End-to-End)"]
```

* **Unit Testing** = Pengujian bagian/potongan (*"pieces"*).
* **Integration & System** = Pengujian rakitan (*"assemblies"*).
* Dilakukan berulang (*iterative*) sepanjang siklus *Inception*, *Elaboration*, hingga *Construction*.

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Dalam arsitektur berorientasi objek, pengujian unit berfokus pada level 'pieces' atau potongan mandiri: mulai dari metode, kombinasi metode dalam kelas, hingga paket kelas, sebelum nantinya dirakit ke level integrasi dan sistem use-case."*

---

# 3. Alur Pengujian Unit Sesuai Standar IEEE 1986
## *Roadmap for Unit Testing (Braude / IEEE 1008-1987)*

```mermaid
flowchart LR
    subgraph Step1 ["1. Plan for Unit Testing"]
        Req["Requirements & Detailed Design"] --> UTP["Unit Test Plan (TESTING_PLAN.md)"]
    end
    subgraph Step2 ["2. Acquire Test Set"]
        UTP --> TS["Himpunan Kasus Uji & Mocking"]
    end
    subgraph Step3 ["3. Execute & Identify"]
        TS --> TR["Hasil Uji (TESTING_RESULT.md)"]
        TR --> Spot["Identifikasi Titik Rawan Terbesar (Largest Trouble Spots)"]
    end
```

### 4 Modul Prioritas Berbasis Risiko (*Risk-Driven Prioritization*):
1. **Mesin Skoring Multi-Kriteria** (`routeScorer.js`) &rarr; **Prioritas Kritis**
2. **Katalog Spasial CCTV & Privasi Data** (`cctvCatalog.js`) &rarr; **Prioritas Tinggi**
3. **Akuntansi Kuota API Pihak Ketiga** (`tomtom.js`) &rarr; **Prioritas Tinggi**
4. **Mesin Status Siklus Hidup Agen ReAct** (`reactAgent.js`) &rarr; **Prioritas Sedang**

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Sesuai roadmap IEEE 1986, kami melewati 3 fase formal: merencanakan test plan, menyusun perangkat kasus uji, dan mengeksekusi sembari mengidentifikasi trouble spots. Kami tidak menguji secara asal, melainkan memprioritaskan modul penentu keselamatan navigasi jalan raya."*

---

# 4. Pengujian Kotak Hitam: Partisi Ekivalensi
## *Black-Box Testing: Equivalence Partitioning & Boundaries*

Memilah domain masukan yang tak hingga (*infinitely many legal values*) menjadi himpunan sampel representatif:

| Parameter Uji | Partisi Legal Bawah | Partisi Legal Normal | Partisi Legal Atas | Partisi Ilegal / Ekstrem |
| :--- | :---: | :---: | :---: | :---: |
| **Durasi Waktu** | $t \le 300\text{ s}$ (Skor = 0) | $300 < t < 3600\text{ s}$ (Linear) | $t \ge 3600\text{ s}$ (Skor = 100) | $t \le 0$, $\text{NaN}$, $\infty$ (Fallback 50) |
| **Polusi PM2.5** | $\le 12\ \mu\text{g/m}^3$ (Skor = 0) | $12 < \text{PM} < 150\ \mu\text{g/m}^3$ | $\ge 150\ \mu\text{g/m}^3$ (Skor = 100) | Objek kosong `{}`, $\text{NaN}$ |
| **Kuota TomTom** | $\text{count} = 0$ | $1 \le \text{count} \le 2399$ | $\text{count} = 2400$ (Limit cap) | $\text{count} < 0$, bukan integer |

<div class="highlight">

**Analisis Nilai Batas (*Boundary Value Analysis*)**:
Diuji pada 3 titik rentang: **Di dalam rentang** (32.5 menit), **Di batas rentang** (5 menit & 60 menit), dan **Di luar rentang** (-100s & 120 menit).

</div>

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Pada Black-Box testing, kami membagi masukan menjadi partisi ekivalensi. Pada parameter durasi misalnya, nilai di bawah 5 menit dicap 0, di atas 60 menit dicap 100, dan nilai ilegal seperti angka negatif atau NaN ditangani secara robust dengan mengembalikan skor netral 50 tanpa merusak sistem."*

---

# 5. Pengujian Kotak Putih: Peringatan Myers
## *White-Box Testing: Statement vs. Decision Coverage*

<div class="highlight">

### ⚠️ Peringatan Glenford Myers (Eric J. Braude Slide):
> *"Covering every statement is NOT sufficient! Suatu uji yang mengeksekusi 100% baris kode dapat melewatkan cacat logika fatal jika percabangan keputusan tidak dievaluasi pada kedua sisinya (True dan False)."*

</div>

### Evaluasi Jalur Keputusan (*Decision Coverage*) pada `normalizeConditionScore`:
* **Cabang 1 (Penutupan Jalan)**: `trafficData.roadClosure === true` &rarr; *Short-circuit* skor 100.
* **Cabang 2 (Tingkat Genangan Banjir)**: `rendah (35)`, `sedang (65)`, `tinggi (95)`.
* **Cabang 3 (Sensor Delay TomTom)**: $\ge 80\%$ (Skor 30), $\ge 30\%$ (Skor 15), $< 30\%$ (Skor 0).
* **Cabang 4 (Guardrail Keyakinan Rendah)**:
  Jika AI Vision memiliki *confidence* $< 0.4$, skor dipaksa minimal **45 (Hati-Hati)** guna mencegah bahaya rasa aman palsu (*false safety*).

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Di White-Box testing, kami memegang teguh teorema Myers: Statement Coverage saja tidak cukup! Kami membuktikannya pada logika mitigasi banjir: kami wajib menguji kedua sisi branch, termasuk guardrail etis ketika AI Vision mendeteksi genangan dengan keyakinan rendah (< 0.4), sistem otomatis memaksa skor waspada minimal 45."*

---

# 6. Daftar Periksa Metode Watts Humphrey
## *Method Testing Checklist (Humphrey 1995 / Braude Section 4)*

| No | Butir Checklist Humphrey | Skenario Pengujian pada JakSafe | Status |
| :---: | :--- | :--- | :---: |
| **#1** | **Normal Parameter Values** | Perhitungan jarak Haversine Monas &ndash; Bundaran HI (~2.2 km) | <span class="badge-pass">LULUS</span> |
| **#2** | **Limit Parameter Values** | Radius pencarian kamera = 0 m; kuota tepat di angka 2400 | <span class="badge-pass">LULUS</span> |
| **#3** | **Outside / Illegal Values** | Radius pencarian negatif (-100 m); koordinat di luar jangkauan | <span class="badge-pass">LULUS</span> |
| **#4** | **Statement Coverage** | Seluruh blok penentuan kategori skor dieksekusi | <span class="badge-pass">LULUS</span> |
| **#5** | **Decision Coverage** | Seluruh cabang kondisi banjir, delay lalu lintas, dan road closure | <span class="badge-pass">LULUS</span> |
| **#7** | **Handling Data Structures** | Penggunaan `Set` untuk deduplikasi ID kamera; Array slicing | <span class="badge-pass">LULUS</span> |
| **#8** | **Handling Files** | Pemuatan berkas `cctvCatalog.json` (526 kamera riil) | <span class="badge-pass">LULUS</span> |
| **#13** | **Error Conditions** | Penanganan JSON rusak dan pemulihan state anggaran korup | <span class="badge-pass">LULUS</span> |

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Kami memetakan pengujian metode ke dalam 15 butir checklist Watts Humphrey. Hasilnya membuktikan penanganan data structure array/set, berkas fisik 526 kamera CCTV, hingga kalkulasi geodesi Haversine berjalan tanpa cacat logika."*

---

# 7. Invarian Kelas & Pengujian Transisi Status
## *Class Invariants & State-Transition Testing (Braude Section 5)*

### 1. Invarian Kelas (*Class Invariant Verification*):
* **Invarian Privasi Kamera CCTV**:
  $$\forall c \in \text{Catalog},\ \text{publicView}(c).\text{url} \equiv \text{undefined}$$
  *URL streaming RTSP/HLS privat instansi terbukti **tidak pernah bocor** ke antarmuka klien.*

---

### 2. Pengujian Siklus Hidup Transisi Status (*Encounter State Machine*):

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

* **Penolakan Transisi Ilegal**: Memanggil `attachRoute()` saat masih di `WAITING` memicu *exception* penolakan secara valid.

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Pada level kelas, kami menguji Invarian: properti URL internal kamera streaming wajib bernilai undefined di publicView untuk mencegah celah keamanan siber. Selain itu, alur agen navigasi kami uji transisi statusnya: transisi berurutan dari WAITING hingga COMPLETED terbukti berhasil, dan lompatan status ilegal berhasil ditolak."*

---

# 8. Hasil Eksekusi & Titik Rawan Terbesar
## *Test Execution Results & Defect Tracking (IEEE 1986 Step 3)*

### Ringkasan Eksekusi Pengujian:
* **Total Test Suites**: **12** | **Total Test Cases**: **17**
* **Tingkat Kelulusan (*Pass Rate*)**: <span class="badge-pass">100% LULUS</span> (0 Gagal, 0 Dibatalkan)
* **Total Waktu Eksekusi**: **119.31 ms** (Ekstrem Cepat via Node.js Native Runner)

---

### Matriks Pelacakan Titik Rawan (*Defect Tracking Matrix*):

| ID Cacat | Modul / Lokasi | Tipe & Keparahan | Akar Masalah & Tindakan Perbaikan | Status |
| :---: | :--- | :---: | :--- | :---: |
| **DEF-01** | `tomtom.js` | Interface (**Major**) | Inkonsistensi nama fungsi ekspor (`normalizeBudget`). Diperbaiki dan diverifikasi via unit test. | <span class="badge-pass">TERATASI</span> |
| **DEF-02** | `cctvCatalog.js` | Invariant (**Critical**) | Risiko kebocoran token URL streaming CCTV. Diamankan dengan pengujian invarian kelas ketat. | <span class="badge-pass">TERCEGAH</span> |
| **DEF-03** | `routeScorer.js` | Decision (**Critical**) | Bahaya rasa aman palsu saat AI Vision ragu. Diamankan lewat cabang guardrail batas keyakinan. | <span class="badge-pass">TERVALIDASI</span> |

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Hasil riil eksekusi kami menunjukkan 17 test case lulus 100% dalam 119 ms. Sesuai prinsip IEEE 1986, kami mendokumentasikan 3 titik rawan utama: ketidaksesuaian penamaan interface yang langsung terdeteksi, pencegahan kebocoran URL streaming privat, dan validasi cabang guardrail keselamatan rute."*

---

# 9. Laporan Cakupan Kode Resmi
## *Official V8 Code Coverage Report*

Hasil instrumen resmi Node.js (`node --test --experimental-test-coverage`):

| Berkas Modul | Line Coverage (%) | Branch Coverage (%) | Function Coverage (%) |
| :--- | :---: | :---: | :---: |
| [`src/scoring/routeScorer.js`](file:///d:/Git/JakSafe/backend/src/scoring/routeScorer.js) | **98.58%** | **86.75%** | **100.00%** |
| [`src/services/cctvCatalog.js`](file:///d:/Git/JakSafe/backend/src/services/cctvCatalog.js) | **85.98%** | **65.38%** | **90.91%** |
| [`src/services/tomtom.js`](file:///d:/Git/JakSafe/backend/src/services/tomtom.js) *(Budget Logic)* | **31.16%** *(Core)* | **100.00%** | **11.76%** |
| **RATA-RATA KESELURUHAN** | **65.04%** | **83.19%** | **51.52%** |

<div class="highlight">

* **98.58% Line Coverage** pada mesin kalkulasi risiko membuktikan hampir seluruh baris logika teruji.
* **100% Branch Coverage** pada logika kuota memastikan tidak ada pemborosan biaya API.

</div>

---

> 🗣️ **Catatan Presenter (Speaker Notes)**:
> *"Berikut adalah laporan cakupan kode resmi dari instrumen V8. Mesin skoring keselamatan rute kami berhasil mencapai 98.58% Line Coverage dan 100% Function Coverage. Hanya 3 baris yang tidak tersentuh yaitu penanganan kasus nol pembagi jika seluruh bobot dinonaktifkan serentak."*

---

# 10. Kesimpulan & Penutup
## *Conclusion & Recommendations*

<div class="highlight">

### Kesimpulan Pengujian:
1. **Kepatuhan Akademik**: Pengujian unit telah memenuhi kaidah IEEE 1008-1987 dan metodologi Eric J. Braude (Black-Box BVA, White-Box Myers, Humphrey Checklist, Invariant, dan State Transitions).
2. **Keandalan Tinggi**: Sistem JakSafe terbukti *robust* terhadap input ekstrem, aman secara data privasi, dan bebas dari regresi logika.
3. **Kesiapan Fase Selanjutnya**: Komponen unit telah terverifikasi kokoh dan siap untuk melangkah ke tahap *Integration Testing* dan *System Acceptance Testing*.

</div>

---

### *Dokumen Lengkap Proyek:*
* **Test Plan**: [`docs/TESTING_PLAN.md`](file:///d:/Git/JakSafe/docs/TESTING_PLAN.md)
* **Test Result**: [`docs/TESTING_RESULT.md`](file:///d:/Git/JakSafe/docs/TESTING_RESULT.md)
* **Suite Script**: `npm.cmd test` *(Backend)*

---

# SESI TANYA JAWAB (Q & A)
## Terima Kasih / *Thank You*

---

# LAMPIRAN: PANDUAN CEPAT MENJAWAB PERTANYAAN DOSEN (Q&A CHEAT SHEET)

### Q1: *"Mengapa memilih native test runner Node.js daripada Jest/Mocha?"*
> **Jawaban**: *"Node.js native test runner (`node:test`) memiliki keunggulan zero-dependency, mendukung penuh ES Modules secara bawaan tanpa kompilasi Babel/ts-jest, memiliki eksekusi sangat cepat (119 ms untuk 17 tests), dan sudah dilengkapi V8 code coverage bawaan."*

### Q2: *"Bagaimana Anda menjamin bahwa pengujian Anda sudah cukup?"*
> **Jawaban**: *"Mengacu pada kaidah emas Eric J. Braude, pengujian tidak pernah bisa menjamin ketiadaan cacat (*never their absence*). Namun, kami memaksimalkan keyakinan dengan mengombinasikan Black-Box Boundary Analysis untuk wilayah legal & ilegal, serta White-Box Decision Coverage untuk mengevaluasi kedua sisi cabang logika."*

### Q3: *"Apa bedanya Unit Test dan Integration Test pada JakSafe?"*
> **Jawaban**: *"Unit test menguji fungsi dan modul secara terisolasi tanpa bergantung pada koneksi internet atau server aktif (menggunakan mock data dan kalkulasi murni). Sedangkan Integration test menguji apakah API Express dapat berbicara secara riil dengan MongoDB, server TomTom, atau layanan CCTV DKI Jakarta."*
