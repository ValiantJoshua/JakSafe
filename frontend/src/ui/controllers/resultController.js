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
  labelKondisiJalan, labelGenangan, formatObservasi, KOSONG,
} from '../../utils/format.js';
import { pitaDariSkor, kunciDariLabel, kalimatArti, susunAlasan } from '../../domain/scoreLabels.js';
import { calculateRouteScore } from '../../domain/previewScorer.js';
import { PM25_BANDS, SUMBER_HASIL, DEFAULT_WEIGHTS, PROFILES } from '../../config/constants.js';
import { urlBingkaiKamera } from '../../api/cctvApi.js';
import { simpanRute } from '../../api/authApi.js';
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
      const jmlSampel = Number(time.sampleCount) || 1;
      const maxDelay = Number(time.maxDelayPercent);
      const infoSegmen = jmlSampel > 1 ? ` pada ${jmlSampel} segmen koridor rute` : '';
      const infoPuncak = Number.isFinite(maxDelay) && maxDelay > time.delayPercent
        ? ` (titik terpadat +${maxDelay}%)`
        : '';
      baris.push(`Waktu tempuh dikalibrasi dengan sensor lalu lintas TomTom${infoSegmen}. Waktu dasar ${time.baseDurationMin} menit, keterlambatan efektif +${time.delayPercent}%${infoPuncak}.`);
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
    const waktu = air?.titikTerburuk?.time || air?.time;
    if (waktu) bagian.push(`data pukul ${formatJam(waktu)}`);
    bagian.push('angka yang dipakai adalah titik terburuk di sepanjang rute, bukan rata rata');
    catatan.textContent = `${bagian.join(', ')}.`;
  }
}

/** Menggambar kartu Bukti Kondisi Jalan. */
function gambarKamera(visual) {
  const badan = $('#cctvBody');
  if (!badan) return;

  // Mendukung bentuk kamera baik dari jalur agen (cameraId/cameraName) maupun pratinjau (kamera)
  const k = visual?.kamera || (visual?.cameraId ? {
    id: visual.cameraId,
    nama: visual.cameraName,
    jarakM: visual.distanceM ?? null,
    provider: visual.provider ?? null,
    license: visual.license ?? null,
  } : null);

  const analisis = visual?.analisis || visual?.analysis || null;

  // Keadaan tanpa kamera di sekitar rute
  if (!k) {
    badan.innerHTML = `
      <div class="nocam">
        <span class="nocam__icon">${ikon('i-camera-off', 26)}</span>
        <p class="nocam__title">Tidak ada kamera di sekitar rute ini</p>
        <p class="nocam__text">Belum ada kamera aktif yang mencakup segmen rute ini.
          Penilaian kondisi jalan menggunakan sensor lalu lintas TomTom dan nilai netral,
          bukan tebakan.</p>
      </div>`;
    return;
  }

  const jarak = Number.isFinite(k.jarakM) ? `${k.jarakM} m dari rute` : 'di sekitar rute';

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
    ${gambarAnalisis(analisis)}`;
}

/** Bagian hasil analisis citra, kalau ada. */
function gambarAnalisis(analisis) {
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
  if (analisis.alasan) {
    baris.push(`<em>Catatan visual:</em> "${analisis.alasan}"`);
  }

  return `
    <div class="analisis">
      <p class="analisis__judul">${ikon('i-spark', 16)} Pembacaan AI Vision</p>
      <ul class="analisis__list">${baris.map((b) => `<li>${b}</li>`).join('')}</ul>
    </div>`;
}

/**
 * Membuat jalur API lebih enak dibaca di panel jejak.
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
        <span class="logitem__teks">${formatObservasi(r.observation)}</span>
      </span>
      <span class="logitem__lama">${formatLama(r.durationMs || 0)}</span>
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
      <span>Daftar di atas adalah permintaan HTTP dan jejak reasoning agen yang benar-benar terjadi beserta
      lamanya, diukur dari peramban.</span></p>`;
}

/**
 * Mengubah markdown sederhana dari balasan agen AI menjadi elemen HTML bersih & aman.
 * @param {string} md
 * @returns {string}
 */
