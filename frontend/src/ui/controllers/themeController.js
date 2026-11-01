/*
   Pengendali tema tampilan (Terang / Gelap).
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
 * Memasang tema pada dokumen dan menandai tombol yang aktif.
 * @param {'terang'|'gelap'} tema
 */
function pasangTema(tema) {
  const valid = tema === 'gelap' ? 'gelap' : 'terang';
  document.body.setAttribute('data-theme', valid);
  document.body.setAttribute('data-textsize', 'normal');
  const tombol = $$('.themeswitch__btn');
  setPressed(tombol, tombol.find((t) => t.dataset.themeSet === valid));
  simpan(STORAGE_KEYS.tema, valid);
}

export function pasangPengendaliTema() {
  const tersimpan = baca(STORAGE_KEYS.tema);
  pasangTema(tersimpan === 'gelap' ? 'gelap' : 'terang');

  for (const tombol of $$('.themeswitch__btn')) {
    tombol.addEventListener('click', () => pasangTema(tombol.dataset.themeSet));
  }
}
