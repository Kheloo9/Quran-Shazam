/* ========================================================================
   Quran Shazam — Parah (Juz) navigation for the Reader page (/quran).
   ========================================================================
   TEAM: PARAH (single-file ownership — this file only).
   PURPOSE: let the reader jump to any of the 30 Parah (Juz) by tapping a
   card. A card opens the Parah's starting surah and scrolls to its
   starting ayah, mirroring the existing search-hit navigation flow in
   quran.js (open surah, then after 300ms scroll the ayah into view and
   add the 'highlight' class).

   VERIFIED DATA (2026-11-04, by script against the real corpus):
   - Source: backend/data/quran.json — top-level list of 114 surahs.
     Each surah's ayah count was taken from its `total_verses` field and
     cross-checked against len(`verses`) and sequential verse ids 1..N;
     both agree for all 114 surahs, totalling 6,236 ayat.
   - Every Juz start below was checked to lie within its surah's real
     ayah count; each Juz end is the next Juz's start minus one ayah
     (Juz 30 ends at 114:6). The 30 ranges cover exactly 6,236 ayat
     with 0 gaps and 0 overlaps. If a boundary ever fails that check
     against the corpus, it must be reported as BLOCKED — never adjusted
     silently. (Validation script output is in the delivery report.)

   WIRING (done by the lead, NOT here — this file assumes nothing exists
   at load time and renders nothing on its own):
   - Lead adds <section id="parah-section"> containing
     <div id="parah-grid"></div> to quran.html, loads this script on
     /quran AFTER quran.js (so window.qsOpenSurah already exists), and
     calls window.qsParah.renderParahList(
     document.getElementById('parah-grid')) once the section is in the
     DOM (e.g. on page load, or when the section is first shown).
   - Lead writes the CSS for the NEW classes listed at the bottom of
     this file; existing classes (.btn, .btn-ghost, .muted, .small)
     are reused where sensible.

   RULES KEPT:
   - No audio behaviour is touched; no user data is stored or sent.
   - No unescaped data ever goes into innerHTML — every dynamic string
     passes through the local esc() helper below.
   - Fail soft everywhere: a failed surah-name fetch still leaves the
     full numbers-only list on screen; a missing container or a missing
     window.qsOpenSurah is a silent no-op, never a throw.
   ======================================================================== */
