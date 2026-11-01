/*
   Pengendali layar hasil.

   Berkas ini mengubah satu objek hasil menjadi tampilan. Aturan yang
   dipegang ketat di sini, tidak ada nilai yang dikarang. Kalau sebuah
   data tidak ada di objek hasil, yang muncul adalah keterangan bahwa
   datanya memang tidak tersedia, bukan angka tebakan atau nilai contoh.

   Objek hasil bisa berasal dari dua tempat, dari agen backend atau dari
   perhitungan pratinjau di frontend, tetapi bentuknya sudah diseragamkan
   di domain/navigationService.js. Jadi berkas ini tidak perlu tahu
   asalnya kecuali untuk satu hal, yaitu menuliskan lencana sumber di
   pojok kartu skor.
*/

import { $, setText, show, countTo, afterPaint } from '../../utils/dom.js';
import {
  formatJarak, formatDurasi, formatAngka, formatLama, formatJam,
  labelKondisiJalan, labelGenangan, KOSONG,
} from '../../utils/format.js';
import { pitaDariSkor, kunciDariLabel, kalimatArti, susunAlasan } from '../../domain/scoreLabels.js';
import { PM25_BANDS, SUMBER_HASIL, DEFAULT_WEIGHTS } from '../../config/constants.js';
import { urlBingkaiKamera } from '../../api/cctvApi.js';
import { ikon } from '../icons.js';
import { getState, setState } from '../../state/appState.js';
import { toast } from '../toast.js';

/** Menuliskan lencana sumber hasil di kartu skor. */
function gambarSumber(sumber) {
  const lencana = $('#sumberBadge');
  if (!lencana) return;

  const dariAgen = sumber === SUMBER_HASIL.AGEN;
  lencana.dataset.sumber = dariAgen ? 'agen' : 'pratinjau';
  setText($('#sumberBadgeTeks'), dariAgen
    ? 'Dinilai oleh agen JakSafe'
    : 'Pratinjau, endpoint agen belum aktif');
  lencana.title = dariAgen
    ? 'Hasil berasal dari POST /api/navigate di backend.'
    : 'POST /api/navigate belum tersedia, jadi frontend merangkai hasil dari endpoint data dan menghitung skor dengan salinan rumus backend.';
}

/** Menggambar cincin skor, label, dan kalimat artinya. */
function gambarSkor(score) {
  const kunci = kunciDariLabel(score.label) || pitaDariSkor(score.totalScore).key;

  const kartu = $('#scoreCard');
  if (kartu) kartu.dataset.status = kunci;

  // Nilai cincin dipasang setelah bingkai berikutnya supaya animasi
  // tumbuhnya terlihat, bukan langsung melompat ke nilai akhir.
  afterPaint(() => {
    const gauge = $('#gauge');
    if (gauge) gauge.style.setProperty('--val', String(score.totalScore));
  });

  countTo($('#sScore'), score.totalScore);
  setText($('#sLabelText'), score.label);
  setText($('#sArti'), kalimatArti(kunci));

  const ikonLabel = $('#sLabelIcon');
  if (ikonLabel) {
    ikonLabel.innerHTML = kunci === 'aman' ? ikon('i-check', 15)
      : kunci === 'hindari' ? ikon('i-alert', 15)
        : ikon('i-alert', 15);
  }
}

/** Menggambar satu bar rincian penilaian. */
function gambarBar(idBar, idBobot, idMentah, bagian, teksMentah) {
  const bar = $(idBar);
  if (bar) {
    // Lebar dipasang setelah bingkai berikutnya, alasannya sama dengan
    // cincin skor di atas.
    afterPaint(() => { bar.style.width = `${Math.max(0, Math.min(100, bagian.score))}%`; });
    bar.dataset.status = pitaDariSkor(bagian.score).key;
  }
  // Bobot dibaca dari balasan, bukan dari tetapan, karena bobot polusi
  // bisa naik saat profil kesehatan menyala.
  setText($(idBobot), `${Math.round((bagian.weight ?? 0) * 100)}%`);
  setText($(idMentah), teksMentah);
}

