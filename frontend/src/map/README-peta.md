# Folder peta, belum dikerjakan

Folder ini sengaja dibiarkan berisi kerangka saja. Peta tiga dimensi
dijadwalkan pada tahap berikutnya, setelah penyambungan ke backend
stabil dan setelah `POST /api/navigate` selesai dibuat.

## Kenapa kerangkanya sudah ada sekarang

Supaya pembagian tanggung jawab antar berkas sudah tetap sejak awal.
Kalau folder ini baru dibuat nanti, besar kemungkinan logika peta
tercampur ke dalam `resultController.js` dan sulit dipisahkan lagi.

## Rencana isi tiap berkas

| Berkas | Tanggung jawab |
|---|---|
| `cesiumViewer.js` | Membuat dan menutup viewer CesiumJS, mengatur kamera awal ke Jakarta |
| `routeLayer.js` | Menggambar garis rute dari `route.geometry`, mewarnainya sesuai label skor |
| `aqiLayer.js` | Lapisan kualitas udara dari titik yang dikembalikan `/api/aqi` |
| `cctvLayer.js` | Penanda kamera dari `/api/cctv/sources`, membuka cuplikan saat diklik |
| `trafficLayer.js` | Pewarnaan jalan dari tile vektor `/api/tomtom/flow/{z}/{x}/{y}.pbf` |
| `mapControls.js` | Tombol perbesar, perkecil, dan kembali ke rute |

## Hal yang sudah disiapkan di luar folder ini

- `src/utils/geo.js` punya `boundsOf` untuk mengarahkan kamera ke seluruh rute.
- `src/api/trafficApi.js` punya `polaUrlTileLaluLintas` yang mengembalikan
  pola alamat tile lengkap dengan penanda `{z}`, `{x}`, dan `{y}`.
- `src/styles/map.css` dari rancangan sebelumnya belum ikut disalin dan
  akan dibuat ulang bersama viewer, supaya gayanya menyesuaikan Cesium
  yang sebenarnya, bukan menyesuaikan gambar pengganti.

## Catatan koordinat

Geometri rute dari backend memakai urutan bujur lalu lintang. CesiumJS
juga memakai urutan bujur lalu lintang pada `Cartesian3.fromDegreesArray`,
jadi geometri bisa dipakai hampir langsung. Jangan memakai `fromBackendPair`
di sini karena fungsi itu justru membalik urutannya menjadi bentuk yang
dipakai tampilan.
