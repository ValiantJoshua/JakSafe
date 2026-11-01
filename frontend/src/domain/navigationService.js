/*
   Pengatur alur pencarian rute.

   Berkas ini yang menjawab pertanyaan "apa yang sebenarnya terjadi setelah
   tombol Cari Rute Aman ditekan". Isinya murni logika alur, tidak ada satu
   pun sentuhan ke DOM, sehingga bisa diuji terpisah dari tampilan.

   Ada dua jalur yang mungkin ditempuh dan pemilihannya terjadi otomatis.

   JALUR SATU, AGEN.
   Frontend memanggil POST /api/navigate sekali. Backend yang menjalankan
   agen ReAct, memanggil keempat tool, menghitung skor, lalu mengirim satu
   objek hasil yang sudah lengkap. Ini jalur yang dituju dan satu satunya
   jalur yang akan tersisa setelah backend rampung.

   JALUR DUA, PRATINJAU.
   Dipakai hanya kalau panggilan di atas menjawab 404, yang artinya
   endpoint agen memang belum dibuat. Frontend lalu merangkai sendiri
   hasilnya dengan memanggil endpoint data yang sudah jadi secara
   berurutan, lalu menghitung skor memakai salinan rumus backend di
   src/domain/previewScorer.js.

   Perbedaan penting antara keduanya, dan ini yang harus disampaikan
   kalau ditanya. Jalur pratinjau tidak melakukan penalaran apa pun. Ia
   tidak memilih tool berdasarkan keadaan, tidak menimbang rute pilihan
   lain berdasarkan konteks, dan tidak menganalisis citra kamera karena
   analisis citra memang hanya ada di sisi backend bersama kunci Gemini.
   Jadi jalur pratinjau adalah pipa data yang lurus, sedangkan jalur agen
   adalah pengambilan keputusan. Hasilnya diberi penanda sumber supaya
   perbedaan ini selalu terlihat di layar.

   Satu lagi yang perlu diperhatikan. Urutan pemanggilan di jalur
   pratinjau sengaja dibuat bertahap, bukan serentak semuanya, karena
   langkah berikutnya butuh hasil langkah sebelumnya. Titik contoh untuk
   kualitas udara baru bisa ditentukan setelah geometri rute diterima,
   dan kamera terdekat baru bisa dicari setelah tahu rute melewati mana.
*/

import { SUMBER_HASIL, SAMPLING, DEFAULT_WEIGHTS } from '../config/constants.js';
import { mintaNavigasi, karenaEndpointBelumAda } from '../api/navigateApi.js';
import { ambilRute } from '../api/routeApi.js';
import { ambilKualitasUdara, ringkasUdara, metrikTambahanUntuk } from '../api/aqiApi.js';
import { ambilKameraTerdekat } from '../api/cctvApi.js';
import { ambilLaluLintasTerparah, cekStatusLaluLintas } from '../api/trafficApi.js';
import { mulaiJejak, ambilJejak } from '../api/httpClient.js';
import { sampleAlongRoute, midpointOf } from '../utils/geo.js';
import { calculateRouteScore } from './previewScorer.js';

/**
 * Nama tiap tahap proses. Dipakai tampilan progres untuk menandai langkah
 * mana yang sedang berjalan. Urutannya mengikuti urutan nyata pemanggilan.
 */
export const TAHAP = [
  { id: 'rute', nama: 'Menghitung rute jalan' },
  { id: 'lalulintas', nama: 'Memeriksa arus lalu lintas' },
  { id: 'udara', nama: 'Membaca kualitas udara' },
  { id: 'cctv', nama: 'Mencari kamera di sekitar rute' },
  { id: 'skor', nama: 'Menyusun penilaian dan rekomendasi' },
];

/**
 * @typedef {object} HasilNavigasi
 * @property {string} sumber       SUMBER_HASIL.AGEN atau SUMBER_HASIL.PRATINJAU
 * @property {object} route        { distanceM, durationS, geometry }
 * @property {object} score        bentuknya sama dengan keluaran backend
 * @property {object|null} air     ringkasan kualitas udara
 * @property {object|null} visual  kamera dan hasil analisisnya
 * @property {object[]} alternatives
 * @property {object[]} jejak      catatan panggilan HTTP yang sungguh terjadi
 * @property {number} lamaMs       total waktu dari awal sampai hasil siap
 */

