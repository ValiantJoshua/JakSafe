/*
   Konfigurasi Vite untuk frontend JakSafe.

   Ada tiga keputusan penting di file ini dan ketiganya saling berkaitan,
   jadi dibaca berurutan supaya jelas alasannya.

   1. Tidak ada index.html.
      Berkas masuk halaman ini bernama app.html, bukan index.html. Vite
      secara bawaan memakai mode "spa" yang otomatis melempar semua
      permintaan ke index.html, sehingga seolah olah halaman bisa dibuka
      sendiri. Mode itu dimatikan dengan appType "mpa" supaya Vite hanya
      melayani berkas HTML yang alamatnya diminta secara persis. Akibatnya
      tampilan hanya bisa dilihat lewat dev server, bukan dengan mengklik
      dua kali sebuah berkas di penjelajah berkas.

   2. Alamat root diarahkan ke app.html.
      Karena mode mpa tidak punya halaman bawaan, membuka http://localhost:5173/
      akan menghasilkan 404. Plugin kecil di bawah menambahkan middleware yang
      mengalihkan root ke /app.html, jadi anggota tim tetap bisa membuka alamat
      yang dicetak Vite tanpa perlu mengingat nama berkasnya.

   3. Semua permintaan /api diteruskan ke backend.
      Frontend tidak pernah memanggil OSRM, Open-Meteo, TomTom, atau sumber
      CCTV secara langsung. Semua lewat satu awalan /api yang diteruskan ke
      jaksafe-backend. Ini yang membuat tidak ada logika backend yang ditulis
      ulang di sisi frontend, sekaligus menghilangkan masalah CORS saat
      pengembangan karena dari sudut pandang browser semuanya satu asal.
*/

import { defineConfig, loadEnv } from 'vite';

// Berkas masuk halaman. Sengaja bukan index.html, lihat catatan nomor 1.
const ENTRY_HTML = 'app.html';

/**
 * Plugin kecil yang mengalihkan "/" ke "/app.html".
 * Dipasang di dev server dan di preview server supaya perilakunya sama.
 */
function arahkanRootKeEntry() {
  const alihkan = (server) => {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/' || req.url === '') {
        res.statusCode = 302;
        res.setHeader('Location', `/${ENTRY_HTML}`);
        res.end();
        return;
      }
      next();
    });
  };

  return {
    name: 'jaksafe-arahkan-root-ke-entry',
    configureServer: alihkan,
    configurePreviewServer: alihkan,
  };
}

export default defineConfig(({ mode }) => {
  // loadEnv membaca berkas .env di folder ini. Argumen ketiga dikosongkan
  // supaya variabel tanpa awalan VITE_ pun ikut terbaca di sisi konfigurasi.
  const env = loadEnv(mode, process.cwd(), '');
  const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://localhost:3001';

  return {
    appType: 'mpa',
    plugins: [arahkanRootKeEntry()],

    server: {
      port: 5173,
      strictPort: false,
      open: `/${ENTRY_HTML}`,
      proxy: {
        // Semua jalur /api diteruskan apa adanya ke backend, termasuk
        // /api/route, /api/aqi, /api/cctv, /api/tomtom, dan /api/navigate
        // ketika endpoint agen itu nanti selesai dibuat.
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
          // Tile vektor TomTom berbentuk biner (.pbf). Dibiarkan lewat
          // tanpa diubah supaya byte-nya tidak rusak.
          ws: false,
        },
      },
    },

    preview: {
      port: 4173,
      proxy: {
        '/api': { target: backendOrigin, changeOrigin: true },
      },
    },

    build: {
      outDir: 'dist',
      rollupOptions: {
        // Karena tidak ada index.html, berkas masuk harus disebutkan manual.
        input: { app: ENTRY_HTML },
      },
    },
  };
});
