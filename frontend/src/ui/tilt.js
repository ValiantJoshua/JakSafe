/*
   Efek miring tiga dimensi mengikuti kursor.

   Dipasang pada kartu skor dan kartu kualitas udara. Sudut maksimalnya
   dibatasi tujuh derajat, dan angka itu dipilih dengan sengaja. Sudut yang
   lebih besar membuat teks di dalam kartu terlihat melengkung dan susah
   dibaca, terutama pada layar kecil. Tujuannya memberi kesan kedalaman,
   bukan memamerkan animasi.

   Efek ini hanya aktif pada perangkat yang benar benar punya tetikus.
   Pada layar sentuh, peristiwa pointermove datang dari jari yang sedang
   menggulir, sehingga kartu akan bergoyang setiap kali halaman digeser.
   Pemeriksaan pointer fine yang mencegah itu.

   Kalau pengguna menyalakan pengurangan gerak di sistemnya, efek tidak
   dipasang sama sekali. Ini aturan yang sama dengan yang berlaku di CSS.
*/

/** Sudut maksimal dalam derajat. */
const SUDUT_MAKS = 7;

/**
 * Memasang efek miring pada seluruh elemen berkelas tilt.
 * Dipanggil sekali dari main.js, setelah kerangka tampilan terpasang.
 */
export function pasangEfekMiring() {
  const punyaTetikus = window.matchMedia('(pointer: fine)').matches;
  const kurangiGerak = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!punyaTetikus || kurangiGerak) return;

  for (const kartu of document.querySelectorAll('.tilt')) {
    const lapisan = kartu.querySelector('.tilt__layer');
    if (!lapisan) continue;

    kartu.addEventListener('pointermove', (e) => {
      const kotak = kartu.getBoundingClientRect();
      // Posisi kursor diubah menjadi nilai antara minus satu dan satu,
      // dihitung dari titik tengah kartu.
      const x = (e.clientX - kotak.left) / kotak.width - 0.5;
      const y = (e.clientY - kotak.top) / kotak.height - 0.5;
      // Sumbu X dibalik tandanya supaya kartu terasa condong menjauh dari
      // kursor, bukan mengikuti, yang lebih sesuai dengan gerak benda nyata.
      lapisan.style.transform =
        `rotateX(${(-y * SUDUT_MAKS).toFixed(2)}deg) rotateY(${(x * SUDUT_MAKS).toFixed(2)}deg)`;
    });

    kartu.addEventListener('pointerleave', () => {
      lapisan.style.transform = '';
    });
  }
}