/**
 * Menyusun bobot penilaian berdasarkan pengaturan pengguna.
 *
 * Profil kesehatan menaikkan bobot polusi dari nol koma tiga lima menjadi
 * nol koma lima. Angka bobot lain dibiarkan apa adanya karena previewScorer
 * dan backend sama sama menormalkan jumlahnya menjadi satu. Inilah wujud
 * nyata dari keuntungan masuk yang dijanjikan pada modal masuk, bukan
 * sekadar janji di layar.
 *
 * @param {boolean} sensitifKesehatan
 * @returns {{time:number, aqi:number, condition:number}}
 */
export function bobotUntuk(sensitifKesehatan) {
  if (!sensitifKesehatan) return { ...DEFAULT_WEIGHTS };
  return { ...DEFAULT_WEIGHTS, aqi: 0.50 };
}

/**
 * Mencari rute beserta penilaiannya.
 *
 * @param {object} opsi
 * @param {{lat:number, lon:number, nama?:string}} opsi.asal
 * @param {{lat:number, lon:number, nama?:string}} opsi.tujuan
 * @param {'car'|'bike'|'foot'} opsi.profil
 * @param {boolean} [opsi.sensitifKesehatan=false]
 * @param {AbortSignal} [opsi.signal]
 * @param {(idTahap:string)=>void} [opsi.saatTahap] dipanggil tiap tahap dimulai
 * @returns {Promise<HasilNavigasi>}
 */
export async function cariRute({
  asal,
  tujuan,
  profil,
  sensitifKesehatan = false,
  signal,
  saatTahap = () => {},
}) {
  const mulai = performance.now();
  mulaiJejak();

  try {
    // Jalur satu. Dicoba lebih dulu, tanpa syarat apa pun, supaya begitu
    // backend selesai jalur ini langsung terpakai tanpa perubahan kode.
    const balasan = await mintaNavigasi({
      asal, tujuan, profil, sensitifKesehatan, signal,
    });

    return {
      sumber: SUMBER_HASIL.AGEN,
      route: balasan.route,
      score: balasan.score,
      air: balasan.air || null,
      visual: balasan.visual || null,
      alternatives: balasan.alternatives || [],
      reasoning: balasan.reasoning || [],
      jejak: ambilJejak(),
      lamaMs: performance.now() - mulai,
    };
  } catch (galat) {
    // Hanya 404 dan 501 yang boleh berpindah ke jalur pratinjau. Galat lain,
    // misalnya backend mati atau permintaan dibatalkan pengguna, harus tetap
    // dilempar supaya tampilan memberi pesan yang benar. Menelan semua galat
    // di sini akan membuat backend yang bermasalah terlihat seperti berhasil.
    if (!karenaEndpointBelumAda(galat)) {
      ambilJejak();
      throw galat;
    }
  }

  // Jalur dua. Mulai dari sini semuanya memakai endpoint data mentah.
  const hasil = await rangkaiPratinjau({
    asal, tujuan, profil, sensitifKesehatan, signal, saatTahap,
  });

  return {
    ...hasil,
    sumber: SUMBER_HASIL.PRATINJAU,
    jejak: ambilJejak(),
    lamaMs: performance.now() - mulai,
  };
}

/**
 * Merangkai hasil dari endpoint data mentah.
 *
 * Dipisah menjadi fungsi tersendiri supaya penghapusannya nanti mudah,
 * cukup membuang fungsi ini beserta pemanggilnya di cariRute.
 *
 * @private
 */