(function () {
  'use strict';

  /* ---------------- escaping (same rule as quran.js) ---------------- */
  // NEVER put unescaped data into innerHTML. Surah names come from the
  // server, so they are escaped even though they are expected to be safe.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------- verified 30-Juz table ---------------- */
  // Shape: { n, start: { s, a }, end: { s, a } } — s = surah, a = ayah.
  // Ends were computed as (next Juz start minus one ayah); see header.
  var JUZ = [
    { n: 1,  start: { s: 1,  a: 1 },   end: { s: 2,   a: 141 } },
    { n: 2,  start: { s: 2,  a: 142 }, end: { s: 2,   a: 252 } },
    { n: 3,  start: { s: 2,  a: 253 }, end: { s: 3,   a: 92 } },
    { n: 4,  start: { s: 3,  a: 93 },  end: { s: 4,   a: 23 } },
    { n: 5,  start: { s: 4,  a: 24 },  end: { s: 4,   a: 147 } },
    { n: 6,  start: { s: 4,  a: 148 }, end: { s: 5,   a: 81 } },
    { n: 7,  start: { s: 5,  a: 82 },  end: { s: 6,   a: 110 } },
    { n: 8,  start: { s: 6,  a: 111 }, end: { s: 7,   a: 87 } },
    { n: 9,  start: { s: 7,  a: 88 },  end: { s: 8,   a: 40 } },
    { n: 10, start: { s: 8,  a: 41 },  end: { s: 9,   a: 92 } },
    { n: 11, start: { s: 9,  a: 93 },  end: { s: 11,  a: 5 } },
    { n: 12, start: { s: 11, a: 6 },   end: { s: 12,  a: 52 } },
    { n: 13, start: { s: 12, a: 53 },  end: { s: 14,  a: 52 } },
    { n: 14, start: { s: 15, a: 1 },   end: { s: 16,  a: 128 } },
    { n: 15, start: { s: 17, a: 1 },   end: { s: 18,  a: 74 } },
    { n: 16, start: { s: 18, a: 75 },  end: { s: 20,  a: 135 } },
    { n: 17, start: { s: 21, a: 1 },   end: { s: 22,  a: 78 } },
    { n: 18, start: { s: 23, a: 1 },   end: { s: 25,  a: 20 } },
    { n: 19, start: { s: 25, a: 21 },  end: { s: 27,  a: 55 } },
    { n: 20, start: { s: 27, a: 56 },  end: { s: 29,  a: 45 } },
    { n: 21, start: { s: 29, a: 46 },  end: { s: 33,  a: 30 } },
    { n: 22, start: { s: 33, a: 31 },  end: { s: 36,  a: 27 } },
    { n: 23, start: { s: 36, a: 28 },  end: { s: 39,  a: 31 } },
    { n: 24, start: { s: 39, a: 32 },  end: { s: 41,  a: 46 } },
    { n: 25, start: { s: 41, a: 47 },  end: { s: 45,  a: 37 } },
    { n: 26, start: { s: 46, a: 1 },   end: { s: 51,  a: 30 } },
    { n: 27, start: { s: 51, a: 31 },  end: { s: 57,  a: 29 } },
    { n: 28, start: { s: 58, a: 1 },   end: { s: 66,  a: 12 } },
    { n: 29, start: { s: 67, a: 1 },   end: { s: 77,  a: 50 } },
    { n: 30, start: { s: 78, a: 1 },   end: { s: 114, a: 6 } }
  ];

  /* ---------------- helpers ---------------- */
  function findJuz(n) {
    n = parseInt(n, 10);
    if (!n || n < 1 || n > 30) return null;
    return JUZ[n - 1];
  }

  // "Surah 2:142" without a name, "Surah Al-Baqarah 2:142" with one.
  // Numbers are always shown, so the range is readable either way.
  function refLabel(ref, names) {
    var name = names ? names[ref.s] : null;
    return 'Surah ' + (name ? esc(name) + ' ' : '') + ref.s + ':' + ref.a;
  }

  // One card per Juz. `names` is an optional map surah-number -> English
  // name; when absent, cards render numbers-only (the fail-soft form).
  function paint(container, names) {
    container.innerHTML = JUZ.map(function (j) {
      return '<button type="button" class="parah-card btn btn-ghost" data-n="' + j.n + '"'
        + ' aria-label="Open Parah ' + j.n + '">'
        + '<span class="parah-num">Parah ' + j.n + '</span>'
        + '<span class="parah-range muted small">'
        + refLabel(j.start, names) + ' &mdash; ' + refLabel(j.end, names)
        + '</span></button>';
    }).join('');
    // Wire taps (one listener per card; only 30 cards, no delegation
    // needed, and this keeps the grid independent of quran.js).
    var cards = container.querySelectorAll
      ? container.querySelectorAll('.parah-card') : [];
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        card.addEventListener('click', function () {
          openParah(+card.getAttribute('data-n'));
        });
      })(cards[i]);
    }
  }

  /* ---------------- public API ---------------- */

  // Render one card per Juz into `container` (an element; an id string
  // is also accepted for convenience). Does nothing if the container
  // is null/missing — the lead calls this only once #parah-grid exists.
  // The list is painted numbers-only FIRST so it is never empty, then
  // a best-effort fetch of /api/quran/surahs upgrades the cards with
  // English surah names. Any fetch failure simply leaves the
  // numbers-only list in place.
  function renderParahList(container) {
    if (typeof container === 'string') {
      container = (typeof document !== 'undefined')
        ? document.getElementById(container) : null;
    }
    if (!container) return;
    paint(container, null);
    if (typeof fetch !== 'function') return;
    fetch('/api/quran/surahs').then(function (r) {
      if (!r.ok) throw new Error('unavailable');
      return r.json();
    }).then(function (d) {
      // API shape (see main.py quran_surahs): { surahs: [{ number,
      // english, arabic, ayahs, revelation }, ...] }. Tolerate a bare
      // array too, and ignore a payload with no usable names.
      var list = (d && d.surahs) || (Array.isArray(d) ? d : []);
      var names = {};
      list.forEach(function (s) {
        if (s && s.number && s.english) names[s.number] = s.english;
      });
      if (Object.keys(names).length > 0) paint(container, names);
    }).catch(function () {
      // Fail soft, by design: the numbers-only list already on screen
      // stays exactly as it is. No error UI — a missing name must never
      // hide the navigation itself.
    });
  }

  // Jump to the start of Juz `n`: open its starting surah via the
  // Reader's own opener, then after 300ms scroll the starting ayah
  // into view (centred) and mark it with the 'highlight' class — the
  // same sequence as the search-hit flow in quran.js. If
  // window.qsOpenSurah is missing (e.g. this script loaded before
  // quran.js), do nothing rather than throwing.
  function openParah(n) {
    var juz = findJuz(n);
    if (!juz) return;
    if (typeof window === 'undefined'
        || typeof window.qsOpenSurah !== 'function') return;
    window.qsOpenSurah(juz.start.s);
    setTimeout(function () {
      if (typeof document === 'undefined') return;
      var el = document.getElementById('ayah-' + juz.start.a);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
      }
    }, 300);
  }

  window.qsParah = { JUZ: JUZ, renderParahList: renderParahList, openParah: openParah };
})();

/* NEW CSS CLASSES FOR THE LEAD (none of these exist yet — please add):
   - .parah-card   : the per-Juz button card (layout; sits on .btn.btn-ghost)
   - .parah-num    : the "Parah N" heading line inside the card
   - .parah-range  : the "Surah S:A — Surah S:A" range line inside the card
   Reused existing classes: .btn, .btn-ghost, .muted, .small.
   Existing classes reused from the Reader, not defined here:
   .highlight (ayah gold ring, already in the Reader CSS). */