/** Menggambar seluruh kartu Rincian Penilaian. */
function gambarRincian(score) {
  const { time, aqi, condition } = score.breakdown;

  gambarBar('#bTime', '#bTimeW', '#bTimeRaw', time,
    `${time.effectiveDurationMin} menit`);

  const pm = Number(aqi.pm2_5);
  gambarBar('#bPoll', '#bPollW', '#bPollRaw', aqi,
    Number.isFinite(pm) ? `PM2.5 ${formatAngka(pm)}`
      : Number.isFinite(Number(aqi.us_aqi)) ? `AQI ${Math.round(aqi.us_aqi)}`
        : 'Data udara tidak ada');

  const teksKondisi = condition.roadClosure ? 'Jalan tertutup'
    : condition.floodDetected ? 'Ada genangan'
      : labelKondisiJalan(condition.traffic);
  gambarBar('#bRoad', '#bRoadW', '#bRoadRaw', condition, teksKondisi);

  // Keterangan sumber angka waktu. Membedakan waktu dasar OSRM dari waktu
  // yang sudah dikalibrasi TomTom penting karena selisihnya bisa besar
  // pada jam sibuk, dan pengguna berhak tahu angka mana yang dia lihat.
  //
  // Keterangan bobot juga ditulis di sini saat profil kesehatan menyala.
  // Alasannya, bobot polusi memang dinaikkan menjadi nol koma lima, tetapi
  // ketiga bobot lalu dinormalkan supaya jumlahnya tepat seratus persen,
  // sehingga angka yang tampil di layar menjadi sekitar empat puluh tiga
  // persen. Tanpa penjelasan ini, selisih antara yang dijanjikan dan yang
  // terlihat akan terkesan seperti kesalahan hitung.
  const catatan = $('#sumberWaktu');
  if (catatan) {
    const baris = [];
    if (time.trafficSource === 'TomTom Live') {
      baris.push(`Waktu tempuh dikalibrasi dengan data lalu lintas TomTom. Waktu dasar ${time.baseDurationMin} menit, keterlambatan ${time.delayPercent} persen.`);
    } else {
      baris.push('Waktu tempuh memakai perkiraan dasar OSRM. Data lalu lintas TomTom belum tersedia, jadi angkanya belum memperhitungkan kemacetan saat ini.');
    }
    if (Number(aqi.weight) > DEFAULT_WEIGHTS.time) {
      baris.push('Profil kesehatan aktif, jadi bobot polusi dinaikkan dan menjadi bobot terbesar. Ketiga bobot lalu dinormalkan supaya jumlahnya tepat seratus persen.');
    }
    catatan.textContent = baris.join(' ');
  }
}

/** Menggambar kartu Kualitas Udara. */
function gambarUdara(air, score) {
  const kartu = $('#aqiCard');
  const catatan = $('#aqiNote');
  const lencana = $('#aqiBadge');

  const pm = Number(air?.pm2_5 ?? score?.breakdown?.aqi?.pm2_5);
  const usAqi = Number(air?.us_aqi ?? score?.breakdown?.aqi?.us_aqi);

  if (!Number.isFinite(pm) && !Number.isFinite(usAqi)) {
    show(kartu, true);
    setText($('#aqiValue'), KOSONG);
    if (lencana) { lencana.textContent = 'Tidak ada data'; lencana.className = 'badge'; }
    if (catatan) catatan.textContent = 'Data kualitas udara tidak dapat diambil untuk rute ini. Nilainya tidak ditebak, jadi penilaian polusi memakai nilai netral.';
    return;
  }

  show(kartu, true);

  if (Number.isFinite(pm)) {
    countTo($('#aqiValue'), Math.round(pm));
    // Penanda digeser mengikuti nilai, dipotong di angka dua ratus supaya
    // nilai ekstrem tidak mendorong penanda keluar dari batang skala.
    const persen = Math.max(0, Math.min(100, (pm / 200) * 100));
    afterPaint(() => {
      const penanda = $('#aqiMarker');
      if (penanda) penanda.style.left = `${persen}%`;
    });
  } else {
    setText($('#aqiValue'), KOSONG);
  }

  const pita = PM25_BANDS.find((b) => pm <= b.sampai) || PM25_BANDS[PM25_BANDS.length - 1];
  if (lencana) {
    lencana.textContent = pita.nama;
    lencana.className = `badge badge--${pita.kelas}`;
  }

  if (catatan) {
    const bagian = [];
    if (Number.isFinite(usAqi)) bagian.push(`Indeks AQI Amerika ${Math.round(usAqi)}`);
    const uv = Number(air?.uv_index);
    if (Number.isFinite(uv)) bagian.push(`indeks ultraviolet ${formatAngka(uv)}`);
    const waktu = air?.titikTerburuk?.time;
    if (waktu) bagian.push(`data pukul ${formatJam(waktu)}`);
    bagian.push('angka yang dipakai adalah titik terburuk di sepanjang rute, bukan rata rata');
    catatan.textContent = `${bagian.join(', ')}.`;
  }
}

