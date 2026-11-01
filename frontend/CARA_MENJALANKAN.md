# Cara Menjalankan JakSafe

Panduan langkah demi langkah, dari repositori kosong sampai tampilan
muncul di peramban. Ditulis supaya anggota tim yang belum pernah
menyentuh proyek ini bisa ikut menjalankan.

---

## Yang perlu dipasang lebih dulu

| Perkakas | Versi | Cara memeriksa |
|---|---|---|
| Node.js | 20 atau lebih baru | `node -v` |
| npm | ikut Node.js | `npm -v` |
| Git | bebas | `git --version` |

Kalau `node -v` menjawab bahwa perintahnya tidak dikenali, pasang dulu
dari `https://nodejs.org`, pilih versi LTS.

---

## Langkah satu, menaruh folder frontend ke repositori

Ekstrak isi zip ini sehingga strukturnya menjadi seperti berikut.

```
JakSafe/
├── backend/
├── frontend/      <- hasil ekstrak zip ini
├── README.md
└── .gitignore
```

Folder `frontend` berisi `app.html`, `package.json`, `vite.config.js`,
dan folder `src`. Kalau setelah ekstrak muncul folder bertingkat seperti
`frontend/frontend/`, naikkan isinya satu tingkat.

---

## Langkah dua, menyiapkan backend

Buka terminal pertama.

```bash
cd JakSafe/backend
npm install
```

Salin berkas lingkungan lalu isi seperlunya.

```bash
# Windows PowerShell
copy .env.example .env

# macOS dan Linux
cp .env.example .env
```

Isi `.env` paling sederhana yang sudah cukup untuk menjalankan frontend.

```
MONGODB_URI=mongodb://localhost:27017/jaksafe
CCTV_FILE_PATH=./src/data/cctvCatalog.json
PORT=3001
```

`GEMINI_API_KEY` dan `TOMTOM_API_KEY` boleh dibiarkan kosong. Tanpa
keduanya backend tetap jalan, hanya saja data lalu lintas dan analisis
citra tidak tersedia, dan frontend sudah menangani keadaan itu dengan
menampilkan penanda khusus.

Jalankan backend.

```bash
npm run dev
```

Tunggu sampai muncul tulisan berikut, dan **biarkan terminal ini terbuka**.

```
jakSafe backend running on http://localhost:3001
```

### Memastikan backend benar benar hidup

Buka `http://localhost:3001/api/health` di peramban. Harus muncul

```json
{"status":"ok","service":"jaksafe-backend","time":"..."}
```

---

## Langkah tiga, menjalankan frontend

Buka terminal **kedua**, jangan tutup terminal pertama.

```bash
cd JakSafe/frontend
npm install
```

Salin berkas lingkungan.

```bash
# Windows PowerShell
copy .env.example .env

# macOS dan Linux
cp .env.example .env
```

Isi bawaannya sudah benar kalau backend memakai porta 3001.

```
VITE_BACKEND_ORIGIN=http://localhost:3001
VITE_API_BASE=/api
```

Jalankan frontend.

```bash
npm run dev
```

Akan muncul kira kira seperti ini.

```
VITE v6.0.0  ready in 320 ms
➜  Local:   http://localhost:5173/
```

Buka alamat itu. Kalau peramban tidak terbuka sendiri, salin alamatnya
secara manual.

---

## Memastikan keduanya tersambung

Lihat penanda kecil di bilah atas, di sebelah kiri pemilih tema.

| Penanda | Artinya | Yang perlu dilakukan |
|---|---|---|
| Titik hijau, **Backend aktif** | Semua siap | Tidak ada |
| Titik oranye, **Backend aktif TomTom mati** | Backend hidup, kunci TomTom belum dipasang atau kuota harian habis | Boleh dilanjutkan, penilaian tetap jalan memakai waktu dasar OSRM |
| Titik merah, **Backend tidak aktif** | Backend belum dijalankan atau portanya berbeda | Periksa terminal pertama |

Kemudian tekan **Cari Rute Aman**. Kalau muncul kartu skor, berarti
seluruh rantai sudah tersambung, yaitu peramban ke dev server Vite, lalu
ke backend, lalu ke OSRM dan Open-Meteo.

