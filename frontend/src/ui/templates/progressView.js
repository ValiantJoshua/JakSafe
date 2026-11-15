/*
   Layar proses saat agen atau endpoint data sedang menganalisis rute.

   Menggunakan Shimmer Skeleton (mencerminkan tata letak hasil rute dan kartu
   skor) dipadukan dengan kapsul status translusen ringkas (§1, §7, §12, §16
   Apple Design): langsung memberi umpan balik saat tombol ditekan tanpa daftar
   langkah statis yang terasa membeku, dengan tombol Cancel yang selalu siap.
*/

import { TAHAP } from '../../domain/navigationService.js';

const TOTAL_TAHAP = Math.max(1, TAHAP.length);

/**
 * @returns {string} potongan HTML layar proses
 */
export function templateProgressView() {
  const pipsHtml = Array.from({ length: TOTAL_TAHAP }, (_, idx) => (
    `<span class="progresspip${idx === 0 ? ' is-active' : ''}" data-pip="${idx}"></span>`
  )).join('');

  return `
<section id="viewProgress" hidden aria-busy="true" aria-live="polite">
  <div class="progresswrap slide-in">
    <div class="progresspill">
      <div class="progresspill__top">
        <span class="progresspill__badge" aria-hidden="true">
          <span class="progresspill__dot"></span>
        </span>
        <div class="progresspill__copy">
          <h2 class="progresspill__title">Analyzing Route</h2>
          <p class="progresspill__sub" id="progressSub">Calculating road corridors…</p>
        </div>
        <!-- Tombol ini membatalkan permintaan aktif lewat AbortController (§3 Interruptibility) -->
        <button type="button" class="progresspill__cancel press" id="btnCancel" aria-label="Cancel route search">
          Cancel
        </button>
      </div>
      <div class="progresspill__pips" id="progressPips" role="progressbar" aria-valuemin="1" aria-valuemax="${TOTAL_TAHAP}" aria-valuenow="1">
        ${pipsHtml}
      </div>
    </div>

    <!-- Skeleton: Route Options Card -->
    <div class="skelcard skelcard--routes" aria-hidden="true">
      <div class="skelcard__head">
        <span class="skeleton skel--label"></span>
      </div>
      <div class="skelroute skelroute--primary">
        <span class="skeleton skel--num"></span>
        <div class="skelroute__body">
          <div class="skelroute__top">
            <span class="skeleton skel--dur"></span>
            <span class="skeleton skel--eta"></span>
            <span class="skeleton skel--pill"></span>
          </div>
          <span class="skeleton skel--via"></span>
          <span class="skeleton skel--meta"></span>
        </div>
      </div>
      <div class="skelroute">
        <span class="skeleton skel--num"></span>
        <div class="skelroute__body">
          <div class="skelroute__top">
            <span class="skeleton skel--dur-sm"></span>
            <span class="skeleton skel--eta"></span>
            <span class="skeleton skel--pill-sm"></span>
          </div>
          <span class="skeleton skel--via-sm"></span>
          <span class="skeleton skel--meta-sm"></span>
        </div>
      </div>
    </div>

    <!-- Skeleton: Score & Metrics Card -->
    <div class="skelcard skelcard--score" aria-hidden="true">
      <div class="skelscore__ringwrap">
        <span class="skeleton skel--ring"></span>
      </div>
      <span class="skeleton skel--badge"></span>
      <span class="skeleton skel--line-md"></span>
      <div class="skelmetrics">
        <div class="skelmetric">
          <span class="skeleton skel--m-lbl"></span>
          <span class="skeleton skel--m-val"></span>
        </div>
        <div class="skelmetric">
          <span class="skeleton skel--m-lbl"></span>
          <span class="skeleton skel--m-val"></span>
        </div>
      </div>
    </div>
  </div>
</section>`;
}