/** Menggambar kartu Bukti Kondisi Jalan. */
function gambarKamera(visual) {
  const badan = $('#cctvBody');
  if (!badan) return;

  // Keadaan tanpa kamera. Ini keadaan yang paling sering terjadi sekarang
  // karena katalog kamera di backend masih kosong. Ditampilkan dengan
  // nada netral, bukan sebagai kegagalan.
  if (!visual?.kamera) {
    badan.innerHTML = `
      <div class="nocam">
        <span class="nocam__icon">${ikon('i-camera-off', 26)}</span>
        <p class="nocam__title">Tidak ada kamera di sekitar rute ini</p>
        <p class="nocam__text">Katalog kamera di backend belum berisi titik yang dekat
          dengan rute ini, jadi tidak ada bukti visual yang bisa ditampilkan.
          Penilaian kondisi jalan memakai data lalu lintas dan nilai netral,
          bukan tebakan.</p>
      </div>`;
    return;
  }

  const k = visual.kamera;
  const jarak = Number.isFinite(k.jarakM) ? `${k.jarakM} m dari rute` : 'jarak tidak diketahui';

  badan.innerHTML = `
    <figure class="cctv">
      <div class="cctv__frame">
        <img class="cctv__img" src="${urlBingkaiKamera(k.id)}" alt="Cuplikan kamera ${k.nama}"
             loading="lazy"
             onerror="this.closest('.cctv').dataset.gagal='1'">
        <span class="cctv__gagal">${ikon('i-camera-off', 22)} Gambar kamera tidak dapat diambil</span>
      </div>
      <figcaption class="cctv__cap">
        <span class="cctv__name">${k.nama}</span>
        <span class="cctv__meta">${jarak}${k.provider ? ` · ${k.provider}` : ''}</span>
        ${k.license ? `<span class="cctv__lisensi">${k.license}</span>` : ''}
      </figcaption>
    </figure>
    ${gambarAnalisis(visual.analisis)}`;
}

/** Bagian hasil analisis citra, kalau ada. */
function gambarAnalisis(analisis) {
  // Analisis citra memakai Gemini dan kuncinya hanya ada di backend, jadi
  // pada jalur pratinjau bagian ini memang selalu kosong. Keterangan di
  // bawah menjelaskan itu apa adanya supaya tidak terkesan fiturnya rusak.
  if (!analisis) {
    return `
      <p class="note" style="margin-top:var(--s4)">
        ${ikon('i-info', 16)}
        <span>Analisis isi gambar dikerjakan di backend memakai model penglihatan.
        Hasilnya muncul di sini setelah endpoint agen aktif.</span>
      </p>`;
  }

  const baris = [];
  if (analisis.genangan_air) baris.push(labelGenangan(analisis.tingkat_genangan));
  if (analisis.kondisi_jalan) baris.push(labelKondisiJalan(analisis.kondisi_jalan));
  if (Number.isFinite(analisis.confidence)) {
    const rendah = analisis.confidence < 0.4;
    baris.push(`Keyakinan analisis ${Math.round(analisis.confidence * 100)} persen${rendah ? ', dinilai lebih hati hati karena di bawah 40 persen' : ''}`);
  }

  return `
    <div class="analisis">
      <p class="analisis__judul">${ikon('i-spark', 16)} Pembacaan gambar</p>
      <ul class="analisis__list">${baris.map((b) => `<li>${b}</li>`).join('')}</ul>
    </div>`;
}

/**
 * Membuat jalur API lebih enak dibaca di panel jejak.
 *
 * URLSearchParams menyandikan koma menjadi %2C dan titik koma menjadi %3B,
 * sehingga parameter coords terlihat seperti deretan kode yang susah
 * dibaca. Penyandian itu tetap dibiarkan saat permintaan dikirim karena
 * memang bagian dari aturan URL, yang diubah hanya tampilannya.
 * decodeURIComponent dibungkus try catch karena akan melempar galat bila
 * menemui tanda persen yang tidak membentuk pasangan heksadesimal.
 *
 * @param {string} jalur
 * @returns {string}
 */
function bacaJalur(jalur) {
  try {
    return decodeURIComponent(jalur);
  } catch {
    return jalur;
  }
}

