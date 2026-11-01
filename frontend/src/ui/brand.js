/*
   Aset brand JakSafe.

   Logo dan banner memakai berkas gambar asli milik tim, disimpan di dalam
   folder public sehingga Vite menyajikannya apa adanya tanpa diproses.
   Alamatnya dimulai dari garis miring karena itulah cara Vite memetakan
   isi folder public ke akar situs.

   Setiap gambar punya versi SVG cadangan. Kalau berkasnya hilang atau
   gagal dimuat, kelas is-fallback dipasang lewat atribut onerror dan
   versi SVG yang tampil, sehingga halaman tidak pernah menyisakan kotak
   kosong. Bentuk SVG cadangan sengaja mengikuti Brand Guide, bukan
   meniru gambar aslinya.

   Ukuran berkas aslinya
     banner.jpg  1576 x 828  rasio 1,90, sudah memuat logo dan tagline
     logo.jpg     735 x 674  hanya tanda logo, latar putih
*/

const ASSETS = {
  logo: '/jaksafe/images/logo.jpg',
  banner: '/jaksafe/images/banner.jpg',
};

/** Versi SVG cadangan tanda logo, dipakai kalau logo.jpg gagal dimuat. */
function logoMarkFallback(size, idSuffix) {
  const u = idSuffix || 'a';
  return `
<svg width="${size}" height="${size}" viewBox="0 0 64 64" class="logomark" role="img" aria-label="Logo JakSafe">
  <defs>
    <linearGradient id="bgBlue-${u}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3D50D5"/>
      <stop offset="1" stop-color="#1E2FA3"/>
    </linearGradient>
    <linearGradient id="leafG-${u}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#90B83E"/>
      <stop offset="1" stop-color="#D9ED66"/>
    </linearGradient>
    <linearGradient id="ribG-${u}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#D9ED66"/>
      <stop offset="1" stop-color="#90B83E"/>
    </linearGradient>
  </defs>

  <rect width="64" height="64" rx="17" fill="url(#bgBlue-${u})"/>

  <!-- siluet Monas -->
  <g fill="#FFFFFF" opacity=".95">
    <path d="M20.6 11.5 L23.4 19 H17.8 Z"/>
    <rect x="19.4" y="19" width="2.6" height="17" rx="1"/>
    <rect x="15.6" y="35.4" width="10.2" height="3" rx="1.2"/>
  </g>

  <!-- pita hijau -->
  <path d="M9 49 C19 41 27 39 36 33 C45 27 50 20 53 13"
        stroke="url(#ribG-${u})" stroke-width="6.5" stroke-linecap="round" fill="none"/>

  <!-- badan jalan -->
  <path d="M12 56 C22 48 30 46 39 40 C48 34 53 27 56 20"
        stroke="#16224A" stroke-width="10.5" stroke-linecap="round" fill="none"/>
  <!-- marka jalan -->
  <path class="roadline" d="M12 56 C22 48 30 46 39 40 C48 34 53 27 56 20"
        stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round" fill="none"
        stroke-dasharray="3 5"/>

  <!-- daun -->
  <g class="logoleaf">
    <path d="M44 18 C44 9.5 50.5 4 58.5 4 C58.5 12.5 52 18 44 18 Z" fill="url(#leafG-${u})"/>
    <path d="M47.5 14.5 C50.5 11 54 8.5 57 7.2" stroke="#FFFFFF" stroke-width="1.1"
          stroke-linecap="round" fill="none" opacity=".75"/>
  </g>
</svg>`;
}

