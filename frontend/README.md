# JakSafe, Frontend

Antarmuka navigasi JakSafe. Seluruh datanya diambil dari `jaksafe-backend`
lewat satu awalan `/api`. Tidak ada data contoh, tidak ada skenario palsu,
dan tidak ada layanan luar yang dipanggil langsung dari peramban.

Folder ini dibuat untuk diletakkan sejajar dengan folder `backend` di
dalam satu repositori.

```
JakSafe/
├── backend/      milik tim backend
├── frontend/     folder ini
├── README.md
└── .gitignore
```

---

## Tidak ada index.html, dan itu disengaja

Berkas masuk halaman ini bernama **`app.html`**, bukan `index.html`.

Vite secara bawaan berjalan dalam mode `spa` yang melempar semua alamat ke
`index.html`, sehingga halaman seolah olah bisa dibuka sendiri. Mode itu
dimatikan lewat `appType: 'mpa'` pada `vite.config.js`, jadi Vite hanya
melayani berkas HTML yang alamatnya diminta secara persis.

Akibatnya tampilan **hanya bisa dilihat kalau dev server berjalan**.
Mengklik dua kali berkas apa pun di folder ini tidak akan menampilkan apa
apa, karena modul ES tidak dimuat lewat protokol `file://` dan pemanggilan
`/api` tidak punya tujuan.

`app.html` sendiri sengaja dibiarkan kosong dari sisi tampilan. Isinya
hanya `<div id="app">`. Seluruh topbar, panel, kartu, dan modal dibentuk
oleh modul JavaScript di dalam `src/ui/`.

Membuka `http://localhost:5173/` tetap berfungsi karena ada plugin kecil
di `vite.config.js` yang mengalihkan alamat root ke `/app.html`.

---

## Cara menjalankan

Butuh **dua terminal**, karena backend dan frontend adalah dua proses
terpisah.

### Terminal satu, backend

```bash
cd backend
npm install
cp .env.example .env     # lalu isi kuncinya bila ada
npm run dev
```

Tunggu sampai muncul

```
jakSafe backend running on http://localhost:3001
```

### Terminal dua, frontend

```bash
cd frontend
npm install
cp .env.example .env     # boleh dilewati kalau backend tetap di porta 3001
npm run dev
```

Buka alamat yang dicetak Vite, biasanya `http://localhost:5173`.

### Cara memastikan keduanya tersambung

Lihat penanda kecil di bilah atas.

| Penanda | Artinya |
|---|---|
| Titik hijau, Backend aktif | Semua siap |
| Titik oranye, Backend aktif TomTom mati | Backend hidup, kunci TomTom belum dipasang atau kuota harian habis. Penilaian tetap jalan memakai waktu dasar OSRM |
| Titik merah, Backend tidak aktif | Backend belum dijalankan atau portanya berbeda |

Kalau merah, layar galat akan memuat perintah persis yang perlu
dijalankan, jadi tidak perlu menebak nebak.

---

## Endpoint backend yang dipakai

Setiap endpoint punya satu berkas pembungkus di `src/api/`. Tidak ada
modul lain yang boleh memanggil `fetch` langsung.

| Endpoint | Berkas pembungkus | Dipakai untuk |
|---|---|---|
| `GET /api/health` | `healthApi.js` | Penanda sambungan di bilah atas |
| `GET /api/route` | `routeApi.js` | Geometri rute, jarak, waktu tempuh dasar |
| `GET /api/aqi` | `aqiApi.js` | PM2.5, indeks AQI, dan metrik tambahan |
| `GET /api/cctv/sources` | `cctvApi.js` | Daftar kamera, untuk tahap peta |
| `GET /api/cctv/nearest` | `cctvApi.js` | Kamera terdekat dari titik tengah rute |
| `GET /api/cctv/frame/:id` | `cctvApi.js` | Gambar kamera, dipasang langsung pada tag `img` |
| `GET /api/tomtom/status` | `trafficApi.js` | Keadaan kunci dan sisa kuota harian |
| `GET /api/tomtom/segment` | `trafficApi.js` | Kecepatan nyata dan persentase keterlambatan |
| `GET /api/tomtom/flow/:z/:x/:y.pbf` | `trafficApi.js` | Tile lalu lintas, disiapkan untuk tahap peta |
| `POST /api/navigate` | `navigateApi.js` | **Belum ada di backend**, lihat bagian berikutnya |

### Urutan koordinat

Backend memakai urutan **bujur lalu lintang** pada parameter `coords`,
lihat `parseCoords` di `backend/src/services/osrm.js`. Frontend memakai
bentuk `{ lat, lon }` di mana mana, dan pembalikannya hanya terjadi di
satu fungsi, yaitu `toCoordParam` pada `src/utils/geo.js`. Jangan membalik
urutan di tempat lain.

---

## Dua jalur hasil, agen dan pratinjau

`POST /api/navigate` belum dibuat. Di `backend/src/server.js` masih
tertulis `// TODO: POST /api/navigate`. Karena itu frontend punya dua
jalur dan pemilihannya terjadi otomatis di
`src/domain/navigationService.js`.

