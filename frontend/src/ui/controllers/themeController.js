/*
   Pengendali tema tampilan (Terang / Gelap).
   Mendukung toggle switch kapsul (Ikon Matahari & Bulan) sesuai panduan modern-web-guidance
   dengan sinkronisasi ARIA switch, meta color-scheme, dan storage cross-tab.
*/

import { $$, setPressed } from '../../utils/dom.js';
import { STORAGE_KEYS } from '../../config/constants.js';

function baca(kunci) {
  try {
    return localStorage.getItem(kunci);
  } catch {
    return null;
  }
}

function simpan(kunci, nilai) {
  try {
    localStorage.setItem(kunci, nilai);
  } catch {
    /* ignore */
  }
}

/**
 * Memasang tema pada dokumen dan memperbarui status sakelar.
 * @param {'terang'|'gelap'} tema
 */
export function pasangTema(tema) {
  const valid = tema === 'gelap' ? 'gelap' : 'terang';
  const isDark = valid === 'gelap';

  document.documentElement.setAttribute('data-theme', valid);
  if (document.body) {
    document.body.setAttribute('data-theme', valid);
    document.body.setAttribute('data-textsize', 'normal');
  }

  // Sinkronkan meta[name="color-scheme"] untuk preferensi native browser
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  if (metaScheme) {
    metaScheme.setAttribute('content', isDark ? 'dark' : 'light');
  }

  // Perbarui sakelar kapsul themeswitch (role="switch")
  const sakelarList = $$('.themeswitch');
  for (const sw of sakelarList) {
    sw.setAttribute('aria-checked', isDark ? 'true' : 'false');
    sw.setAttribute('data-theme', valid);
    sw.setAttribute(
      'aria-label',
      isDark ? 'Mode gelap aktif. Klik untuk beralih ke mode terang.' : 'Mode terang aktif. Klik untuk beralih ke mode gelap.'
    );
    sw.setAttribute('title', isDark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap');
  }

  // Kompatibilitas mundur tombol terpisah
  const tombol = $$('.themeswitch__btn');
  if (tombol.length > 0) {
    setPressed(tombol, tombol.find((t) => t.dataset.themeSet === valid));
  }

  simpan(STORAGE_KEYS.tema, valid);

  try {
    window.dispatchEvent(new CustomEvent('jaksafe:theme-change', { detail: { theme: valid } }));
  } catch {
    /* ignore */
  }
}

export function pasangPengendaliTema() {
  const tersimpan = baca(STORAGE_KEYS.tema);
  let temaAwal = 'terang';
  if (tersimpan === 'gelap' || tersimpan === 'terang') {
    temaAwal = tersimpan;
  } else if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    temaAwal = 'gelap';
  }

  pasangTema(temaAwal);

  // Pasang event listener pada sakelar (klik di mana saja pada switch akan men-toggle tema)
  for (const sw of $$('.themeswitch')) {
    sw.addEventListener('click', () => {
      const sekarang = document.body?.getAttribute('data-theme') === 'gelap' ? 'gelap' : 'terang';
      pasangTema(sekarang === 'gelap' ? 'terang' : 'gelap');
    });
  }

  // Sinkronisasi lintas tab jika pengguna mengubah tema di jendela lain
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.tema && (e.newValue === 'gelap' || e.newValue === 'terang')) {
      pasangTema(e.newValue);
    }
  });
}