/** Versi SVG cadangan banner, dipakai kalau banner.jpg gagal dimuat. */
function heroBannerFallback() {
  return `
<svg class="hero__art" viewBox="0 0 1200 430" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
  <defs>
    <linearGradient id="farCity" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C3CEEA"/>
      <stop offset="1" stop-color="#DCE4F4"/>
    </linearGradient>
    <linearGradient id="nearCity" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9FB0DC"/>
      <stop offset="1" stop-color="#BECBE8"/>
    </linearGradient>
    <linearGradient id="roadG" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#223469"/>
      <stop offset="1" stop-color="#16224A"/>
    </linearGradient>
    <linearGradient id="leafH" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#90B83E"/>
      <stop offset="1" stop-color="#D9ED66"/>
    </linearGradient>
  </defs>

  <!-- awan lembut -->
  <g class="hero__clouds" opacity=".5">
    <ellipse cx="210" cy="52"  rx="92"  ry="22" fill="#FFFFFF"/>
    <ellipse cx="278" cy="62"  rx="64"  ry="17" fill="#FFFFFF"/>
    <ellipse cx="940" cy="40"  rx="104" ry="25" fill="#FFFFFF"/>
    <ellipse cx="1022" cy="52" rx="70"  ry="18" fill="#FFFFFF"/>
  </g>

  <!-- skyline belakang, bentuk kotak lurus supaya tidak ramai -->
  <g fill="url(#farCity)">
    <rect x="34"   y="182" width="56" height="152"/>
    <rect x="104"  y="214" width="44" height="120"/>
    <rect x="162"  y="158" width="64" height="176"/>
    <rect x="240"  y="202" width="48" height="132"/>
    <rect x="912"  y="176" width="60" height="158"/>
    <rect x="986"  y="212" width="46" height="122"/>
    <rect x="1046" y="166" width="68" height="168"/>
  </g>

  <!-- Monas -->
  <g class="hero__monas">
    <path d="M610 62 L622 116 H598 Z" fill="#C9D657"/>
    <rect x="605.5" y="114" width="9" height="158" fill="#B9C6E0"/>
    <rect x="589"   y="270" width="42" height="14" fill="#AAB9D8"/>
    <rect x="576"   y="282" width="68" height="12" fill="#9FB0DC"/>
  </g>

  <!-- skyline depan -->
  <g fill="url(#nearCity)">
    <rect x="312" y="232" width="54" height="102"/>
    <rect x="380" y="200" width="42" height="134"/>
    <rect x="436" y="246" width="48" height="88"/>
    <rect x="676" y="220" width="52" height="114"/>
    <rect x="742" y="250" width="40" height="84"/>
    <rect x="796" y="204" width="56" height="130"/>
  </g>

  <!-- pita hijau di tepi jalan -->
  <path d="M-20 372 L300 330 L560 330 L820 288 L1220 258"
        stroke="url(#leafH)" stroke-width="12" stroke-linejoin="round" fill="none" opacity=".88"/>

  <!-- jalan, dibentuk dari ruas lurus dan diagonal -->
  <path d="M-20 420 L300 378 L560 378 L820 336 L1220 306"
        stroke="url(#roadG)" stroke-width="74" stroke-linejoin="round" fill="none"/>
  <path class="hero__dash" d="M-20 420 L300 378 L560 378 L820 336 L1220 306"
        stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round" fill="none"
        stroke-dasharray="30 26" opacity=".92"/>

  <!-- daun melayang -->
  <g class="hero__leaf hero__leaf--1">
    <path d="M140 134 C140 114 155 101 175 101 C175 121 160 134 140 134 Z" fill="url(#leafH)" opacity=".8"/>
  </g>
  <g class="hero__leaf hero__leaf--2">
    <path d="M1024 146 C1024 131 1035 122 1050 122 C1050 137 1039 146 1024 146 Z" fill="url(#leafH)" opacity=".65"/>
  </g>
  <g class="hero__leaf hero__leaf--3">
    <path d="M772 104 C772 91 781 84 794 84 C794 97 785 104 772 104 Z" fill="url(#leafH)" opacity=".55"/>
  </g>
</svg>`;
}

/**
 * Gambar kecil bergaya ilustrasi untuk kartu rute populer.
 * Dibuat dari SVG, bukan foto, supaya ukuran berkasnya sangat kecil dan
 * warnanya bisa mengikuti palet brand pada tiap varian waktu.
 *
 * @param {'pagi'|'siang'|'sore'} varian
 * @returns {string}
 */
