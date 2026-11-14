/*
   Perakit kerangka tampilan utama JakSafe.
   Mendukung sidebar yang dapat dilipat/dibuka (collapsible sidebar) ala Google Maps.
*/

import { spriteIkon } from './icons.js';
import { templateTopbar } from './templates/topbar.js';
import { templateSearchView } from './templates/searchView.js';
import { templateProgressView } from './templates/progressView.js';
import { templateResultView } from './templates/resultView.js';
import { templateErrorView } from './templates/errorView.js';
import { templateStage } from './templates/stageView.js';
import { templateLoginModal, templateUserMenu, templateAccountDialogs } from './templates/loginModal.js';
import { ikon } from './icons.js';

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

  <div class="workspace" id="workspace" data-sidebar="open">
    <aside class="sidepanel" id="sidePanel" aria-label="Panel navigasi rute">
      <div class="sidepanel__body scroll-y" id="panelBody">
        ${templateSearchView()}
        ${templateProgressView()}
        ${templateResultView()}
        ${templateErrorView()}
      </div>

      <!-- Tab Lipat/Buka Panel Samping ala Google Maps -->
      <button type="button" class="sidepanel__tab" id="btnSidebarTab"
              aria-label="Sembunyikan atau tampilkan panel rute"
              title="Sembunyikan / Tampilkan Panel">
        ${ikon('i-chev', 16, 'sidepanel__tabicon')}
      </button>
    </aside>

    ${templateStage()}
  </div>
</div>

${templateLoginModal()}
${templateUserMenu()}
${templateAccountDialogs()}

<div class="toast" id="toast" hidden><span id="toastText"></span></div>
`;
}
