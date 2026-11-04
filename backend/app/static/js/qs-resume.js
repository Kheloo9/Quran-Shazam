/* qs-resume.js — Resume / Continue Reading for Quran Shazam.
 *
 * Purpose: remember the user's last reading position (surah + ayah) in the
 * browser only, and show a "Continue reading" card on the home page.
 *
 * Privacy / project rules honoured here:
 * - All data stays in the browser's localStorage only, never server-side.
 * - Audio behaviour is untouched (this file plays no audio and hooks no
 *   audio code). The word "resume" here means READING position only.
 * - This file does NOT hook into quran.js internals and does NOT edit or
 *   depend on any other team's code. The lead calls window.qsResume
 *   explicitly (see "Lead hooks" at the bottom of this header).
 * - Every localStorage JSON parse / set is wrapped in try/catch, so corrupt
 *   data, a full store, or a browser that blocks storage can never crash
 *   the page. Bad data simply means "no position".
 * - Safe to load on BOTH / and /quran: on /quran (or anywhere else) it
 *   only self-renders if an element with id "resume-card" exists, and
 *   otherwise does nothing.
 *
 * Storage:
 *   localStorage key: 'qs-last-read'
 *   Value (JSON): { surah: <int 1..114>, ayah: <int >= 1>, at: <timestamp ms> }
 *
 * Lead hooks (the lead wires these; this file only exposes the API):
 *   - When a surah opens:              window.qsResume.savePosition(s, 1)
 *   - When the user jumps to an ayah, or navigates from a search /
 *     bookmark / note hit:             window.qsResume.savePosition(s, ayah)
 *   - The lead also wires the Reader's init to honour the deep link below.
 *
 * Deep-link contract (Reader side, NOT implemented here):
 *   This card links to "/quran?surah=N&ayah=A". The lead must wire the
 *   Reader's init to honour those query params: openSurah(N), then jump
 *   to ayah A and highlight it (same jump + 'highlight' pattern the
 *   search-hit navigation already uses).
 */