**Jalur agen.** Frontend memanggil `POST /api/navigate` sekali. Backend
yang menjalankan agen ReAct, memanggil keempat tool, menghitung skor, dan
mengirim satu objek hasil yang sudah lengkap.

**Jalur pratinjau.** Dipakai hanya kalau panggilan di atas menjawab 404.
Frontend merangkai sendiri hasilnya dengan memanggil endpoint data yang
sudah jadi secara berurutan, lalu menghitung skor memakai salinan rumus
backend di `src/domain/previewScorer.js`.

Perbedaan keduanya ditandai jelas di layar lewat lencana di pojok kartu
skor, sehingga tidak pernah ada angka pratinjau yang terlihat seperti
keputusan agen.

| | Jalur agen | Jalur pratinjau |
|---|---|---|
| Pemilihan tool | Diputuskan agen sesuai keadaan | Urutan tetap |
| Analisis citra kamera | Ada, memakai model penglihatan di backend | Tidak ada, kuncinya memang hanya di backend |
| Penalaran langkah demi langkah | Ada | Tidak ada |
| Penilaian rute pilihan lain | Bisa dengan data terpisah per rute | Memakai data lingkungan yang sama |
| Lencana di layar | Dinilai oleh agen JakSafe | Pratinjau, endpoint agen belum aktif |

### Bentuk yang diharapkan dari `POST /api/navigate`

Permintaan

```json
{
  "origin":      { "lat": -6.2146, "lon": 106.8211 },
  "destination": { "lat": -6.1754, "lon": 106.8272 },
  "profile":     "car",
  "preferences": { "healthSensitive": false }
}
```

Balasan

```json
{
  "ok": true,
  "route": { "distanceM": 7240, "durationS": 1180, "geometry": [[106.82, -6.21]] },
  "score": {
    "totalScore": 37, "label": "HATI-HATI", "color": "#f59e0b",
    "breakdown": { "time": {}, "aqi": {}, "condition": {} }
  },
  "air":    { "pm2_5": 68, "us_aqi": 106, "time": "2026-10-26T13:00" },
  "visual": { "cameraId": "sudirman-1", "cameraName": "...", "analysis": {} },
  "reasoning": [{ "step": 1, "thought": "...", "action": "...", "observation": "...", "durationMs": 820 }],
  "alternatives": [{ "distanceM": 8120, "durationS": 1360, "totalScore": 44, "label": "HATI-HATI" }]
}
```

Bagian `score` sengaja dibuat sama persis dengan keluaran
`calculateRouteScore` pada `backend/src/scoring/routeScorer.js`, jadi
backend cukup meneruskan objeknya apa adanya.

### Cara menghapus jalur pratinjau nanti

1. Pastikan `POST /api/navigate` sudah mengembalikan objek `score`.
2. Hapus `src/domain/previewScorer.js`.
3. Hapus fungsi `rangkaiPratinjau` beserta pemanggilnya di
   `src/domain/navigationService.js`.

Tidak ada berkas tampilan yang perlu disentuh, karena tampilan hanya
membaca bentuk objek, bukan asalnya.

---

## Struktur berkas

```
frontend/
├── app.html                        berkas masuk, kosong dari sisi tampilan
├── package.json
├── vite.config.js                  mode mpa, pengalihan root, proxy /api
├── .env.example
├── README.md
│
├── public/
│   └── jaksafe/images/
│       ├── logo.jpg                berkas asli tim
│       └── banner.jpg              berkas asli tim
│
└── src/
    ├── main.js                     titik masuk, mengimpor CSS dan memasang pengendali
    │
    ├── config/
    │   ├── constants.js            tetapan global, termasuk yang mencerminkan backend
    │   └── jakartaPlaces.js        daftar lokasi tetap, pengganti geocoding
    │
    ├── api/
    │   ├── httpClient.js           satu pintu fetch, batas waktu, pembatalan, jejak
    │   ├── healthApi.js
    │   ├── routeApi.js
    │   ├── aqiApi.js
    │   ├── cctvApi.js
    │   ├── trafficApi.js
    │   └── navigateApi.js          endpoint agen, belum ada di backend
    │
    ├── domain/
    │   ├── navigationService.js    pengatur alur, memilih jalur agen atau pratinjau
    │   ├── previewScorer.js        SEMENTARA, salinan rumus penilaian backend
    │   └── scoreLabels.js          label, warna, dan penyusunan kalimat alasan
    │
    ├── state/
    │   └── appState.js             satu sumber kebenaran keadaan aplikasi
    │
    ├── ui/
    │   ├── shell.js                perakit kerangka tampilan
    │   ├── icons.js                sprite ikon SVG
    │   ├── brand.js                logo dan banner beserta cadangan SVG
    │   ├── tilt.js                 efek miring mengikuti kursor
    │   ├── toast.js                pemberitahuan singkat
    │   ├── templates/              markup tiap bagian, tanpa perilaku
    │   │   ├── topbar.js
    │   │   ├── searchView.js
    │   │   ├── progressView.js
    │   │   ├── resultView.js
    │   │   ├── errorView.js
    │   │   ├── stageView.js
    │   │   └── loginModal.js
    │   └── controllers/            perilaku tiap bagian, tanpa markup
    │       ├── themeController.js
    │       ├── viewController.js
    │       ├── backendController.js
    │       ├── authController.js
    │       ├── searchController.js
    │       ├── progressController.js
    │       └── resultController.js
    │
    ├── utils/
    │   ├── dom.js
    │   ├── format.js
    │   └── geo.js                  satu satunya tempat urutan koordinat dibalik
    │
    ├── map/                        BELUM DIKERJAKAN, lihat README-peta.md
    │
    └── styles/
        ├── tokens.css              palette Brand Guide dan tiga tema
        ├── base.css
        ├── layout.css
        ├── components.css
        ├── panels.css
        ├── effects.css
        ├── parts.css               bagian yang lahir bersama penyambungan backend
        └── responsive.css
```