function renderMarkdownAman(md) {
  if (!md) return '';
  let html = String(md)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headings: ### Judul atau ## Judul
  html = html.replace(/^###?\s+(.+)$/gm, '<h4 class="reason__subheading">$1</h4>');
  // Bold: **teks**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *teks*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Garis pemisah: ---
  html = html.replace(/^---$/gm, '<hr class="reason__divider">');
  // List items: * atau -
  html = html.replace(/^\s*[\*\-]\s+(.+)$/gm, '<li class="reason__item">$1</li>');
  html = html.replace(/(<li class="reason__item">.*?<\/li>\s*)+/gs, '<ul class="reason__list">$&</ul>');
  // Paragraf ganda
  html = html.replace(/\n\n+/g, '</p><p class="reason__paragraph">');
  // Line break tunggal
  html = html.replace(/\n/g, '<br>');

  return `<p class="reason__paragraph">${html}</p>`;
}

/**
 * Menghitung jam perkiraan tiba (ETA) berdasarkan durasi efektif menit dari waktu sekarang.
 * @param {number} durasiMenit
 * @returns {string} contoh "16.32"
 */
function formatJamTiba(durasiMenit) {
  const mnt = Number.isFinite(durasiMenit) && durasiMenit > 0 ? durasiMenit : 1;
  const tiba = new Date(Date.now() + mnt * 60000);
  const hh = String(tiba.getHours()).padStart(2, '0');
  const mm = String(tiba.getMinutes()).padStart(2, '0');
  return `${hh}.${mm}`;
}

/**
 * Menyusun daftar seluruh kandidat rute (Rute 1, 2, 3...) dengan struktur seragam
 * sehingga pengguna dapat mengklik dan berpindah rute secara interaktif.
 *
 * @param {object} hasil
 * @returns {Array<object>}
 */
export function susunDaftarPilihanRute(hasil) {
  if (Array.isArray(hasil?.semuaPilihan) && hasil.semuaPilihan.length > 0) {
    return hasil.semuaPilihan;
  }

  const utama = {
    index: 0,
    route: {
      distanceM: hasil.route?.distanceM ?? 0,
      durationS: hasil.route?.durationS ?? 0,
      summary: hasil.route?.summary || 'Jalur Utama Rekomendasi',
      geometry: hasil.route?.geometry || [],
    },
    score: hasil.score,
    air: hasil.air || null,
    visual: hasil.visual || null,
    reason: hasil.reason || null,
  };

  const alts = (Array.isArray(hasil.alternatives) ? hasil.alternatives : []).map((alt, i) => {
    const fallbackScore = alt.score?.breakdown
      ? alt.score
      : calculateRouteScore({
          durationS: alt.durationS,
          trafficData: null,
          aqiData: {
            pm2_5: alt.air?.pm2_5 ?? hasil.air?.pm2_5,
            us_aqi: alt.air?.us_aqi ?? hasil.air?.us_aqi,
          },
          visualAnalysis: alt.visual?.analysis || null,
          weights: DEFAULT_WEIGHTS,
        });

    return {
      index: i + 1,
      route: {
        distanceM: alt.distanceM ?? 0,
        durationS: alt.durationS ?? 0,
        summary: alt.summary || `Jalur Alternatif ${i + 2}`,
        geometry: alt.geometry || [],
      },
      score: fallbackScore,
      air: alt.air || hasil.air || null,
      visual: alt.visual || null,
      reason: null,
    };
  });

  const semua = [utama, ...alts];

  // Tandai rute dengan skor risiko terendah sebagai "TERBAIK" (BEST)
  let minScore = Infinity;
  let bestIdx = 0;
  semua.forEach((opt, idx) => {
    const s = Number(opt.score?.totalScore ?? 100);
    if (s < minScore) {
      minScore = s;
      bestIdx = idx;
    }
  });
  semua.forEach((opt, idx) => {
    opt.isBest = idx === bestIdx;
  });

  return semua;
}

/**
 * Menggambar daftar pemilih rute interaktif (1, 2, 3...) ala Waze / Google Maps.
 * @param {Array<object>} daftarPilihan
 * @param {number} indeksAktif
 */
function gambarPilihanRute(daftarPilihan, indeksAktif = 0) {
  const wadah = $('#routeOptionsList');
  const subJudul = $('#routeSelectorSub');
  if (!wadah) return;

  if (subJudul) {
    subJudul.textContent = daftarPilihan.length > 1
      ? `${daftarPilihan.length} opsi rute · Klik untuk membandingkan`
      : '1 rute optimal ditemukan';
  }

  wadah.innerHTML = daftarPilihan.map((opt, idx) => {
    const aktif = idx === indeksAktif;
    const effMin = opt.score?.breakdown?.time?.effectiveDurationMin
      ?? Math.max(1, Math.round((opt.route.durationS || 0) / 60));
    const durTeks = formatDurasi(effMin * 60);
    const etaTeks = formatJamTiba(effMin);
    const jarakTeks = formatJarak(opt.route.distanceM);
    const koridor = opt.route.summary || (idx === 0 ? 'Jalur Utama' : `Jalur Alternatif ${idx + 1}`);
    const kunciStatus = kunciDariLabel(opt.score?.label) || pitaDariSkor(opt.score?.totalScore ?? 20).key;
    const delayPct = Number(opt.score?.breakdown?.time?.delayPercent) || 0;
    const infoTraffic = delayPct >= 40
      ? `Padat (+${delayPct}%)`
      : delayPct >= 15
        ? `Sedang (+${delayPct}%)`
        : 'Arus lancar';
    const pm = Number(opt.air?.pm2_5 ?? opt.score?.breakdown?.aqi?.pm2_5);
    const infoAqi = Number.isFinite(pm) ? `PM2.5 ${formatAngka(pm)}` : '';

    return `
      <button type="button" class="routeopt press" role="option"
              data-route-index="${idx}"
              data-active="${aktif ? '1' : '0'}"
              aria-selected="${aktif}">
        <span class="routeopt__num">${idx + 1}</span>
        <div class="routeopt__body">
          <div class="routeopt__top">
            <span class="routeopt__dur">${durTeks}</span>
            <span class="routeopt__eta">Tiba ${etaTeks}</span>
            <span class="routeopt__badges">
              ${opt.isBest ? '<span class="routeopt__best">TERBAIK</span>' : ''}
              <span class="routeopt__score" data-status="${kunciStatus}">
                Skor ${opt.score?.totalScore ?? '-'} · ${opt.score?.label || 'AMAN'}
              </span>
            </span>
          </div>
          <p class="routeopt__via">${koridor}</p>
          <div class="routeopt__meta">
            <span class="routeopt__dist">${jarakTeks}</span>
            <span class="routeopt__sep">·</span>
            <span>${infoTraffic}</span>
            ${infoAqi ? `<span class="routeopt__sep">·</span><span>${infoAqi}</span>` : ''}
          </div>
        </div>
      </button>`;
  }).join('');
}

/**
 * Memilih salah satu rute kandidat berdasarkan indeks (0, 1, 2...),
 * memperbarui kartu skor/detail di sidebar serta menyorot rute terpilih di peta 3D.
 *
 * @param {number} index
 */
export function pilihRuteByIndex(index) {
  const keadaan = getState();
  const hasilSekarang = keadaan.hasil;
  if (!hasilSekarang) return;

  const semuaPilihan = susunDaftarPilihanRute(hasilSekarang);
  const target = semuaPilihan[index];
  if (!target) return;

  const hasilBaru = {
    ...hasilSekarang,
    semuaPilihan,
    indeksRuteAktif: index,
    hanyaGantiPilihan: true,
    route: target.route,
    score: target.score,
    air: target.air,
    visual: target.visual,
  };

  gambarHasil(hasilBaru);
  setState({ hasil: hasilBaru });
}

/**
 * Menggambar seluruh layar hasil dari satu objek hasil navigasi.
 * @param {object} hasil
 */
export function gambarHasil(hasil) {
  const semuaPilihan = susunDaftarPilihanRute(hasil);
  const indeksAktif = Number.isInteger(hasil.indeksRuteAktif) ? hasil.indeksRuteAktif : 0;
  const aktifOpt = semuaPilihan[indeksAktif] || semuaPilihan[0];

  hasil.semuaPilihan = semuaPilihan;
  hasil.indeksRuteAktif = indeksAktif;

  gambarSumber(hasil.sumber);

  const namaAsal = hasil.asal?.nama || 'Titik awal';
  const namaTujuan = hasil.tujuan?.nama || 'Tujuan';
  setText($('#sRouteFrom'), namaAsal);
  setText($('#sRouteTo'), namaTujuan);

  // Header Petunjuk Arah (dirhead)
  setText($('#sDirOriginName'), namaAsal);
  setText($('#sDirOriginArea'), hasil.asal?.area || '');
  setText($('#sDirDestName'), namaTujuan);
  setText($('#sDirDestArea'), hasil.tujuan?.area || '');

  const infoProfil = PROFILES.find((p) => p.key === (hasil.profil || getState().profil));
  setText($('#sProfileBadge'), infoProfil ? infoProfil.nama : 'Mobil');

  // Gambar daftar pemilih rute interaktif (1, 2, 3...)
  gambarPilihanRute(semuaPilihan, indeksAktif);

  // Kartu metrik & skor mengikuti rute yang sedang dipilih
  const effMin = aktifOpt.score?.breakdown?.time?.effectiveDurationMin;
  const durDetikEfektif = Number.isFinite(effMin) ? effMin * 60 : aktifOpt.route?.durationS;
  setText($('#sDistance'), formatJarak(aktifOpt.route?.distanceM));
  setText($('#sDuration'), formatDurasi(durDetikEfektif));

  gambarSkor(aktifOpt.score);

  const elReason = $('#sReason');
  if (elReason) {
    if (indeksAktif === 0 && hasil.reason) {
      elReason.innerHTML = renderMarkdownAman(hasil.reason);
    } else if (indeksAktif > 0) {
      const koridor = aktifOpt.route?.summary || `Jalur Alternatif ${indeksAktif + 1}`;
      const ringkasanAlt = `**Rute ${indeksAktif + 1} (${koridor})** memiliki skor risiko gabungan **${aktifOpt.score.totalScore}/100 (${aktifOpt.score.label})**. ${susunAlasan(aktifOpt.score)}`;
      elReason.innerHTML = renderMarkdownAman(ringkasanAlt);
    } else {
      setText(elReason, susunAlasan(aktifOpt.score));
    }
  }

  gambarRincian(aktifOpt.score);
  gambarUdara(aktifOpt.air, aktifOpt.score);
  gambarKamera(aktifOpt.visual);
  gambarJejak(hasil);

  // Tombol simpan dikembalikan ke keadaan awal tiap hasil baru.
  setText($('#saveLabel'), 'Simpan rute');
  $('#btnSaveRoute')?.removeAttribute('data-tersimpan');
}

/**
 * Memasang perilaku tombol di layar hasil. Dipanggil sekali dari main.js.
 */
export function pasangPengendaliHasil() {
  // Klik pada salah satu kartu rute di daftar Pilihan Rute (#routeOptionsList)
  $('#routeOptionsList')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-route-index]');
    if (!item) return;
    const idx = Number(item.dataset.routeIndex);
    if (Number.isInteger(idx)) {
      pilihRuteByIndex(idx);
    }
  });

  // Tombol kembali / ubah titik awal atau tujuan di header Petunjuk Arah
  $('#btnBackSearch')?.addEventListener('click', () => {
    setState({ tampilan: 'siap' });
  });

  $('#btnEditOrigin')?.addEventListener('click', () => {
    setState({ tampilan: 'siap' });
    setTimeout(() => $('#inpOrigin')?.focus(), 60);
  });

  $('#btnEditDest')?.addEventListener('click', () => {
    setState({ tampilan: 'siap' });
    setTimeout(() => $('#inpDest')?.focus(), 60);
  });

  // Tombol tukar arah (swap) langsung dari layar hasil
  $('#btnResultSwap')?.addEventListener('click', () => {
    $('#btnSwap')?.click();
    $('#btnSearch')?.click();
  });

  const tombolLog = $('#btnLog');
  tombolLog?.addEventListener('click', () => {
    const terbuka = tombolLog.getAttribute('aria-expanded') === 'true';
    tombolLog.setAttribute('aria-expanded', String(!terbuka));
    show($('#logPanel'), !terbuka);
  });

  $('#btnSaveRoute')?.addEventListener('click', async () => {
    const { masuk, token, hasil, ruteTersimpan } = getState();

    if (!masuk) {
      toast('Masuk atau daftar dulu untuk menyimpan rute.');
      $('#loginModal') && show($('#loginModal'), true);
      return;
    }
    if (!hasil) return;

    const tombol = $('#btnSaveRoute');
    if (tombol?.dataset.tersimpan === '1') {
      toast('Rute ini sudah tersimpan.');
      return;
    }

    const payload = {
      title: `${hasil.asal?.nama || 'Titik awal'} -> ${hasil.tujuan?.nama || 'Tujuan'}`,
      origin: {
        id: hasil.asal?.id || null,
        name: hasil.asal?.nama || 'Titik awal',
        area: hasil.asal?.area || '',
        lat: Number(hasil.asal?.lat) || 0,
        lon: Number(hasil.asal?.lon) || 0,
      },
      destination: {
        id: hasil.tujuan?.id || null,
        name: hasil.tujuan?.nama || 'Tujuan',
        area: hasil.tujuan?.area || '',
        lat: Number(hasil.tujuan?.lat) || 0,
        lon: Number(hasil.tujuan?.lon) || 0,
      },
      score: {
        totalScore: hasil.score.totalScore,
        label: hasil.score.label,
        color: hasil.score.color,
      },
      distanceM: hasil.distanceM || 0,
      durationS: hasil.durationS || 0,
      profile: hasil.profile || 'car',
    };

    if (tombol) tombol.style.opacity = '0.6';

    try {
      let savedObj = payload;
      if (token) {
        const res = await simpanRute(token, payload);
        if (res.route) savedObj = res.route;
      }

      setState({
        ruteTersimpan: [savedObj, ...ruteTersimpan],
      });

      if (tombol) {
        tombol.dataset.tersimpan = '1';
        tombol.style.opacity = '1';
      }
      setText($('#saveLabel'), 'Tersimpan');
      toast('Rute berhasil disimpan permanen ke database!');
    } catch (err) {
      console.error('[saveRoute]', err);
      if (tombol) tombol.style.opacity = '1';
      toast('Gagal menyimpan rute ke database.');
    }
  });
}
