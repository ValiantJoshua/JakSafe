/*
   Perakit kerangka tampilan.

   Berkas ini yang mengisi div#app pada app.html. Urutan pemasangannya
   mengikuti urutan dokumen yang masuk akal, yaitu sprite ikon lebih dulu
   karena seluruh bagian lain memakainya lewat tag use, baru bilah atas,
   ruang kerja, dan terakhir lapisan mengambang seperti modal dan toast.

   Satu rakitan menghasilkan satu dokumen utuh. Setelah fungsi ini selesai,
   semua id yang dicari pengendali sudah pasti ada di DOM, sehingga
   pengendali tidak perlu menunggu atau memeriksa keberadaannya berulang
   kali. Inilah alasan main.js memanggil rakit lebih dulu, baru memasang
   pengendali.
*/

import { spriteIkon } from './icons.js';
import { templateTopbar } from './templates/topbar.js';
import { templateSearchView } from './templates/searchView.js';
import { templateProgressView } from './templates/progressView.js';
import { templateResultView } from './templates/resultView.js';
import { templateErrorView } from './templates/errorView.js';
import { templateStage } from './templates/stageView.js';
import { templateLoginModal, templateUserMenu } from './templates/loginModal.js';

/**
 * Membangun seluruh kerangka tampilan ke dalam elemen induk.
 *
 * @param {HTMLElement} induk  biasanya div#app
 */
export function rakitTampilan(induk) {
  induk.innerHTML = `
${spriteIkon()}

<div class="app">
  ${templateTopbar()}

  <div class="workspace">
    <aside class="sidepanel">
      <div class="sidepanel__body scroll-y" id="panelBody">
        ${templateSearchView()}
        ${templateProgressView()}
        ${templateResultView()}
        ${templateErrorView()}
      </div>
    </aside>

    ${templateStage()}
  </div>
</div>

${templateLoginModal()}
${templateUserMenu()}

<!-- Pemberitahuan singkat yang muncul lalu hilang sendiri. -->
<div class="toast" id="toast" hidden><span id="toastText"></span></div>
`;
}