(function () {
  'use strict';

  // Storage key for the last reading position. Kept private to this file;
  // callers use the window.qsResume API, never the key directly.
  var STORAGE_KEY = 'qs-last-read';

  // Quran bounds used for validation. 114 surahs; ayah numbers are
  // positive integers (per-surah ayah counts are the Reader's job, so
  // only >= 1 is enforced here — a too-large ayah is still a valid
  // position to link to, and the Reader will clamp/handle it).
  var MIN_SURAH = 1;
  var MAX_SURAH = 114;

  /**
   * Strictly validate a stored position object.
   * Returns a clean { surah, ayah, at } copy, or null for "no position".
   * Anything else — wrong types, out-of-range surah, ayah < 1, null,
   * non-objects — is rejected, never coerced (e.g. "2" or 2.5 do not pass).
   */
  function validatePosition(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    // Number.isInteger rejects strings, floats, NaN, Infinity, booleans.
    if (!Number.isInteger(value.surah) ||
        value.surah < MIN_SURAH || value.surah > MAX_SURAH) {
      return null;
    }
    if (!Number.isInteger(value.ayah) || value.ayah < 1) {
      return null;
    }
    // 'at' is informational only (when the position was saved). A missing
    // or non-numeric timestamp must not invalidate an otherwise good
    // position, so it is normalised rather than rejected.
    var at = Number.isFinite(value.at) ? value.at : 0;
    return { surah: value.surah, ayah: value.ayah, at: at };
  }

  /**
   * Read the last reading position from localStorage.
   * @returns {{surah:number, ayah:number, at:number}|null}
   *   The validated position, or null when there is none, the stored
   *   JSON is corrupt, storage is unavailable, or validation fails.
   */
  function getPosition() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      // Storage unavailable (e.g. private mode / blocked cookies).
      return null;
    }
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Corrupt JSON: treated as "no position", never a crash.
      return null;
    }
    return validatePosition(parsed);
  }

  /**
   * Save a reading position to localStorage.
   * Invalid inputs are ignored (and any existing valid position is left
   * untouched) — a bad save call must never overwrite good data or crash.
   * @param {number} surah - integer 1..114
   * @param {number} ayah  - integer >= 1
   * @returns {boolean} true if saved, false if the inputs were invalid
   *   or storage was unavailable.
   */
  function savePosition(surah, ayah) {
    var position = validatePosition({ surah: surah, ayah: ayah, at: Date.now() });
    if (position === null) {
      return false;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    } catch (e) {
      // Storage full / unavailable: fail silently, never crash the page.
      return false;
    }
    return true;
  }

  /**
   * Clear the saved reading position from localStorage.
   * Safe to call when nothing is stored or storage is unavailable.
   * @returns {boolean} true if the clear was attempted without a storage
   *   error (including "nothing was stored"), false on storage error.
   */
  function clearPosition() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      return false;
    }
    return true;
  }

  /**
   * Hide a resume container: empty it and hide it, so no empty card
   * (and no blank space from an empty section) shows on the page.
   * Guarded against null / non-element containers.
   */
  function hideContainer(container) {
    if (!container || typeof container.innerHTML === 'undefined') {
      return;
    }
    container.innerHTML = '';
    // Both mechanisms, so the card stays hidden whether the lead's CSS
    // keys off [hidden] or off display, and regardless of the element
    // type the lead uses for the container.
    container.hidden = true;
    container.style.display = 'none';
  }

  /**
   * Show a resume container again (reversing hideContainer).
   */
  function showContainer(container) {
    container.hidden = false;
    container.style.display = '';
  }

  /**
   * Render the Continue Reading card into `container`.
   * - No valid position: the container is left empty AND hidden.
   * - Valid position: the container is shown with a card reading
   *   "📖 Jari rakhen / Continue reading", "Surah N, Ayah A", and a
   *   link/button to "/quran?surah=N&ayah=A".
   * Safe to call with a null / missing container (does nothing).
   * Only existing CSS classes are used here (.card, .btn, .btn-primary,
   * .muted, .small) — no new class is introduced, so no new CSS is
   * needed for this card. The link's href is built from validated
   * integers only, so no user-controlled string is ever injected.
   * @param {Element|null|undefined} container - element to render into
   */
  function renderResumeCard(container) {
    if (!container || typeof container.innerHTML === 'undefined') {
      return;
    }
    var position = getPosition();
    if (position === null) {
      hideContainer(container);
      return;
    }
    var href = '/quran?surah=' + position.surah + '&ayah=' + position.ayah;
    container.innerHTML =
      '<div class="card">' +
        '<h2>\uD83D\uDCD6 Jari rakhen / Continue reading</h2>' +
        '<p class="muted small">Surah ' + position.surah +
        ', Ayah ' + position.ayah + '</p>' +
        '<a class="btn btn-primary" href="' + href + '">Continue reading</a>' +
      '</div>';
    showContainer(container);
  }

  // Public API. Nothing else is exposed; STORAGE_KEY and the helpers
  // stay private inside this IIFE.
  window.qsResume = {
    savePosition: savePosition,
    getPosition: getPosition,
    clearPosition: clearPosition,
    renderResumeCard: renderResumeCard
  };

  /**
   * Self-render on the home page: once the DOM is ready, if an element
   * with id "resume-card" exists, render into it. Every step is guarded:
   * - If the document is already past DOMContentLoaded, render at once.
   * - If #resume-card does not exist (e.g. on /quran), do nothing.
   * - renderResumeCard itself also guards a missing container, so a
   *   race where the element is removed cannot crash the page.
   */
  function selfRender() {
    var container = document.getElementById('resume-card');
    if (container) {
      renderResumeCard(container);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', selfRender);
  } else {
    selfRender();
  }
})();