export function routeThumb(variant) {
  const sets = {
    pagi:  { sky1: '#DCE8FF', sky2: '#F3F8EA', city: '#A9B8DF', accent: '#90B83E' },
    siang: { sky1: '#E9F0FF', sky2: '#FBFDF4', city: '#B6C3E4', accent: '#D9ED66' },
    sore:  { sky1: '#E4E4FB', sky2: '#F6F0E8', city: '#9AA8D4', accent: '#E0A126' }
  };
  const c = sets[variant] || sets.siang;
  return `
<svg viewBox="0 0 160 96" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="th-${variant}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.sky1}"/><stop offset="1" stop-color="${c.sky2}"/>
    </linearGradient>
  </defs>
  <rect width="160" height="96" fill="url(#th-${variant})"/>
  <g fill="${c.city}" opacity=".85">
    <rect x="8"  y="30" width="18" height="40"/>
    <rect x="32" y="42" width="14" height="28"/>
    <rect x="52" y="24" width="20" height="46"/>
    <rect x="112" y="34" width="16" height="36"/>
    <rect x="134" y="46" width="14" height="24"/>
  </g>
  <path d="M86 20 L92 42 H80 Z" fill="${c.accent}"/>
  <rect x="84" y="41" width="4" height="29" fill="${c.city}"/>
  <path d="M-4 92 L60 74 L104 74 L164 58" stroke="#223469" stroke-width="20"
        stroke-linejoin="round" fill="none"/>
  <path d="M-4 92 L60 74 L104 74 L164 58" stroke="#FFFFFF" stroke-width="2.4"
        stroke-linejoin="round" fill="none" stroke-dasharray="9 8" opacity=".9"/>
</svg>`;
}

/**
 * Tanda logo berbentuk kotak membulat, dipakai di topbar dan modal masuk.
 *
 * @param {number} ukuran   sisi kotak dalam piksel
 * @param {string} [sufiks] pembeda id gradien di dalam SVG cadangan. Wajib
 *        berbeda tiap pemakaian karena id yang kembar membuat gradien
 *        salah satu logo ikut berubah saat yang lain dilepas dari DOM.
 * @returns {string} potongan HTML
 */
export function logoMark(ukuran, sufiks = 'a') {
  return `
<span class="logomark" style="width:${ukuran}px;height:${ukuran}px">
  <img class="logomark__img" src="${ASSETS.logo}" alt="Logo JakSafe" loading="eager"
       onerror="this.closest('.logomark').classList.add('is-fallback')">
  <span class="logomark__fb">${logoMarkFallback(ukuran, sufiks)}</span>
</span>`;
}

/**
 * Logo mendatar, tanda ditambah tulisan JakSafe.
 * Warna tulisannya mengikuti Brand Guide, Jak memakai Deep Navy dan Safe
 * memakai Supporting Green. Pengaturan warnanya ada di layout.css supaya
 * tema gelap bisa menaikkan kecerahannya.
 *
 * @param {number} ukuranTanda
 * @param {string} sufiks
 * @param {boolean} [denganTagline=false]
 * @returns {string}
 */
export function logoHorizontal(ukuranTanda, sufiks, denganTagline = false) {
  return `
<span class="logo">
  ${logoMark(ukuranTanda, sufiks)}
  <span class="logo__text">
    <span class="logo__word"><span class="w-jak">Jak</span><span class="w-safe">Safe</span></span>
    ${denganTagline ? '<span class="logo__tag">Rute Lebih Aman untuk Jakarta</span>' : ''}
  </span>
</span>`;
}

/**
 * Banner sambutan yang mengisi penuh panggung kanan.
 *
 * Rasio banner 1,90 sedangkan panelnya lebih tinggi, jadi kalau gambar
 * dipaksa menutup seluruh bidang, logo dan taglinenya ikut terpotong.
 * Pemecahannya dua lapis. Lapisan belakang memakai gambar yang sama
 * dalam keadaan diperbesar dan diburamkan untuk mengisi sisa ruang,
 * lapisan depan memuat gambar aslinya secara utuh. Tepi atas dan bawah
 * lapisan depan dilembutkan dengan mask gradien di panels.css sehingga
 * sambungan kedua lapisan tidak terlihat.
 *
 * @returns {string}
 */
export function heroBanner() {
  return `
<div class="hero__media">
  <img class="hero__bg" src="${ASSETS.banner}" alt="" aria-hidden="true" loading="eager">
  <img class="hero__img" src="${ASSETS.banner}" alt="Banner JakSafe" loading="eager"
       onerror="this.closest('.hero__media').classList.add('is-fallback')">
  <div class="hero__fb">${heroBannerFallback()}</div>
</div>`;
}