---

## Kenapa tidak bisa dibuka dengan klik dua kali

Pertanyaan ini pasti muncul, jadi dijawab di sini.

Folder ini **tidak punya `index.html`**. Berkas masuknya bernama
`app.html` dan isinya sengaja kosong dari sisi tampilan, hanya berisi
`<div id="app">`. Seluruh antarmuka dibentuk oleh modul JavaScript saat
aplikasi berjalan.

Mengklik dua kali berkas apa pun di folder ini tidak akan menampilkan apa
apa, karena dua hal. Pertama, modul ES tidak dimuat lewat protokol
`file://`. Kedua, pemanggilan `/api` tidak punya tujuan tanpa dev server
yang meneruskannya ke backend.

Jadi satu satunya cara melihat tampilan adalah menjalankan `npm run dev`
pada kedua folder. Itu memang keadaan yang diinginkan, supaya tidak
pernah ada tampilan yang terlihat jadi padahal datanya tidak ada.

---

## Masalah yang sering muncul

### Halaman putih kosong, tidak ada apa apa

Buka alat pengembang peramban dengan F12, lihat tab Console. Biasanya
karena `npm install` belum dijalankan di folder frontend.

### `http://localhost:5173/` menjawab 404

Seharusnya tidak terjadi karena ada pengalihan otomatis ke `/app.html`.
Kalau tetap terjadi, buka langsung `http://localhost:5173/app.html`.

### Layar galat bertuliskan Backend JakSafe tidak dapat dihubungi

Backend belum dijalankan, atau portanya bukan 3001. Periksa terminal
pertama, lalu cocokkan `PORT` di `backend/.env` dengan
`VITE_BACKEND_ORIGIN` di `frontend/.env`.

### Porta 5173 atau 3001 sudah dipakai

Untuk frontend, jalankan dengan porta lain.

```bash
npm run dev -- --port 5174
```

Untuk backend, ubah `PORT` di `backend/.env`, lalu sesuaikan
`VITE_BACKEND_ORIGIN` di `frontend/.env`.

### Tulisan Kualitas Udara kosong atau bertanda hubung

Open-Meteo sedang tidak bisa dihubungi dari jaringan yang dipakai.
Nilainya memang tidak ditebak, jadi yang tampil tanda hubung. Penilaian
polusi memakai nilai netral dalam keadaan ini.

### Kartu Bukti Kondisi Jalan selalu bertuliskan tidak ada kamera

Itu normal untuk sekarang. Berkas `backend/src/data/cctvCatalog.json`
masih berisi array kosong. Setelah daftar kamera diisi mengikuti bentuk
pada `cctvCatalog.example.json`, kartunya akan menampilkan gambar.

### Lencana di kartu skor bertuliskan Pratinjau

Itu juga normal. Artinya `POST /api/navigate` belum ada di backend,
sehingga frontend merangkai hasilnya sendiri dari endpoint data yang
sudah jadi. Penjelasan lengkapnya ada di `README.md` bagian dua jalur
hasil.

---

## Menaruh ke GitHub

Dari folder paling atas, yaitu `JakSafe`, bukan dari dalam `frontend`.

```bash
cd JakSafe
git add frontend
git commit -m "feat(frontend): antarmuka tersambung ke backend"
git push
```

Folder `node_modules` dan `dist` tidak akan ikut terkirim karena sudah
tercantum di `.gitignore`. Berkas `.env` juga tidak ikut, yang terkirim
hanya `.env.example`.

---

## Membuat berkas siap pakai

Untuk menghasilkan berkas statis yang bisa diunggah ke hosting.

```bash
cd frontend
npm run build
```

Hasilnya ada di folder `dist`. Untuk mencobanya sebelum diunggah.

```bash
npm run preview
```

Perlu dicatat, hasil build tetap membutuhkan backend yang hidup. Pada
tahap pemasangan sungguhan nanti, `/api` perlu diarahkan ke alamat
backend lewat pengaturan server, bukan lewat proxy Vite.
