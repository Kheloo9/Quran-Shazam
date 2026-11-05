/* ========================================================================
   Quran Shazam — Parah (Juz) navigation for the Reader page (/quran).
   ========================================================================
   TEAM: PARAH (single-file ownership — this file only).
   PURPOSE (changed 2026-11-05, user order — button idea, NOT removal):
   /quran shows ONE "Parah (30 Juz)" button instead of a full-width
   30-card grid. Tapping it opens a picker listing all 30 Parah with
   their ranges; tapping a Parah opens a DEDICATED PARAH VIEW that
   renders the WHOLE juz — every ayah in order, with a surah header
   wherever the juz crosses a surah boundary — Arabic + English and
   Urdu translations, per-ayah Qari audio, bookmark, note and tafseer.
   The old behaviour (a card jumping to the starting surah/ayah view)
   is GONE: the user asked for the whole parah, not a jump.

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
   - Lead adds a #parah-open-btn button in the Surahs section of
     quran.html, plus hidden <section id="parah-picker"> (with
     <div id="parah-picker-grid">) and <section id="parah-view">
     (with <h2 id="parah-title">, <p id="parah-meta"> and
     <div id="parah-ayah-list">), plus back buttons
     #parah-picker-back / #parah-back; loads this script on /quran
     AFTER quran.js, and calls window.qsParah.init() once. init()
     wires everything and renders the picker lazily on first open.
   - Lead writes the CSS for the NEW classes listed at the bottom of
     this file; existing classes (.btn, .btn-ghost, .muted, .small,
     .ayah-card, .ayah-arabic, .ayah-en, .ayah-ur, .tafseer-*) are
     reused where sensible.

   RULES KEPT:
   - No user data is stored or sent, except the same localStorage keys
     the Reader already uses (bookmarks 'qs-bookmarks', notes
     'qs-notes', qari choice 'qs-qari') — nothing new is invented.
   - Audio in the parah view is QARI recitation ONLY (everyayah MP3s,
     proxy first, direct as fallback) — never AI TTS for ayat. Two
     players share one audio element + generation token: a simple
     single-ayah player, and "Play Full Parah", a continuous queue
     over the whole juz that ports the Reader's hardened flow
     (proxy-first/fallback, progress-aware stall watchdog, Play →
     Pause → Resume, "Ayah X/N" progress). The Reader's queue engine
     itself is NOT reused directly: it lives closed inside quran.js,
     hard-wired to one surah (currentSurah, #play-surah-btn,
     data-ayah-card), and generalising it would mean surgery on the
     verified engine with no live test here — so the same flow is
     re-implemented here, scoped to the juz. quran.js is untouched.
   - No unescaped data ever goes into innerHTML — every dynamic string
     passes through the local esc() helper below.
   - Fail soft everywhere: a failed surah-name fetch still leaves the
     full numbers-only list on screen; a failed juz fetch shows an
     honest error + Retry instead of a partial juz; a missing container
     or a missing optional module (qsNotes, qsRenderBookmarksRich) is
     a silent no-op, never a throw.
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
          openParahView(+card.getAttribute('data-n'));
        });
      })(cards[i]);
    }
  }

  /* ---------------- public API ---------------- */

  // Render one card per Juz into `container` (an element; an id string
  // is also accepted for convenience). Does nothing if the container
  // is null/missing — init() calls this once, lazily, when the picker
  // (#parah-picker-grid) is first opened. A card tap opens the whole
  // juz in the dedicated parah view (openParahView).
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
      if (Object.keys(names).length > 0) { surahNames = names; paint(container, names); }
    }).catch(function () {
      // Fail soft, by design: the numbers-only list already on screen
      // stays exactly as it is. No error UI — a missing name must never
      // hide the navigation itself.
    });
  }

  /* ---------------- view state ---------------- */
  var surahNames = {};      // surah number -> English name (picker fetch)
  var lastGroups = null;    // last rendered juz groups (lang-toggle re-render)
  var lastJuz = null;
  var parahAudioEl = null, parahPlayingKey = null;
  // "Play Full Parah" queue state (mirrors the Reader's queue engine).
  var parahQueue = [], parahQueueIndex = 0;
  var parahQueuePlaying = false, parahQueuePaused = false;
  var parahAudioGen = 0; // stale elements can never hijack a newer play()
  var PARAH_STALL_MS = 20000;    // no BYTES for this long = truly stuck
  var PARAH_HARD_CAP_MS = 90000; // absolute give-up per URL

  function $(id) {
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
  }

  function showPicker() {
    var grid = $('surah-grid-section'), picker = $('parah-picker'), view = $('parah-view');
    if (!picker) return;
    stopParahAudio();
    if (grid) grid.hidden = true;
    if (view) view.hidden = true;
    picker.hidden = false;
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' });
    var g = $('parah-picker-grid');
    if (g && !g.dataset.rendered) {
      g.dataset.rendered = '1';
      renderParahList(g);
    }
  }

  function showGrid() {
    var grid = $('surah-grid-section'), picker = $('parah-picker'), view = $('parah-view');
    stopParahAudio();
    if (picker) picker.hidden = true;
    if (view) view.hidden = true;
    if (grid) grid.hidden = false;
    lastGroups = null; lastJuz = null;
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Current translation language, read from the hero lang toggle the
  // Reader owns (English + اردو / English / اردو). The parah view
  // follows it; default 'both' when the toggle is absent.
  function currentParahLang() {
    if (typeof document === 'undefined') return 'both';
    var active = document.querySelector('.lang-btn.active');
    var lang = active ? active.getAttribute('data-lang') : null;
    return (lang === 'en' || lang === 'ur') ? lang : 'both';
  }

  /* ---------------- whole-juz data ---------------- */
  // Slice already-fetched surah payloads (API shape from
  // /api/quran/surah/{n}) down to exactly the ayat inside `juz`.
  // Returns [{ surah: payload, ayahs: [...] }, ...] in order, one
  // entry per surah the juz touches (a same-surah juz yields one).
  // Pure function — also exposed as _collectJuzAyahs for the harness.
  function collectJuzAyahs(juz, datas) {
    var out = [];
    (datas || []).forEach(function (d) {
      if (!d || !Array.isArray(d.ayahs)) return;
      var list = d.ayahs.filter(function (a) {
        if (d.number === juz.start.s && a.ayah < juz.start.a) return false;
        if (d.number === juz.end.s && a.ayah > juz.end.a) return false;
        return true;
      });
      if (list.length) out.push({ surah: d, ayahs: list });
    });
    return out;
  }

  function fetchSurah(n) {
    return fetch('/api/quran/surah/' + n).then(function (r) {
      if (!r.ok) throw new Error('surah ' + n + ' unavailable');
      return r.json();
    });
  }

  /* ---------------- whole-juz HTML ---------------- */
  // Pure HTML builder (string in, string out) — exposed as
  // _buildParahHtml for the harness. `lang` is 'both' | 'en' | 'ur'.
  function buildParahHtml(groups, juz, lang) {
    var showEn = lang !== 'ur', showUr = lang !== 'en';
    var h = '';
    groups.forEach(function (g) {
      var d = g.surah, firstAyah = g.ayahs[0] ? g.ayahs[0].ayah : 0;
      h += '<div class="parah-surah-head">';
      // Bismillah line mirrors the Reader's rule: shown when this
      // segment starts at the surah's ayah 1 — except Surah 9, which
      // has none. (Surah 1's ayah 1 IS the Bismillah text, exactly as
      // in the Reader, which shows its banner above it too.)
      if (firstAyah === 1 && d.number !== 9)
        h += '<div class="calligraphy small" aria-hidden="true">﷽</div>';
      h += '<h3>' + d.number + '. ' + esc(d.english) + '</h3>'
        + '<p class="muted"><span dir="rtl">' + esc(d.arabic) + '</span>'
        + ' · ' + esc(String(d.ayah_count)) + ' ayat · ' + esc(d.revelation) + '</p></div>';
      g.ayahs.forEach(function (a) {
        var key = d.number + ':' + a.ayah;
        var hasTaf = a.has_tafseer || a.has_tafseer_ur;
        h += '<article class="ayah ayah-card" id="parah-ayah-' + d.number + '-' + a.ayah + '" data-key="' + key + '">'
          + '<div class="ayah-top"><span class="parah-ayah-ref">' + d.number + ':' + a.ayah + '</span>'
          + '<span class="ayah-btns">'
          + '<button class="icon-btn parah-play-btn" data-play="' + key + '" title="Tilawat sunen">▶️</button>'
          + '<button class="icon-btn parah-bm-btn" data-bm="' + key + '" title="Bookmark">🔖</button>'
          + '<button class="icon-btn parah-note-btn" data-note="' + key + '" title="Note">📝</button>'
          + '</span></div>'
          + '<div class="ayah-arabic" dir="rtl">' + esc(a.arabic) + '</div>';
        if (showEn && a.translation_en)
          h += '<p class="ayah-en" aria-label="English translation"><span class="tr-label" aria-hidden="true">English</span>' + esc(a.translation_en) + '</p>';
        if (showUr && a.translation_ur)
          h += '<p class="ayah-ur" dir="rtl" aria-label="Urdu tarjuma"><span class="tr-label" aria-hidden="true">اردو</span>' + esc(a.translation_ur) + '</p>';
        if (hasTaf)
          h += '<button class="tafseer-btn" data-surah="' + d.number + '" data-ayah="' + a.ayah + '">📖 Tafseer parhein</button>'
            + '<div class="tafseer-panel" id="parah-tafseer-' + d.number + '-' + a.ayah + '" hidden>'
            + '<div class="tafseer-tabs"><button class="tafseer-tab active" data-tlang="en">English</button>'
            + '<button class="tafseer-tab" data-tlang="ur">اردو</button></div>'
            + '<div class="tafseer-body" data-tbody="en"><p class="muted">Loading tafseer...</p></div>'
            + '<div class="tafseer-body" data-tbody="ur" dir="rtl" hidden><p class="muted">تفسیر لوڈ ہو رہی ہے...</p></div>'
            + '</div>';
        h += '</article>';
      });
    });
    return h;
  }

  // Refresh bookmark / note 'active' states on the rendered parah
  // cards. Bookmarks read the Reader's own localStorage key; notes
  // ask qsNotes when it is present.
  function paintParahStates() {
    var list = $('parah-ayah-list');
    if (!list || typeof document === 'undefined') return;
    var bms = [];
    try { bms = JSON.parse(localStorage.getItem('qs-bookmarks') || '[]'); } catch (e) { bms = []; }
    list.querySelectorAll('.parah-bm-btn').forEach(function (b) {
      b.classList.toggle('active', bms.indexOf(b.getAttribute('data-bm')) >= 0);
    });
    if (typeof window !== 'undefined' && window.qsNotes
        && typeof window.qsNotes.hasNote === 'function') {
      list.querySelectorAll('.parah-note-btn').forEach(function (b) {
        b.classList.toggle('active', !!window.qsNotes.hasNote(b.getAttribute('data-note')));
      });
    }
  }

  // Open the WHOLE Juz `n` in the dedicated parah view: fetch every
  // surah the juz touches, slice to the juz range, render every ayah
  // in order with a surah header at each boundary. Any fetch failure
  // shows an honest error + Retry — never a partial juz.
  function openParahView(n) {
    var juz = findJuz(n);
    if (!juz) return;
    var grid = $('surah-grid-section'), picker = $('parah-picker'),
        view = $('parah-view'), list = $('parah-ayah-list');
    if (!view || !list) return;
    stopParahAudio();
    if (typeof fetch !== 'function') {
      list.innerHTML = '<p class="muted" style="text-align:center">Could not load this parah.</p>';
      return;
    }
    var title = $('parah-title'), meta = $('parah-meta');
    if (title) title.textContent = 'Parah ' + juz.n;
    if (meta) meta.textContent = refLabel(juz.start, surahNames) + ' — ' + refLabel(juz.end, surahNames);
    if (grid) grid.hidden = true;
    if (picker) picker.hidden = true;
    view.hidden = false;
    list.innerHTML = '<p class="muted" style="text-align:center">Loading Parah ' + juz.n + '…</p>';
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' });
    /* Resume: record the juz start as the reading position, exactly
       as opening a surah records surah:1. Guarded — safe without it. */
    if (typeof window !== 'undefined' && window.qsResume
        && typeof window.qsResume.savePosition === 'function') {
      try { window.qsResume.savePosition(juz.start.s, juz.start.a); } catch (e) {}
    }
    var nums = [];
    for (var s = juz.start.s; s <= juz.end.s; s++) nums.push(s);
    Promise.all(nums.map(fetchSurah)).then(function (datas) {
      var groups = collectJuzAyahs(juz, datas);
      lastGroups = groups; lastJuz = juz;
      list.innerHTML = buildParahHtml(groups, juz, currentParahLang());
      paintParahStates();
    }).catch(function () {
      lastGroups = null; lastJuz = null;
      list.innerHTML = '<p class="muted" style="text-align:center">Could not load this parah — please check your connection and try again.</p>'
        + '<p style="text-align:center"><button type="button" class="btn btn-ghost parah-retry-btn" data-n="' + juz.n + '">🔁 Dobara try karein</button></p>';
    });
  }

  /* ---------------- per-ayah audio (simple single-ayah player) -------- */
  // Deliberately NOT the Reader's queue engine (that lives inside
  // quran.js and is not exposed): one tap plays one ayah, proxy first,
  // everyayah direct as fallback. Same qari choice as the Reader
  // (localStorage 'qs-qari').
  function qariChoice() {
    try { return localStorage.getItem('qs-qari') || 'Alafasy_128kbps'; } catch (e) { return 'Alafasy_128kbps'; }
  }
  function proxyAudioUrl(s, a) {
    return '/api/audio/' + s + '/' + a + '?qari=' + encodeURIComponent(qariChoice());
  }
  function directAudioUrl(s, a) {
    var ss = String(s).padStart(3, '0'), aa = String(a).padStart(3, '0');
    return 'https://everyayah.com/data/' + qariChoice() + '/' + ss + aa + '.mp3';
  }
  // Stop EVERYTHING parah audio: single-ayah player AND the full-parah
  // queue. Called whenever the view is left or the juz changes, so no
  // parah audio can ever keep playing under another screen.
  function stopParahAudio() {
    stopParahPlayback();
  }
  function stopParahPlayback() {
    parahQueuePlaying = false; parahQueuePaused = false;
    parahQueue = []; parahQueueIndex = 0;
    parahAudioGen++; // stale watchdog/ended handlers bail out
    if (parahAudioEl) {
      try { parahAudioEl.pause(); } catch (e) {}
      parahAudioEl = null;
    }
    parahPlayingKey = null;
    updateParahProgress();
    if (typeof document !== 'undefined') {
      document.querySelectorAll('#parah-ayah-list .ayah-card').forEach(function (c) { c.classList.remove('now-playing'); });
    }
  }

  // Flatten rendered juz groups into the queue order: [{s, a}, ...].
  // Pure function — exposed as _queueFromGroups for the harness.
  function queueFromGroups(groups) {
    var out = [];
    (groups || []).forEach(function (g) {
      (g.ayahs || []).forEach(function (a) {
        out.push({ s: g.surah.number, a: a.ayah });
      });
    });
    return out;
  }

  // "Play Full Parah": Play → Pause → Resume, never restarts the juz
  // on pause (queue + index are kept, exactly like Play Full Surah).
  function playFullParah() {
    if (parahQueuePlaying && !parahQueuePaused) { pauseParahPlayback(); return; }
    if (parahQueuePlaying && parahQueuePaused) { resumeParahPlayback(); return; }
    if (!lastGroups || !lastGroups.length) return;
    parahQueue = queueFromGroups(lastGroups);
    if (!parahQueue.length) return;
    parahQueueIndex = 0;
    parahQueuePlaying = true; parahQueuePaused = false;
    updateParahProgress();
    playNextParahAyah();
  }
  function pauseParahPlayback() {
    if (parahAudioEl) { try { parahAudioEl.pause(); } catch (e) {} }
    parahQueuePaused = true;
    updateParahProgress();
  }
  function resumeParahPlayback() {
    parahQueuePaused = false;
    if (parahAudioEl) {
      try {
        var p = parahAudioEl.play();
        if (p && p.catch) p.catch(function () { parahQueuePaused = true; updateParahProgress(); });
      } catch (e) { parahQueuePaused = true; }
    }
    updateParahProgress();
  }
  // Single source of truth for the queue UI: button label, thin
  // progress line, and the per-ayah ▶️/⏸️ icons — mirrors the
  // Reader's updateSurahProgress().
  function updateParahProgress() {
    var btn = $('play-parah-btn');
    var wrap = $('parah-progress'), fill = $('parah-progress-fill'), txt = $('parah-progress-text');
    var total = parahQueue.length;
    var cur = total ? Math.min(parahQueueIndex + 1, total) : 0;
    if (btn) {
      btn.classList.toggle('playing', parahQueuePlaying);
      if (!parahQueuePlaying) btn.textContent = '▶️ Play Full Parah';
      else if (parahQueuePaused) btn.textContent = '⏸️ Resume · Ayah ' + cur + '/' + total;
      else btn.textContent = '⏸️ Pause · Ayah ' + cur + '/' + total;
    }
    if (wrap) {
      wrap.hidden = !parahQueuePlaying;
      if (parahQueuePlaying) {
        if (fill) fill.style.width = (total ? ((cur - 1) / total * 100) : 0).toFixed(1) + '%';
        if (txt) txt.textContent = parahQueuePaused
          ? 'Ayah ' + cur + ' of ' + total + ' — ruki hui / paused'
          : 'Ayah ' + cur + ' of ' + total + ' — tilawat jari hai / playing';
      }
    }
    var curKey = total ? (parahQueue[parahQueueIndex].s + ':' + parahQueue[parahQueueIndex].a) : '';
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.parah-play-btn').forEach(function (b) {
        b.textContent = (parahQueuePlaying && !parahQueuePaused && b.getAttribute('data-play') === curKey) ? '⏸️' : '▶️';
      });
    }
  }
  function playNextParahAyah() {
    if (!parahQueuePlaying || parahQueueIndex >= parahQueue.length) {
      stopParahPlayback();
      return;
    }
    var item = parahQueue[parahQueueIndex];
    var s = item.s, a = item.a;
    if (typeof document !== 'undefined') {
      document.querySelectorAll('#parah-ayah-list .ayah-card').forEach(function (c) { c.classList.remove('now-playing'); });
      var card = document.querySelector('[data-key="' + s + ':' + a + '"]');
      if (card) { card.classList.add('now-playing'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
    updateParahProgress();
    var gen = ++parahAudioGen;
    var stillCurrent = function () { return gen === parahAudioGen && parahQueuePlaying; };
    tryParahQueueUrl(proxyAudioUrl(s, a), false);
    function tryParahQueueUrl(url, isFallback) {
      if (!stillCurrent()) return;
      var el;
      try { el = new Audio(url); } catch (e) { return; }
      el.preload = 'auto';
      parahAudioEl = el; parahPlayingKey = s + ':' + a;
      var started = false, over = false;
      function done() { over = true; clearInterval(timer); }
      function abortEl() { try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} }
      function next() {
        if (over || !stillCurrent()) return;
        done(); abortEl();
        if (!isFallback) { tryParahQueueUrl(directAudioUrl(s, a), true); return; }
        parahQueueIndex++; playNextParahAyah();
      }
      // Progress-aware watchdog (same policy as the Reader's queue
      // engine): skips only when NOTHING progresses for STALL_MS —
      // slow mobile data keeps resetting it — with a hard cap. A
      // PAUSED player refreshes baselines so resume never skips.
      var lastProgressAt = Date.now(), lastBuffered = 0, lastTime = 0;
      var startedAt = Date.now();
      var timer = setInterval(function () {
        if (over || !stillCurrent()) { clearInterval(timer); return; }
        if (parahQueuePaused) { lastProgressAt = Date.now(); startedAt = Date.now(); return; }
        var progressed = false;
        try {
          var buf = (el.buffered && el.buffered.length) ? el.buffered.end(el.buffered.length - 1) : 0;
          if (buf > lastBuffered || el.currentTime > lastTime) { progressed = true; lastBuffered = buf; lastTime = el.currentTime; }
        } catch (e) {}
        if (progressed) { lastProgressAt = Date.now(); return; }
        if (Date.now() - lastProgressAt >= PARAH_STALL_MS || Date.now() - startedAt >= PARAH_HARD_CAP_MS) { clearInterval(timer); next(); }
      }, 1000);
      el.onended = function () {
        if (over || !stillCurrent()) return;
        done(); parahQueueIndex++; playNextParahAyah();
      };
      el.onerror = function () {
        if (over || !stillCurrent()) return;
        if (started) { done(); abortEl(); parahQueueIndex++; playNextParahAyah(); }
        else next();
      };
      el.play().then(function () {
        if (!stillCurrent()) { abortEl(); return; }
        started = true; lastProgressAt = Date.now();
      }).catch(next);
    }
  }

  function toggleParahAudio(btn) {
    var key = btn.getAttribute('data-play');
    if (!key) return;
    // Queue mirror (same rule as the Reader): the current queue ayah's
    // own ▶️/⏸️ button pauses/resumes the queue instead of fighting it.
    if (parahQueuePlaying && key === parahPlayingKey) {
      if (parahQueuePaused) resumeParahPlayback();
      else pauseParahPlayback();
      return;
    }
    // Any other tap stops the queue first.
    if (parahQueuePlaying) stopParahPlayback();
    if (parahPlayingKey === key && parahAudioEl && !parahAudioEl.paused) {
      parahAudioEl.pause(); btn.textContent = '▶️'; parahPlayingKey = null; return;
    }
    stopParahAudio();
    var parts = key.split(':');
    var s = +parts[0], a = +parts[1];
    if (!s || !a) return;
    btn.textContent = '⏳';
    var el;
    try { el = new Audio(proxyAudioUrl(s, a)); } catch (e) { btn.textContent = '▶️'; return; }
    parahAudioEl = el; parahPlayingKey = key;
    var gen = ++parahAudioGen;
    var stillCurrent = function () { return gen === parahAudioGen; };
    var triedFallback = false, finished = false;
    function reset() {
      if (finished || !stillCurrent()) return;
      finished = true; btn.textContent = '▶️'; parahPlayingKey = null; parahAudioEl = null;
    }
    function tryFallback() {
      if (finished || triedFallback) { reset(); return; }
      triedFallback = true;
      try { el.src = directAudioUrl(s, a); el.play().catch(reset); } catch (e) { reset(); }
    }
    el.onended = reset;
    el.onplaying = function () { if (stillCurrent()) btn.textContent = '⏸️'; };
    el.onerror = function () { if (!finished) tryFallback(); };
    try {
      var p = el.play();
      if (p && p.catch) p.catch(function () { if (!finished) tryFallback(); });
    } catch (e) { reset(); }
  }

  /* ---------------- bookmarks (same localStorage contract as Reader) -- */
  function getBookmarks() {
    try { return JSON.parse(localStorage.getItem('qs-bookmarks') || '[]'); }
    catch (e) { return []; }
  }
  function saveBookmarks(list) {
    try { localStorage.setItem('qs-bookmarks', JSON.stringify(list)); } catch (e) {}
  }
  function toggleParahBookmark(key, btn) {
    var list = getBookmarks();
    var i = list.indexOf(key);
    if (i >= 0) { list.splice(i, 1); btn.classList.remove('active'); }
    else { list.push(key); btn.classList.add('active'); }
    saveBookmarks(list);
    /* Refresh the Reader's bookmark grid + Collections (Sab reads
       qs-bookmarks live). Guarded — safe without quran.js. */
    if (typeof window !== 'undefined' && typeof window.qsRenderBookmarksRich === 'function') {
      try { window.qsRenderBookmarksRich(); } catch (e) {}
    }
  }

  /* ---------------- tafseer (same on-demand endpoint as Reader) ------ */
  function toggleParahTafseer(btn) {
    var s = btn.getAttribute('data-surah'), a = btn.getAttribute('data-ayah');
    if (!s || !a) return;
    var panel = (typeof document !== 'undefined')
      ? document.getElementById('parah-tafseer-' + s + '-' + a) : null;
    if (!panel) return;
    var willShow = panel.hidden;
    panel.hidden = !willShow;
    btn.classList.toggle('open', willShow);
    btn.textContent = willShow ? '📖 Tafseer band karein' : '📖 Tafseer parhein';
    if (willShow && !panel.dataset.loaded) {
      panel.dataset.loaded = '1';
      if (typeof fetch !== 'function') return;
      fetch('/api/quran/tafseer/' + s + '/' + a)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var enBody = panel.querySelector('[data-tbody="en"]');
          var urBody = panel.querySelector('[data-tbody="ur"]');
          if (!enBody || !urBody) return;
          if (d) {
            enBody.innerHTML = '<p>' + esc(d.tafseer_en || 'Tafseer not available.') + '</p>'
              + '<p class="tafseer-src muted small">— ' + esc(d.source_en || 'Tafsir Ibn Kathir') + '</p>';
            urBody.innerHTML = '<p>' + esc(d.tafseer_ur || 'تفسیر دستیاب نہیں۔') + '</p>'
              + '<p class="tafseer-src muted small">— ' + esc(d.source_ur || 'بیان القرآن') + '</p>';
          } else {
            enBody.innerHTML = '<p class="muted">Tafseer not available.</p>';
            urBody.innerHTML = '<p class="muted">تفسیر دستیاب نہیں۔</p>';
          }
        })
        .catch(function () {
          var enBody = panel.querySelector('[data-tbody="en"]');
          if (enBody) enBody.innerHTML = '<p class="muted">Failed to load. Try again.</p>';
        });
    }
  }

  /* ---------------- init: wire button, backs, delegation ------------ */
  var wired = false;
  function init() {
    if (wired) return;
    wired = true;
    if (typeof document === 'undefined') return;
    var openBtn = $('parah-open-btn');
    if (openBtn) openBtn.addEventListener('click', showPicker);
    var pickerBack = $('parah-picker-back');
    if (pickerBack) pickerBack.addEventListener('click', showGrid);
    var back = $('parah-back');
    if (back) back.addEventListener('click', showGrid);
    var playParahBtn = $('play-parah-btn');
    if (playParahBtn) playParahBtn.addEventListener('click', playFullParah);
    /* Hero lang toggle also re-renders the open parah view so the EN/UR
       choice applies there exactly as in the surah Reader. Playback is
       stopped first — the list rebuild would wipe the queue's cards. */
    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (lastGroups && lastJuz) {
          var list = $('parah-ayah-list'), view = $('parah-view');
          if (list && view && !view.hidden) {
            stopParahAudio();
            list.innerHTML = buildParahHtml(lastGroups, lastJuz, currentParahLang());
            paintParahStates();
          }
        }
      });
    });
    /* One delegated listener for the whole parah view (play / bookmark
       / note / tafseer / retry). Attached once; the list is re-rendered
       per juz, so per-card listeners would be wiped each time. */
    var list = $('parah-ayah-list');
    if (list) list.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var playBtn = t.closest('.parah-play-btn');
      if (playBtn) { toggleParahAudio(playBtn); return; }
      var bmBtn = t.closest('.parah-bm-btn');
      if (bmBtn) { toggleParahBookmark(bmBtn.getAttribute('data-bm'), bmBtn); return; }
      var noteBtn = t.closest('.parah-note-btn');
      if (noteBtn) {
        if (typeof window !== 'undefined' && window.qsNotes
            && typeof window.qsNotes.openNoteEditor === 'function') {
          try { window.qsNotes.openNoteEditor(noteBtn.getAttribute('data-note')); } catch (err) {}
        }
        return;
      }
      var retryBtn = t.closest('.parah-retry-btn');
      if (retryBtn) { openParahView(+retryBtn.getAttribute('data-n')); return; }
      var tafBtn = t.closest('.tafseer-btn');
      if (tafBtn) { toggleParahTafseer(tafBtn); return; }
      var tab = t.closest('.tafseer-tab');
      if (tab) {
        var panel = tab.closest('.tafseer-panel');
        if (panel) {
          panel.querySelectorAll('.tafseer-tab').forEach(function (x) { x.classList.remove('active'); });
          tab.classList.add('active');
          var lang = tab.getAttribute('data-tlang');
          panel.querySelectorAll('.tafseer-body').forEach(function (b) {
            b.hidden = b.getAttribute('data-tbody') !== lang;
          });
        }
      }
    });
  }

  window.qsParah = {
    JUZ: JUZ,
    renderParahList: renderParahList,
    openParahView: openParahView,
    init: init,
    // Test seams (harness only — the page never calls these):
    _collectJuzAyahs: collectJuzAyahs,
    _buildParahHtml: buildParahHtml,
    _queueFromGroups: queueFromGroups
  };
})();

/* NEW CSS CLASSES FOR THE LEAD (none of these exist yet — please add):
   - .parah-btn-row   : centred row holding the single Parah button
   - .parah-surah-head: surah-boundary header inside the parah view
   - .parah-ayah-ref  : pill showing "surah:ayah" on each parah ayah card
                        (NOT .ayah-num — that is a 34px circle for one
                        number only; "2:142" does not fit in it)
   Already added 2026-11-04: .parah-card, .parah-num, .parah-range.
   Reused existing classes: .btn, .btn-ghost, .muted, .small, .ayah-card,
   .ayah-top, .ayah-btns, .icon-btn, .ayah-arabic, .ayah-en, .ayah-ur,
   .tafseer-btn, .tafseer-panel, .tafseer-tab, .tafseer-body, .tr-label,
   .calligraphy.small, .reader-head. */