Pemisahan `templates` dan `controllers` dipegang ketat. Berkas di
`templates` hanya mengembalikan teks HTML dan tidak pernah memasang
pendengar peristiwa. Berkas di `controllers` hanya mencari elemen lewat id
dan memasang perilaku, tidak pernah menulis markup besar.

---

## Palette

Mengikuti Brand Guide JakSafe.

| Warna | Kode | Peran |
|---|---|---|
| Primary Blue | `#2A40D0` | Aksi utama, tombol |
| Secondary Blue | `#3D50D5` | Gradien dan hover |
| Accent Lime | `#D9ED66` | Aksen, sorotan |
| Supporting Green | `#90B83E` | Tulisan Safe, status aman |
| Text / Deep Navy | `#223469` | Tulisan Jak, teks tegas |
| Background | `#F5F6F5` | Latar sekunder |

Palette brand tidak punya warna peringatan, jadi dua warna status berikut
adalah tambahan semantik yang diselaraskan dengan brand. Nilainya sengaja
sama dengan `SCORE_LABELS` di backend.

| Status | Kode | Rentang skor |
|---|---|---|
| Aman | `#90B83E` dari palette | 0 sampai 29 |
| Hati-hati | `#E0A126` tambahan | 30 sampai 59 |
| Hindari | `#D5443F` tambahan | 60 sampai 100 |

---

## Tiga tema dan ukuran teks

Di kanan atas ada **Terang**, **Gelap**, dan **Kontras**, ditambah tombol
untuk memperbesar seluruh ukuran teks.

Mode Kontras bukan sekadar pilihan rasa. Mode itu dibuat untuk pengguna
usia lanjut dan pengguna dengan penglihatan terbatas. Seluruh rona tipis
dimatikan, bayangan dihapus, garis tepi dipertebal, dan ketebalan garis
ikon dinaikkan dari 2,4 menjadi 3. Semuanya dikerjakan lewat penimpaan
variabel di `tokens.css`, bukan lewat kelas tambahan di setiap komponen.

Pilihan tema dan ukuran teks disimpan di `localStorage`, dan itu satu
satunya hal yang bertahan setelah halaman dimuat ulang.

---

## Fitur masuk

Backend belum punya sistem akun, jadi tombol Masuk tidak mengirim apa pun
ke mana pun. Kata sandi yang diketik tidak dikirim, tidak disimpan, dan
tidak diperiksa.

Meski begitu satu keuntungan masuk **sudah benar benar berfungsi**, yaitu
profil kesehatan. Ketika dinyalakan, bobot polusi dinaikkan dari 0,35
menjadi 0,50 sebelum ketiga bobot dinormalkan, dan skor rute benar benar
berubah. Lihat `bobotUntuk` pada `src/domain/navigationService.js`.

Karena dinormalkan, angka yang tampil di kartu Rincian Penilaian menjadi
sekitar 43 persen, bukan 50 persen. Perilaku ini sama dengan yang
dilakukan backend pada `calculateRouteScore`, dan penjelasannya ikut
ditulis di kartu itu supaya tidak terkesan salah hitung.

Rute tersimpan hanya hidup selama satu sesi peramban, karena endpoint
untuk menyimpannya belum ada.

---

## Yang belum dikerjakan

Peta tiga dimensi beserta lapisan rute, kualitas udara, lalu lintas, dan
penanda kamera. Lihat `src/map/README-peta.md`.

Pencarian alamat yang sebenarnya. Saat ini memakai daftar lokasi tetap di
`src/config/jakartaPlaces.js` karena backend belum menyediakan geocoding.

Sistem akun yang sebenarnya, riwayat perjalanan, dan peringatan dini area
rawan banjir. Semuanya menunggu endpoint di sisi backend.

Katalog kamera. Berkas `backend/src/data/cctvCatalog.json` masih berisi
array kosong, jadi kartu Bukti Kondisi Jalan hampir selalu menampilkan
keadaan tanpa kamera. Itu keadaan normal, bukan kegagalan, dan sudah
ditangani dengan tampilan yang tenang.