async function rangkaiPratinjau({
  asal, tujuan, profil, sensitifKesehatan, signal, saatTahap,
}) {
  // Tahap satu, rute. Ini satu satunya tahap yang wajib berhasil. Tanpa
  // geometri rute, tidak ada titik yang bisa dipakai untuk tahap lain.
  saatTahap('rute');
  const { routes } = await ambilRute({ asal, tujuan, profil, alternatif: true, signal });
  if (routes.length === 0) {
    throw new Error('Tidak ada rute yang ditemukan untuk titik tersebut.');
  }
  const rute = routes[0];

  // Tahap dua, lalu lintas. Boleh gagal. Kalau kunci TomTom belum dipasang
  // atau kuota harian habis, hasilnya null dan penilaian memakai waktu
  // dasar OSRM. Status dicek lebih dulu supaya tidak membuang panggilan
  // ke endpoint segmen kalau sudah jelas tidak akan berhasil.
  saatTahap('lalulintas');
  const statusLaluLintas = await cekStatusLaluLintas(signal);
  let laluLintas = null;
  if (statusLaluLintas.tersedia) {
    laluLintas = await ambilLaluLintasTerparah({
      titik: sampleAlongRoute(rute.geometry, SAMPLING.titikLaluLintas),
      signal,
    });
  }

  // Tahap tiga, kualitas udara. Boleh gagal juga, tetapi jarang, karena
  // Open-Meteo tidak memerlukan kunci sama sekali.
  saatTahap('udara');
  let udara = null;
  try {
    const titikUdara = sampleAlongRoute(rute.geometry, SAMPLING.titikUdara);
    const data = await ambilKualitasUdara({
      titik: titikUdara,
      metrikTambahan: metrikTambahanUntuk(profil),
      signal,
    });
    udara = { ...ringkasUdara(data.results), metrics: data.metrics, results: data.results };
  } catch {
    udara = null;
  }

  // Tahap empat, kamera. Katalog kamera backend masih kosong, jadi tahap
  // ini hampir pasti tidak menemukan apa apa untuk sekarang. Itu bukan
  // kegagalan, hanya berarti tidak ada bukti visual yang bisa ditampilkan.
  //
  // Perlu dicatat, analisis citra TIDAK dikerjakan di sini. Tool
  // analyze_image memakai Gemini dan kuncinya hanya ada di backend, jadi
  // variabel analisis dibiarkan null dan previewScorer memperlakukan
  // kondisi jalan dengan nilai netral atau dengan data TomTom saja.
  saatTahap('cctv');
  let visual = null;
  try {
    const tengah = midpointOf(rute.geometry);
    if (tengah) {
      const kamera = await ambilKameraTerdekat({ titik: tengah, batas: 1, signal });
      if (kamera.length > 0) {
        visual = { kamera: kamera[0], analisis: null };
      }
    }
  } catch {
    visual = null;
  }

  // Tahap lima, penilaian.
  saatTahap('skor');
  const bobot = bobotUntuk(sensitifKesehatan);
  const score = calculateRouteScore({
    durationS: rute.durationS,
    trafficData: laluLintas,
    aqiData: { pm2_5: udara?.pm2_5 ?? undefined, us_aqi: udara?.us_aqi ?? undefined },
    visualAnalysis: null,
    weights: bobot,
  });

  // Rute pilihan lain dinilai dengan data lingkungan yang sama. Ini
  // penyederhanaan yang disengaja, karena mengambil data udara dan lalu
  // lintas terpisah untuk setiap pilihan akan melipatgandakan jumlah
  // panggilan tanpa mengubah banyak hasilnya di dalam satu kota. Agen di
  // backend nanti bisa melakukannya dengan lebih cermat.
  const alternatives = routes.slice(1).map((r) => {
    const s = calculateRouteScore({
      durationS: r.durationS,
      trafficData: laluLintas,
      aqiData: { pm2_5: udara?.pm2_5 ?? undefined, us_aqi: udara?.us_aqi ?? undefined },
      visualAnalysis: null,
      weights: bobot,
    });
    return {
      distanceM: r.distanceM,
      durationS: r.durationS,
      totalScore: s.totalScore,
      label: s.label,
    };
  });

  return {
    route: rute,
    score,
    air: udara,
    visual,
    alternatives,
    reasoning: [],
    statusLaluLintas,
    asal,
    tujuan,
    profil,
  };
}