/** Menggambar isi panel jejak proses. */
function gambarJejak(hasil) {
  const panel = $('#logPanel');
  if (!panel) return;

  setText($('#logTotal'), formatLama(hasil.lamaMs));

  const langkahAgen = (hasil.reasoning || []).map((r, i) => `
    <li class="logitem">
      <span class="logitem__no">${i + 1}</span>
      <span class="logitem__body">
        <span class="logitem__judul">${r.action || r.thought || 'Langkah agen'}</span>
        <span class="logitem__teks">${r.observation || ''}</span>
      </span>
      <span class="logitem__lama">${formatLama(r.durationMs)}</span>
    </li>`).join('');

  const panggilan = (hasil.jejak || []).map((j, i) => `
    <li class="logitem" data-gagal="${j.berhasil ? '0' : '1'}">
      <span class="logitem__no">${i + 1}</span>
      <span class="logitem__body">
        <span class="logitem__judul">${bacaJalur(j.jalur)}</span>
        <span class="logitem__teks">${j.berhasil ? `Berhasil, status ${j.status}` : (j.pesan || `Gagal, status ${j.status}`)}</span>
      </span>
      <span class="logitem__lama">${formatLama(j.lamaMs)}</span>
    </li>`).join('');

  panel.innerHTML = `
    ${langkahAgen ? `<p class="logjudul">Penalaran agen</p><ul class="loglist">${langkahAgen}</ul>` : ''}
    <p class="logjudul">Panggilan ke backend</p>
    <ul class="loglist">${panggilan || '<li class="logitem"><span class="logitem__body">Tidak ada panggilan tercatat.</span></li>'}</ul>
    <p class="note">${ikon('i-info', 15)}
      <span>Daftar di atas adalah permintaan HTTP yang benar benar terjadi beserta
      lamanya, diukur dari peramban.</span></p>`;
}

/**
 * Menggambar seluruh layar hasil dari satu objek hasil navigasi.
 * @param {object} hasil
 */
export function gambarHasil(hasil) {
  gambarSumber(hasil.sumber);

  setText($('#sRouteFrom'), hasil.asal?.nama || 'Titik awal');
  setText($('#sRouteTo'), hasil.tujuan?.nama || 'Tujuan');

  setText($('#sDistance'), formatJarak(hasil.route?.distanceM));
  setText($('#sDuration'), formatDurasi(hasil.route?.durationS));

  gambarSkor(hasil.score);
  setText($('#sReason'), susunAlasan(hasil.score));
  gambarRincian(hasil.score);
  gambarUdara(hasil.air, hasil.score);
  gambarKamera(hasil.visual);
  gambarJejak(hasil);

  // Tombol simpan dikembalikan ke keadaan awal tiap hasil baru.
  setText($('#saveLabel'), 'Simpan rute');
  $('#btnSaveRoute')?.removeAttribute('data-tersimpan');
}

/**
 * Memasang perilaku tombol di layar hasil. Dipanggil sekali dari main.js.
 */
export function pasangPengendaliHasil() {
  // Panel jejak proses dibuka dan ditutup. Memakai aria-expanded supaya
  // pembaca layar tahu keadaannya, bukan hanya terlihat dari panah.
  const tombolLog = $('#btnLog');
  tombolLog?.addEventListener('click', () => {
    const terbuka = tombolLog.getAttribute('aria-expanded') === 'true';
    tombolLog.setAttribute('aria-expanded', String(!terbuka));
    show($('#logPanel'), !terbuka);
  });

  $('#btnSaveRoute')?.addEventListener('click', () => {
    const { masuk, hasil, ruteTersimpan } = getState();

    if (!masuk) {
      toast('Masuk dulu untuk menyimpan rute.');
      $('#loginModal') && show($('#loginModal'), true);
      return;
    }
    if (!hasil) return;

    const tombol = $('#btnSaveRoute');
    if (tombol?.dataset.tersimpan === '1') {
      toast('Rute ini sudah tersimpan.');
      return;
    }

    setState({
      ruteTersimpan: [...ruteTersimpan, {
        asal: hasil.asal?.nama || 'Titik awal',
        tujuan: hasil.tujuan?.nama || 'Tujuan',
        skor: hasil.score.totalScore,
        label: hasil.score.label,
        kunciStatus: kunciDariLabel(hasil.score.label),
      }],
    });

    if (tombol) tombol.dataset.tersimpan = '1';
    setText($('#saveLabel'), 'Tersimpan');
    toast('Rute disimpan untuk sesi ini.');
  });
}
