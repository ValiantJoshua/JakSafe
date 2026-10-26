/*
   Pembantu manipulasi DOM.

   Proyek ini memang tidak memakai kerangka kerja apa pun, jadi berkas ini
   yang menggantikan peran sedikit bagian React atau Vue. Isinya sengaja
   dibuat tipis, hanya hal hal yang dipakai berulang kali, supaya tidak
   berubah menjadi kerangka kerja buatan sendiri yang justru menambah
   beban belajar anggota tim.
*/

/** Pemendekan querySelector pada satu induk. */
export const $ = (pemilih, induk = document) => induk.querySelector(pemilih);

/** Pemendekan querySelectorAll yang langsung mengembalikan array biasa. */
export const $$ = (pemilih, induk = document) => Array.from(induk.querySelectorAll(pemilih));

/**
 * Membuat elemen beserta atribut dan anaknya dalam satu panggilan.
 *
 * @param {string} tag
 * @param {object} [atribut]  pasangan nama dan nilai atribut. Kunci "class"
 *                            dan "text" diperlakukan khusus supaya pemakaian
 *                            sehari hari lebih pendek.
 * @param {(Node|string)[]} [anak]
 * @returns {HTMLElement}
 */
export function el(tag, atribut = {}, anak = []) {
  const node = document.createElement(tag);
  for (const [kunci, nilai] of Object.entries(atribut)) {
    if (nilai === null || nilai === undefined || nilai === false) continue;
    if (kunci === 'class') node.className = nilai;
    else if (kunci === 'text') node.textContent = nilai;
    else if (kunci === 'html') node.innerHTML = nilai;
    else if (kunci.startsWith('on') && typeof nilai === 'function') {
      node.addEventListener(kunci.slice(2).toLowerCase(), nilai);
    } else node.setAttribute(kunci, nilai === true ? '' : String(nilai));
  }
  for (const a of [].concat(anak)) {
    node.append(a instanceof Node ? a : document.createTextNode(String(a)));
  }
  return node;
}

/**
 * Mengisi teks sebuah elemen kalau elemennya memang ada.
 *
 * Penjagaan null di sini bukan basa basi. Beberapa bagian tampilan baru
 * dibuat setelah ada hasil, jadi pengendali bisa saja memanggil fungsi ini
 * sebelum simpulnya terpasang. Tanpa penjagaan, satu bagian yang belum siap
 * akan menghentikan seluruh proses pembaruan tampilan.
 */
export function setText(simpul, teks) {
  if (simpul) simpul.textContent = teks;
}

/** Menyalakan atau mematikan atribut hidden. */
export function show(simpul, tampil = true) {
  if (simpul) simpul.hidden = !tampil;
}

/**
 * Menandai satu tombol sebagai terpilih di antara sekelompok tombol.
 * Memakai aria-pressed, bukan sekadar kelas CSS, supaya pembaca layar
 * ikut mengumumkan tombol mana yang sedang aktif.
 *
 * @param {HTMLElement[]} tombolSet
 * @param {HTMLElement} terpilih
 */
export function setPressed(tombolSet, terpilih) {
  for (const t of tombolSet) t.setAttribute('aria-pressed', String(t === terpilih));
}

/**
 * Menjalankan sebuah fungsi setelah peramban selesai menggambar.
 * Dipakai untuk animasi yang perlu nilai awal sempat terpasang dulu,
 * misalnya bar penilaian yang harus mulai dari lebar nol.
 */
export function afterPaint(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/**
 * Menghidupkan angka dari nol menuju nilai akhir.
 *
 * Durasi dibuat pendek dan memakai pelonggaran keluar supaya terasa hidup
 * tetapi tidak membuat pengguna menunggu. Kalau pengguna menyalakan
 * pengurangan gerak di sistemnya, animasi dilewati dan angka langsung
 * ditulis, sesuai aturan aksesibilitas yang sama dengan di CSS.
 *
 * @param {HTMLElement} simpul
 * @param {number} target
 * @param {number} [durasiMs=900]
 */
export function countTo(simpul, target, durasiMs = 900) {
  if (!simpul) return;
  const kurangiGerak = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (kurangiGerak) {
    simpul.textContent = String(Math.round(target));
    return;
  }
  const mulai = performance.now();
  const awal = Number(simpul.textContent) || 0;
  const langkah = (waktu) => {
    const t = Math.min(1, (waktu - mulai) / durasiMs);
    const pelonggaran = 1 - (1 - t) ** 3;
    simpul.textContent = String(Math.round(awal + (target - awal) * pelonggaran));
    if (t < 1) requestAnimationFrame(langkah);
  };
  requestAnimationFrame(langkah);
}
