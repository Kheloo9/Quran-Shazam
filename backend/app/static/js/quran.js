/* ========================================================================
   Quran Reader — surah list, reader, search. All rendering escaped.
   ========================================================================
   FYP STUDY GUIDE: Frontend Architecture
   ------------------------------------------------------------------------
   This file handles the /quran page. Key concepts:

   1. STATE MANAGEMENT (simple variables, no framework):
      - surahs: list of all 114 surahs (from /api/quran/surahs)
      - currentSurah: which surah is open (0 = none)
      - currentLang: 'both' | 'en' | 'ur' (translation display)
      - showTafseer, showTranslit, hifzMode: UI toggles

   2. ESCAPING (security!):
      - esc() function escapes HTML to prevent XSS attacks
      - NEVER use innerHTML with unescaped user data!
      - This is a key security practice for FYP defense.

   3. EVENT DELEGATION:
      - Instead of adding listeners to each button...
      - ...we add ONE listener to the parent (#ayah-list)
      - e.target.closest() finds which button was clicked
      - More efficient, works for dynamically added content.

   4. API CALLS:
      - fetch('/api/quran/surahs') -> list of surahs
      - fetch('/api/quran/surah/112') -> full surah with translations
      - fetch('/api/quran/search?q=...') -> search results
   ======================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let surahs = [], currentSurah = 0, currentLang = 'both', showTafseer = false;
  let arabicSize = 1.6; // rem
  let hifzMode = false, showTranslit = false;
  let audioEl = null, playingKey = null;
  // Professional: Qari selection — user picks their favorite reciter.
  // Saved in localStorage so it persists across visits.
  let currentQari = 'Alafasy_128kbps';
  try { currentQari = localStorage.getItem('qs-qari') || 'Alafasy_128kbps'; } catch (e) {}
  let qariList = [];
  // Full-surah playback state
  // R-4 (DESIGN AUDIT 2026-10-22): surahPaused lets "Play Full Surah" pause
  // WITHOUT clearing the queue — an interrupted 286-ayah surah resumes from
  // the same ayah instead of restarting from ayah 1.
  let surahPlayQueue = [], surahPlayIndex = 0, surahPlaying = false, surahPaused = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------- surah grid ---------------- */
  async function loadSurahs() {
    try {
      const r = await fetch('/api/quran/surahs');
      if (!r.ok) throw new Error('unavailable');
      surahs = (await r.json()).surahs || [];
      renderGrid('');
      /* LEAD 2026-11-04: Filter — only now is a count meaningful; before this
         the grid holds a loading paragraph (0 cards). */
      const sc = $('surah-count');
      if (sc) sc.hidden = false;
    } catch (e) {
      $('surah-grid').innerHTML = '<p class="muted" style="text-align:center">The Quran reader is warming up — please refresh in a moment.</p>';
    }
  }

  let revFilter = 'all';
  function renderGrid(filter) {
    const q = (filter || '').trim().toLowerCase();
    const list = surahs.filter(s => {
      if (revFilter !== 'all' && s.revelation !== revFilter) return false;
      if (!q) return true;
      return s.english.toLowerCase().includes(q) || String(s.number) === q
          || s.arabic.includes(filter.trim());
    });
    $('surah-grid').innerHTML = list.map(s =>
      '<button class="surah-card" data-n="' + s.number + '">'
      + '<span class="surah-num">' + s.number + '</span>'
      + '<span class="surah-names"><strong>' + esc(s.english) + '</strong>'
      + '<span class="arabic-name" dir="rtl">' + esc(s.arabic) + '</span></span>'
      + '<span class="surah-meta">' + s.ayahs + ' ayat · ' + esc(s.revelation) + '</span>'
      + '</button>'
    ).join('') || '<p class="muted" style="text-align:center">No surahs match.</p>';
    document.querySelectorAll('.surah-card').forEach(b =>
      b.addEventListener('click', () => openSurah(+b.dataset.n)));
  }

  /* ---------------- reader ---------------- */
  async function openSurah(n) {
    /* TEAM 3 (2026-10-22): a surah switch always stops full-surah playback.
       FYP STUDY GUIDE: the old code left the queue running — the OLD surah's
       audio kept playing under the NEW surah, and the now-playing highlight
       (matched by ayah number only) landed on the new surah's same-numbered
       cards. stopSurahPlayback() bumps the generation token too, so the
       queue's watchdog timers can never advance a dead queue. */
    stopSurahPlayback();
    currentSurah = n;
    /* LEAD 2026-11-04: Resume — opening a surah records position surah:1. */
    if (window.qsResume && typeof window.qsResume.savePosition === 'function') window.qsResume.savePosition(n, 1);
    /* TEAM 1 (2026-10-22, R-2) — RELIGIOUS ACCURACY: Surah At-Tawbah (9) is
       the only surah WITHOUT a Bismillah. The #reader-head banner is
       hardcoded in the template, so hide it exactly for surah 9. The
       numbered check uses currentSurah (single source of truth set above). */
    const basmala = $('reader-basmala');
    if (basmala) basmala.hidden = (currentSurah === 9);
    $('surah-grid-section').hidden = true;
    $('reader').hidden = false;
    $('ayah-list').innerHTML = '<p class="muted" style="text-align:center">Loading…</p>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const r = await fetch('/api/quran/surah/' + n);
      if (!r.ok) throw new Error('not found');
      renderSurah(await r.json());
    } catch (e) {
      $('ayah-list').innerHTML = '<p class="muted" style="text-align:center">Could not load this surah.</p>';
    }
  }

  function renderSurah(d) {
    lastData = d;
    $('reader-title').textContent = d.number + '. ' + d.english;
    // R-7 (DESIGN AUDIT 2026-10-22): isolate the Arabic name in <span dir="rtl">
    // so the bidi algorithm can't reorder "name · 286 ayat · Madani" oddly
    // when RTL and LTR text mix on one line.
    $('reader-meta').innerHTML = '<span dir="rtl">' + esc(d.arabic) + '</span>'
      + ' · ' + esc(String(d.ayah_count)) + ' ayat · ' + esc(d.revelation);
    $('prev-surah').disabled = d.number <= 1;
    $('next-surah').disabled = d.number >= 114;
    // R-3: bound the ayah-jump input to this surah's real ayah count.
    const ji = $('ayah-jump-input');
    if (ji) { ji.max = d.ayah_count; ji.value = ''; }
    renderAyahs(d);
  }

  // Re-render ayahs when language/toggle changes; cache last data.
  let lastData = null;

  function renderAyahs(d) {
    lastData = d;
    const showEn = currentLang === 'both' || currentLang === 'en';
    const showUr = currentLang === 'both' || currentLang === 'ur';
    $('ayah-list').innerHTML = d.ayahs.map(a => {
      let h = '<article class="ayah ayah-card" id="ayah-' + a.ayah + '" data-ayah-card="' + a.ayah + '">'
        + '<div class="ayah-top"><span class="ayah-num">' + a.ayah + '</span>'
        + '<span class="ayah-btns">'
        + '<button class="icon-btn play-btn" data-play="' + d.number + ':' + a.ayah + '" title="Tilawat sunen">▶️</button>'
        + '<button class="icon-btn bookmark-btn" data-bm="' + d.number + ':' + a.ayah + '" title="Bookmark">🔖</button>'
        + '<button class="icon-btn share-btn" data-share="' + d.number + ':' + a.ayah + '" title="Share">📤</button>'
        + '</span></div>'
        + '<div class="ayah-arabic' + (hifzMode ? ' hifz-hidden' : '') + '" dir="rtl" style="font-size:' + arabicSize + 'rem">' + esc(a.arabic) + '</div>'
        + (hifzMode ? '<button class="hifz-reveal" data-reveal="' + a.ayah + '">👁️ Dekhein</button>' : '')
        + (showTranslit && a.transliteration ? '<p class="ayah-translit"><em>' + esc(a.transliteration) + '</em></p>' : '');
      if (showEn && a.translation_en)
        // R-8 (DESIGN AUDIT 2026-10-22): tiny visible language labels in "both"
        // mode + aria-labels, so users can tell which translation is which.
        h += '<p class="ayah-en" aria-label="English translation"><span class="tr-label" aria-hidden="true">English</span>' + esc(a.translation_en) + '</p>';
      if (showUr && a.translation_ur)
        h += '<p class="ayah-ur" dir="rtl" aria-label="Urdu tarjuma"><span class="tr-label" aria-hidden="true">اردو</span>' + esc(a.translation_ur) + '</p>';
      if (showTafseer && (a.has_tafseer || a.has_tafseer_ur))
        h += '<button class="tafseer-btn" data-ayah="' + a.ayah + '">📖 Tafseer parhein</button>'
          + '<div class="tafseer-panel" id="tafseer-' + a.ayah + '" hidden>'
          + '<div class="tafseer-tabs"><button class="tafseer-tab active" data-tlang="en">English</button>'
          + '<button class="tafseer-tab" data-tlang="ur">اردو</button></div>'
          + '<div class="tafseer-body" data-tbody="en"><p class="muted">Loading tafseer...</p></div>'
          + '<div class="tafseer-body" data-tbody="ur" dir="rtl" hidden><p class="muted">تفسیر لوڈ ہو رہی ہے...</p></div>'
          + '</div>';
      return h + '</article>';
    }).join('');
    // R-9 (DESIGN AUDIT 2026-10-22): A+/A− used to scale ONLY the Arabic.
    // Elderly users tap A+ to read the Urdu. Publish the scale factor as a
    // CSS var (--fs-scale, 1 = default); .ayah-en/.ayah-ur/.tafseer-body p
    // consume it via calc() so every text size grows proportionally.
    // FYP STUDY GUIDE: CSS custom properties inherit — set once on the
    // container, every paragraph inside scales without JS touching them.
    $('ayah-list').style.setProperty('--fs-scale', (arabicSize / 1.6).toFixed(3));
    paintBookmarks();
    /* LEAD 2026-11-04: Notes — repaint note buttons after every ayah render
       (renderAyahs rebuilds #ayah-list, wiping them). Guarded: safe if
       qs-notes.js failed to load. */
    if (window.qsNotes && typeof window.qsNotes.paintNoteButtons === 'function') window.qsNotes.paintNoteButtons();
  }

  function closeReader() {
    $('reader').hidden = true;
    $('surah-grid-section').hidden = false;
    currentSurah = 0;
    lastData = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- tilawat audio ---------------- */
  function audioUrl(surah, ayah) {
    const s = String(surah).padStart(3, '0'), a = String(ayah).padStart(3, '0');
    return 'https://everyayah.com/data/' + currentQari + '/' + s + a + '.mp3';
  }
  // Primary: proxy through our own server (reliable, correct content-type, no CORS issues)
  function proxyAudioUrl(surah, ayah) {
    return '/api/audio/' + surah + '/' + ayah + '?qari=' + encodeURIComponent(currentQari);
  }
  // Load available Qaris from server
  async function loadQaris() {
    try {
      const r = await fetch('/api/quran/qaris');
      if (!r.ok) return;
      const d = await r.json();
      qariList = d.qaris || [];
      renderQariSelector();
    } catch (e) { /* silent — default Qari works */ }
  }
  function renderQariSelector() {
    // Custom card-based picker (unique design) — no native select.
    const wrap = $('qari-cards');
    if (!wrap) return;
    if (!qariList.length) {
      wrap.innerHTML = '<p class="muted">Loading qaris…</p>';
      return;
    }
    wrap.innerHTML = qariList.map(q =>
      '<button class="qari-card' + (q.id === currentQari ? ' selected' : '') + '" data-qari="' + esc(q.id) + '">'
      + '<span class="qari-card-avatar" aria-hidden="true">🎙️</span>'
      + '<span class="qari-card-info"><strong>' + esc(q.name) + '</strong>'
      + '<span class="qari-card-style muted">' + esc(q.style) + '</span></span>'
      + '<span class="qari-card-check" aria-hidden="true">' + (q.id === currentQari ? '✓' : '') + '</span>'
      + '</button>'
    ).join('');
    wrap.querySelectorAll('.qari-card').forEach(c =>
      c.addEventListener('click', () => { setQari(c.dataset.qari); closeQariSheet(); }));
    updateQariButton();
  }
  function updateQariButton() {
    const nameEl = $('qari-picker-name');
    if (!nameEl) return;
    const q = qariList.find(x => x.id === currentQari);
    nameEl.textContent = q ? q.name : 'Mishary Rashid Alafasy';
  }
  function openQariSheet() {
    renderQariSelector();
    $('qari-sheet-backdrop').hidden = false;
    $('qari-sheet').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeQariSheet() {
    $('qari-sheet-backdrop').hidden = true;
    $('qari-sheet').hidden = true;
    document.body.style.overflow = '';
  }
  function setQari(qariId) {
    currentQari = qariId;
    try { localStorage.setItem('qs-qari', qariId); } catch (e) {}
    // Stop any playing audio when switching Qari
    stopSurahPlayback();
    if (audioEl) { audioGen++; audioEl.pause(); audioEl = null; playingKey = null; }
    document.querySelectorAll('.play-btn').forEach(b => b.textContent = '▶️');
    updateQariButton();
    renderQariSelector();
    const q = qariList.find(x => x.id === qariId) || {};
    showAudioError('🎙️ Qari: ' + (q.name || qariId));
  }
  /* ---- Full surah playback: play all ayat continuously ----
     R-4 (DESIGN AUDIT 2026-10-22): the old toggle killed the whole queue on
     stop, so any interruption (call, chore) restarted a long surah from
     ayah 1. Now the button cycles Play → Pause → Resume and NEVER clears
     the queue mid-play; surahPlayIndex is preserved. "Ayah X/286" progress
     shows in the button text and on the thin line under the controls.
     FYP STUDY GUIDE: pausing is audioEl.pause() only — the queue (an array
     of ayah numbers) and the index live in JS variables, untouched. Resume
     is just audioEl.play() on the SAME element, so the watchdog's
     generation token (audioGen) still matches and playback continues. */
  function playFullSurah() {
    if (surahPlaying && !surahPaused) { pauseSurahPlayback(); return; }
    if (surahPlaying && surahPaused) { resumeSurahPlayback(); return; }
    if (!lastData || !lastData.ayahs || !lastData.ayahs.length) return;
    surahPlayQueue = lastData.ayahs.map(a => a.ayah);
    surahPlayIndex = 0;
    surahPlaying = true;
    surahPaused = false;
    updateSurahProgress();
    playNextInQueue();
  }
  function pauseSurahPlayback() {
    if (audioEl) { try { audioEl.pause(); } catch (e) {} }
    surahPaused = true;      // queue + index kept — position is NOT lost
    updateSurahProgress();
  }
  function resumeSurahPlayback() {
    surahPaused = false;
    if (audioEl) {
      try {
        const p = audioEl.play();
        // Honest state: if the browser refuses play(), don't pretend we're playing.
        if (p && p.catch) p.catch(() => { surahPaused = true; updateSurahProgress(); });
      } catch (e) { surahPaused = true; }
    }
    updateSurahProgress();
  }
  // Single source of truth for the queue UI: button label, thin progress
  // line, and the per-ayah ▶️/⏸️ icons. Called whenever state changes.
  function updateSurahProgress() {
    const btn = $('play-surah-btn');
    const wrap = $('surah-progress'), fill = $('surah-progress-fill'), txt = $('surah-progress-text');
    const total = surahPlayQueue.length;
    const cur = total ? Math.min(surahPlayIndex + 1, total) : 0;
    if (btn) {
      btn.classList.toggle('playing', surahPlaying);
      if (!surahPlaying) btn.textContent = '▶️ Play Full Surah';
      else if (surahPaused) btn.textContent = '⏸️ Resume · Ayah ' + cur + '/' + total;
      else btn.textContent = '⏸️ Pause · Ayah ' + cur + '/' + total;
    }
    if (wrap) {
      wrap.hidden = !surahPlaying;
      if (surahPlaying) {
        if (fill) fill.style.width = (total ? ((cur - 1) / total * 100) : 0).toFixed(1) + '%';
        if (txt) txt.textContent = surahPaused
          ? 'Ayah ' + cur + ' of ' + total + ' — ruki hui / paused'
          : 'Ayah ' + cur + ' of ' + total + ' — tilawat jari hai / playing';
      }
    }
    // Keep per-ayah play icons in sync with the pause state.
    const curKey = total ? (currentSurah + ':' + surahPlayQueue[surahPlayIndex]) : '';
    document.querySelectorAll('.play-btn').forEach(b => {
      b.textContent = (surahPlaying && !surahPaused && b.dataset.play === curKey) ? '⏸️' : '▶️';
    });
  }
  function playNextInQueue() {
    if (!surahPlaying || surahPlayIndex >= surahPlayQueue.length) {
      stopSurahPlayback();
      return;
    }
    const ayah = surahPlayQueue[surahPlayIndex];
    const s = currentSurah, a = ayah;
    // Highlight current ayah
    document.querySelectorAll('.ayah-card').forEach(c => c.classList.remove('now-playing'));
    const card = document.querySelector('[data-ayah-card="' + a + '"]');
    if (card) { card.classList.add('now-playing'); card.scrollIntoView({behavior: 'smooth', block: 'center'}); }
    // R-4: button label, progress line, per-ayah icons — all from one place.
    updateSurahProgress();
    // Professional: use proxy FIRST (reliable), direct as fallback.
    // Hardened (TEAM 5): generation token + 15 s stall timeout, so a hung
    // network can never freeze the whole surah queue. Queue skips silently
    // on failure (no toast spam while 114 ayat play).
    const gen = ++audioGen;
    const stillCurrent = () => gen === audioGen && surahPlaying;
    tryQueueUrl(proxyAudioUrl(s, a), false);
    function tryQueueUrl(url, isFallback) {
      if (!stillCurrent()) return;
      const el = new Audio(url);
      el.preload = 'auto';
      audioEl = el; playingKey = s + ':' + a;
      let started = false, over = false;
      const done = () => { over = true; clearTimeout(timer); };
      function abortEl() {
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
      }
      function next() {
        // Could not START this ayah: try fallback, else skip to next ayah.
        if (over || !stillCurrent()) return;
        done(); abortEl();
        if (!isFallback) { tryQueueUrl(audioUrl(s, a), true); return; }
        surahPlayIndex++; playNextInQueue();
      }
      // Progress-aware watchdog (same policy as the single-ayah engine).
      // BUG FIXED 2026-10-20 (A-to-Z live audit): this line used to read
      //   setTimeout(next, AUDIO_STALL_TIMEOUT_MS)
      // but AUDIO_STALL_TIMEOUT_MS was never defined anywhere — the
      // ReferenceError killed tryQueueUrl BEFORE el.play() below, so
      // "Play Full Surah" showed a playing UI but stayed silent.
      // FYP STUDY GUIDE: the watchdog only skips an ayah when NOTHING
      // progresses (no new buffered bytes, no playback-time advance) for
      // STALL_MS — slow mobile data keeps resetting it — with a hard cap.
      let lastProgressAt = Date.now(), lastBuffered = 0, lastTime = 0;
      let startedAt = Date.now();   // let (not const): R-4 resets it while paused
      const timer = setInterval(() => {
        if (over || !stillCurrent()) { clearInterval(timer); return; }
        // R-4: a PAUSED player must not look like a stalled one. Refresh the
        // watchdog baselines while paused, so resuming never skips the ayah.
        if (surahPaused) { lastProgressAt = Date.now(); startedAt = Date.now(); return; }
        let progressed = false;
        try {
          const buf = (el.buffered && el.buffered.length) ? el.buffered.end(el.buffered.length - 1) : 0;
          if (buf > lastBuffered || el.currentTime > lastTime) { progressed = true; lastBuffered = buf; lastTime = el.currentTime; }
        } catch (e) {}
        if (progressed) { lastProgressAt = Date.now(); return; }
        if (Date.now() - lastProgressAt >= STALL_MS || Date.now() - startedAt >= HARD_CAP_MS) { clearInterval(timer); next(); }
      }, 1000);
      el.onended = () => {
        if (over || !stillCurrent()) return;
        done(); surahPlayIndex++; playNextInQueue();
      };
      el.onerror = () => {
        if (over || !stillCurrent()) return;
        if (started) { done(); abortEl(); surahPlayIndex++; playNextInQueue(); }
        else next(); // not started yet: try the other URL first
      };
      el.play().then(() => {
        if (!stillCurrent()) { abortEl(); return; }
        started = true; lastProgressAt = Date.now(); // watchdog stays alive: playback progress keeps resetting it
      }).catch(next);
    }
  }
  function stopSurahPlayback() {
    surahPlaying = false;
    surahPaused = false;
    surahPlayQueue = [];
    surahPlayIndex = 0;
    if (audioEl) { audioGen++; audioEl.pause(); audioEl = null; }
    playingKey = null;
    // R-4: button label + progress line reset through the single updater.
    updateSurahProgress();
    document.querySelectorAll('.ayah-card').forEach(c => c.classList.remove('now-playing'));
  }
  function showAudioError(msg, retryFn) {
    // Small toast so the user knows what went wrong (no more silent fail).
    // TEAM 14 (2026-10-19): optional retry button + longer display when a
    // retry action is offered, so the user can act instead of just reading.
    let t = document.getElementById('audio-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'audio-toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#3b1d5e;color:#fff;padding:10px 18px;border-radius:10px;z-index:9999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.3)';
      document.body.appendChild(t);
    }
    t.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    if (typeof retryFn === 'function') {
      const btn = document.createElement('button');
      btn.textContent = '🔁 Dobara try karein';
      btn.style.cssText = 'margin-left:10px;background:#fff;color:#3b1d5e;border:none;border-radius:6px;padding:4px 10px;font-size:13px;cursor:pointer;font-weight:600';
      btn.onclick = () => { t.style.display = 'none'; retryFn(); };
      t.appendChild(btn);
    }
    t.style.display = 'block';
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => { t.style.display = 'none'; }, retryFn ? 8000 : 3500);
  }
  function toggleAudio(btn) {
    const key = btn.dataset.play;
    /* TEAM 3 (2026-10-22): while the full-surah queue runs, the current
       ayah's per-ayah ▶️/⏸️ button MIRRORS the queue — it must not pause the
       raw audio element directly. The old code did exactly that: surahPlaying
       stayed true while audio was paused, the UI kept claiming "playing",
       and 20 s later the stall watchdog treated the silence as a network
       stall and silently skipped to the next ayah. Route through the queue
       controls so state stays single-sourced (updateSurahProgress keeps the
       button icon honest in both directions). */
    if (surahPlaying && key === playingKey) {
      if (surahPaused) resumeSurahPlayback();
      else pauseSurahPlayback();
      return;
    }
    // stop if same ayah playing
    if (playingKey === key && audioEl && !audioEl.paused) {
      audioEl.pause(); btn.textContent = '▶️'; playingKey = null; return;
    }
    // Stop full-surah playback if user taps individual ayah
    if (surahPlaying) stopSurahPlayback();
    // stop previous
    if (audioEl) { audioGen++; audioEl.pause(); }
    document.querySelectorAll('.play-btn').forEach(b => b.textContent = '▶️');
    const [s, a] = key.split(':');
    // Professional: use our proxy FIRST (reliable, correct content-type),
    // fall back to direct everyayah.com on error
    playWithFallback(btn, key, proxyAudioUrl(s, a), audioUrl(s, a));
  }
  /* ---- Audio playback engine (TEAM 5 hardening, 2026-10-18) ----
     Why this rewrite: the old code relied on audioEl.play().catch() and
     audioEl.onerror(). Both miss the most common mobile failure — a STALLED
     connection (slow/blocked network): no promise rejection, no error event,
     just a ⏸️ button that never plays. The old code also checked
     `audioEl.src` inside handlers while audioEl could already point at a NEW
     element (race), and its proxy-onerror branch showed the error toast
     WITHOUT ever trying the fallback URL.
     Rules enforced below:
     - one generation token: stale elements can never hijack a newer play()
     - every attempt gets a 15 s stall timeout (aborts hung connections)
     - proxy failing ALWAYS falls through to the direct everyayah URL
     - the error toast only appears after BOTH urls failed (single-fail guard)
  */
  /* ---- Mobile-safe audio engine (TEAM 12, 2026-10-19) ----
     Replaces the TEAM 5 blind 15 s kill-timer, which murdered healthy-but-slow
     downloads on mobile data: the proxy buffers the whole MP3 server-side, so
     time-to-first-byte on slow networks routinely exceeded 15 s, abortEl()
     then cancelled the in-flight request, and the toast appeared on EVERY tap.
     New behavior: a PROGRESS-AWARE watchdog — it only fires when NO bytes
     arrive for STALL_MS. Bytes arriving on slow mobile data keep resetting it,
     so a healthy download is never killed. play() is still called
     synchronously inside the tap gesture (mobile autoplay requirement) — that
     chain is untouched. Errors are classified: NotAllowedError (policy) gets
     its own honest message instead of blaming the internet (TEAM 14 retry
     toast signature preserved: showAudioError(msg, retryFn)).
  */
  let audioGen = 0;
  const STALL_MS = 20000;          // no BYTES for this long = truly stuck
  const HARD_CAP_MS = 90000;       // absolute give-up per URL (slow-data safety)
  function playWithFallback(btn, key, primaryUrl, fallbackUrl) {
    const gen = ++audioGen;
    const stillCurrent = () => gen === audioGen;
    function failAttempt(kind) {
      if (!stillCurrent()) return;
      btn.textContent = '▶️'; playingKey = null;
      if (kind === 'policy') {
        showAudioError('🔊 Audio block ho gaya — dobara tap karein', () => toggleAudio(btn));
      } else {
        showAudioError('⚠️ Audio nahi chal saka (donon sources fail)', () => toggleAudio(btn));
      }
    }
    function classifyErr(err) {
      return (err && err.name === 'NotAllowedError') ? 'policy' : 'network';
    }
    function tryUrl(url, isFallback) {
      if (!stillCurrent()) return;
      const el = new Audio(url);
      el.preload = 'auto';
      audioEl = el; playingKey = key;
      btn.textContent = '⏳';           // honest loading state on slow data
      let started = false, over = false, lastProgress = Date.now();
      const done = () => { over = true; clearTimeout(watchdog); clearTimeout(hardCap); };
      const touchProgress = () => { lastProgress = Date.now(); };
      function abortEl() {
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
      }
      function fail(kind) {
        // Failed BEFORE audible playback: try the other URL, else toast.
        if (over || !stillCurrent()) return;
        done(); abortEl();
        if (kind === 'policy') { failAttempt('policy'); return; } // retrying won't help
        if (!isFallback) tryUrl(fallbackUrl, true);
        else failAttempt('network');
      }
      // Progress-aware watchdog: fires only if NO bytes arrive for STALL_MS.
      let watchdog;
      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (over || started || !stillCurrent()) return;
          if (Date.now() - lastProgress >= STALL_MS) fail('network');
          else armWatchdog();          // progress happened; keep waiting
        }, STALL_MS);
      };
      const hardCap = setTimeout(() => { if (!over && !started) fail('network'); }, HARD_CAP_MS);
      armWatchdog();
      el.addEventListener('progress', touchProgress);
      el.onended = () => {
        if (over || !stillCurrent()) return;
        done(); btn.textContent = '▶️'; playingKey = null;
      };
      el.onerror = () => {
        if (over || !stillCurrent()) return;
        if (!started) { fail('network'); return; }
        done(); abortEl();
        btn.textContent = '▶️'; playingKey = null;
        showAudioError('⚠️ Audio ruk gaya — dobara try karein', () => toggleAudio(btn));
      };
      // NOTE: called synchronously inside the tap gesture — required by
      // mobile autoplay policies. Do NOT move behind await/fetch.
      el.play().then(() => {
        if (!stillCurrent()) { abortEl(); return; }
        started = true; done();       // playing: watchdogs no longer needed
        btn.textContent = '⏸️';
      }).catch(err => fail(classifyErr(err)));
    }
    tryUrl(primaryUrl, false);
  }

  /* ---------------- bookmarks (localStorage) ---------------- */
  function getBookmarks() {
    try { return JSON.parse(localStorage.getItem('qs-bookmarks') || '[]'); }
    catch (e) { return []; }
  }
  function saveBookmarks(list) {
    try { localStorage.setItem('qs-bookmarks', JSON.stringify(list)); } catch (e) {}
  }
  /* LEAD 2026-11-04: Collections — re-render the Sab group after a local
     bookmark change (collections read qs-bookmarks live on each render). */
  function refreshCollections() {
    if (window.qsCollections && typeof window.qsCollections.renderCollections === 'function') {
      const g = $('collections-grid');
      if (g) window.qsCollections.renderCollections(g);
    }
  }
  function toggleBookmark(key, btn) {
    let list = getBookmarks();
    const i = list.indexOf(key);
    if (i >= 0) { list.splice(i, 1); btn.classList.remove('active'); }
    else { list.push(key); btn.classList.add('active'); }
    saveBookmarks(list);
    refreshCollections();
  }
  function paintBookmarks() {
    const list = getBookmarks();
    document.querySelectorAll('.bookmark-btn').forEach(b =>
      b.classList.toggle('active', list.includes(b.dataset.bm)));
    renderBookmarkGrid(list);
  }
  async function renderBookmarkGrid(list) {
    const grid = $('bookmark-grid');
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '<p class="muted small">No bookmarks yet. Tap 🔖 on any ayah to save it here.</p>';
      return;
    }
    // R-6 (DESIGN AUDIT 2026-10-22): the old code awaited up to 50 surah
    // fetches ONE AT A TIME — total wait was the SUM of all requests, which
    // felt broken on Pakistani mobile data. Promise.all fires them all at
    // once, so the wait is only as long as the SLOWEST request. Order is
    // preserved (Promise.all keeps results in input order) and each fetch
    // still fails independently (null = skipped, not fatal).
    // FYP STUDY GUIDE: sequential await in a loop = latency adds up;
    // Promise.all = latency overlaps. Same N requests, ~N× faster when the
    // server can handle concurrency (ours can — it's just JSON reads).
    grid.innerHTML = '<p class="muted small">Loading…</p>';
    const results = await Promise.all(list.slice(0, 50).map(async key => {  // cap at 50 for performance
      const [s, a] = key.split(':').map(Number);
      try {
        const r = await fetch('/api/quran/surah/' + s);
        if (!r.ok) return null;
        const d = await r.json();
        const ayah = (d.ayahs || []).find(x => x.ayah === a);
        if (!ayah) return null;
        return '<div class="bookmark-card" data-goto="' + s + '">'
          + '<bdi><strong>' + s + ':' + a + '</strong></bdi>'
          + '<div class="arabic small" dir="rtl">' + esc(ayah.arabic) + '</div>'
          + '<p class="muted small">' + esc((ayah.translation_en || '').slice(0, 120)) + '…</p>'
          + '<button class="btn btn-ghost btn-sm" data-ungoto="' + key + '">Remove</button>'
          + '</div>';
      } catch (e) { return null; }  // one failed bookmark never kills the grid
    }));
    const cards = results.filter(Boolean);
    grid.innerHTML = cards.join('') || '<p class="muted small">Could not load bookmarks.</p>';
    grid.querySelectorAll('[data-goto]').forEach(c =>
      c.addEventListener('click', e => {
        if (e.target.closest('[data-ungoto]')) return;
        openSurah(+c.dataset.goto);
        $('reader').scrollIntoView({ behavior: 'smooth' });
      }));
    grid.querySelectorAll('[data-ungoto]').forEach(b =>
      b.addEventListener('click', e => {
        e.stopPropagation();
        const key = b.dataset.ungoto;
        const l = getBookmarks().filter(x => x !== key);
        saveBookmarks(l);
        paintBookmarks();
        refreshCollections();
      }));
  }

  /* ---------------- share ayat as image ---------------- */
  function shareAyah(key) {
    const [s, a] = key.split(':');
    const card = document.getElementById('ayah-' + a);
    if (!card) return;
    const arabic = card.querySelector('.ayah-arabic').textContent.trim();
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1080;
    const x = c.getContext('2d');
    // background gradient
    const g = x.createLinearGradient(0, 0, 0, 1080);
    g.addColorStop(0, '#1a0f2e'); g.addColorStop(1, '#2d1a4e');
    x.fillStyle = g; x.fillRect(0, 0, 1080, 1080);
    // gold border
    x.strokeStyle = '#d4af6a'; x.lineWidth = 6;
    x.strokeRect(40, 40, 1000, 1000);
    // arabic text (wrapped)
    x.fillStyle = '#f5efe0'; x.textAlign = 'center';
    x.font = '64px "Amiri Quran", serif';
    wrapText(x, arabic, 540, 380, 920, 95);
    // reference
    x.fillStyle = '#d4af6a'; x.font = '42px sans-serif';
    x.fillText('Quran ' + s + ':' + a + '  •  Quran Shazam', 540, 950);
    const url = c.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'quran-' + s + '-' + a + '.png';
    link.href = url; link.click();
  }
  function wrapText(x, text, cx, y, maxW, lh) {
    const words = text.split(' ');
    let line = '', yy = y;
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (x.measureText(t).width > maxW && line) { x.fillText(line, cx, yy); line = w; yy += lh; }
      else line = t;
    }
    if (line) x.fillText(line, cx, yy);
  }

  /* ---------------- wire up ---------------- */

  /* ---------------- search ---------------- */
  let searchTimer = null;
  async function doSearch() {
    const q = $('quran-search').value.trim();
    const box = $('search-results');
    // R-5 (DESIGN AUDIT 2026-10-22): Arabic words are short — a 3-char
    // minimum makes Arabic search useless. Arabic-script input searches at
    // 2+ chars; Latin keeps the 3-char minimum to avoid noise.
    const isArabicQuery = /[\u0600-\u06FF]/.test(q);
    if (q.length < (isArabicQuery ? 2 : 3)) { box.hidden = true; box.innerHTML = ''; return; }
    const lang = document.querySelector('input[name="search-lang"]:checked').value;
    try {
      const r = await fetch('/api/quran/search?q=' + encodeURIComponent(q) + '&lang=' + lang);
      const data = await r.json();
      const res = data.results || [];
      box.hidden = false;
      box.innerHTML = res.length
        ? '<p class="muted small">' + res.length + ' results</p>' + res.map(x =>
            '<button class="search-hit" data-s="' + x.surah + '" data-a="' + x.ayah + '">'
            /* TEAM 4 (2026-10-22, RTL audit): <bdi> isolates the ref; the
               translation snippet gets .tr-ayah-text so on phones it becomes
               its own block with direction-correct alignment — an inline RTL
               span inside the text-align:left button wrapped ragged. */
            + '<bdi><strong>' + x.surah + ':' + x.ayah + '</strong></bdi> '
            // R-5: the backend returns `arabic` per hit — show it (RTL) ABOVE
            // the translation, so Arabic searchers can verify their matches.
            + (x.arabic ? '<span class="search-arabic" dir="rtl">' + esc(String(x.arabic).slice(0, 160)) + '</span>' : '')
            + '<span class="tr-ayah-text" dir="' + (lang === 'ur' ? 'rtl' : 'ltr') + '">' + esc(x.translation.slice(0, 140)) + '…</span>'
            + '</button>').join('')
        : '<p class="muted">No matches.</p>';
      box.querySelectorAll('.search-hit').forEach(b => b.addEventListener('click', async () => {
        clearAyahHighlights();   // R-10: remove the old gold ring first
        await openSurah(+b.dataset.s);
        setTimeout(() => {
          const el = $('ayah-' + b.dataset.a);
          if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight'); if (window.qsResume) window.qsResume.savePosition(+b.dataset.s, +b.dataset.a); }
        }, 300);
      }));
    } catch (e) {
      // R-10 (DESIGN AUDIT 2026-10-22): search errors were swallowed with an
      // empty catch — the user saw nothing and assumed zero results. Be honest.
      box.hidden = false;
      box.innerHTML = '<p class="muted">Search failed — try again. / Search nakaam ho gayi — dobara koshish karein.</p>';
    }
  }

  // R-3 (DESIGN AUDIT 2026-10-22): jump to a specific ayah in long surahs.
  // FYP STUDY GUIDE: element IDs are predictable ('ayah-255'), so jumping is
  // a scrollIntoView + a temporary gold ring. The ring auto-clears after 3s
  // so stale highlights never pile up (same idea as R-10 above).
  function clearAyahHighlights() {
    document.querySelectorAll('.ayah.highlight').forEach(x => x.classList.remove('highlight'));
  }
  function jumpToAyah() {
    const input = $('ayah-jump-input');
    if (!input || !lastData) return;
    const n = parseInt(input.value, 10);
    if (!n || n < 1 || n > lastData.ayah_count) { input.focus(); input.select(); return; }
    clearAyahHighlights();
    const el = $('ayah-' + n);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight');
      /* LEAD 2026-11-04: Resume — exact ayah position. */
      if (window.qsResume && typeof window.qsResume.savePosition === 'function') window.qsResume.savePosition(currentSurah, n);
      clearTimeout(jumpToAyah._t);
      jumpToAyah._t = setTimeout(() => el.classList.remove('highlight'), 3000);
    }
  }

  document.querySelectorAll('.lang-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.lang-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentLang = b.dataset.lang;
    if (lastData) renderAyahs(lastData);
  }));
  $('surah-filter').addEventListener('input', e => renderGrid(e.target.value));
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    revFilter = c.dataset.rev;
    renderGrid($('surah-filter').value);
  }));
  $('reader-back').addEventListener('click', closeReader);
  $('prev-surah').addEventListener('click', () => { if (currentSurah > 1) { lastData = null; openSurah(currentSurah - 1); } });
  $('next-surah').addEventListener('click', () => { if (currentSurah < 114) { lastData = null; openSurah(currentSurah + 1); } });
  $('toggle-tafseer').addEventListener('change', e => {
    showTafseer = e.target.checked;
    if (lastData) renderAyahs(lastData);
  });
  $('toggle-translit').addEventListener('change', e => {
    showTranslit = e.target.checked;
    if (lastData) renderAyahs(lastData);
  });
  $('toggle-hifz').addEventListener('change', e => {
    hifzMode = e.target.checked;
    if (lastData) renderAyahs(lastData);
  });

  /* Tafseer buttons: toggle panel + language tabs (event delegation) */
  $('ayah-list').addEventListener('click', e => {
    // Play tilawat audio
    const playBtn = e.target.closest('.play-btn');
    if (playBtn) { toggleAudio(playBtn); return; }
    // Bookmark
    const bmBtn = e.target.closest('.bookmark-btn');
    if (bmBtn) { toggleBookmark(bmBtn.dataset.bm, bmBtn); return; }
    // Share as image
    const shareBtn = e.target.closest('.share-btn');
    if (shareBtn) { shareAyah(shareBtn.dataset.share); return; }
    // Hifz reveal
    const revealBtn = e.target.closest('.hifz-reveal');
    if (revealBtn) {
      const card = revealBtn.closest('.ayah');
      card.querySelector('.ayah-arabic').classList.remove('hifz-hidden');
      revealBtn.remove();
      return;
    }
    const btn = e.target.closest('.tafseer-btn');
    if (btn) {
      const panel = $('tafseer-' + btn.dataset.ayah);
      if (panel) {
        const willShow = panel.hidden;
        panel.hidden = !willShow;
        btn.classList.toggle('open', willShow);
        btn.textContent = willShow ? '📖 Tafseer band karein' : '📖 Tafseer parhein';
        // Professional: fetch tafseer on-demand (not pre-loaded with surah).
        // This keeps surah pages fast; tafseer loads only when requested.
        if (willShow && !panel.dataset.loaded) {
          panel.dataset.loaded = '1';
          const surahNum = currentSurah || 1;
          fetch('/api/quran/tafseer/' + surahNum + '/' + btn.dataset.ayah)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              const enBody = panel.querySelector('[data-tbody="en"]');
              const urBody = panel.querySelector('[data-tbody="ur"]');
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
            .catch(() => {
              panel.querySelector('[data-tbody="en"]').innerHTML = '<p class="muted">Failed to load. Try again.</p>';
            });
        }
      }
      return;
    }
    const tab = e.target.closest('.tafseer-tab');
    if (tab) {
      const panel = tab.closest('.tafseer-panel');
      panel.querySelectorAll('.tafseer-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const lang = tab.dataset.tlang;
      panel.querySelectorAll('.tafseer-body').forEach(b => {
        b.hidden = b.dataset.tbody !== lang;
      });
    }
  });
  $('font-inc').addEventListener('click', () => { arabicSize = Math.min(2.4, arabicSize + 0.15); if (lastData) renderAyahs(lastData); });
  $('font-dec').addEventListener('click', () => { arabicSize = Math.max(1.1, arabicSize - 0.15); if (lastData) renderAyahs(lastData); });
  // R-3: ayah jump — Go button + Enter key.
  const jumpGo = $('ayah-jump-go'), jumpInput = $('ayah-jump-input');
  if (jumpGo) jumpGo.addEventListener('click', jumpToAyah);
  if (jumpInput) jumpInput.addEventListener('keydown', e => { if (e.key === 'Enter') jumpToAyah(); });
  $('quran-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 400);
  });
  document.querySelectorAll('input[name="search-lang"]').forEach(r =>
    r.addEventListener('change', doSearch));

  // Qari picker (custom bottom-sheet) + full surah playback
  loadQaris();
  const qariBtn = $('qari-picker-btn');
  if (qariBtn) qariBtn.addEventListener('click', openQariSheet);
  const qariClose = $('qari-sheet-close');
  if (qariClose) qariClose.addEventListener('click', closeQariSheet);
  const qariBackdrop = $('qari-sheet-backdrop');
  if (qariBackdrop) qariBackdrop.addEventListener('click', closeQariSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQariSheet(); });
  const playSurahBtn = $('play-surah-btn');
  if (playSurahBtn) playSurahBtn.addEventListener('click', playFullSurah);

  loadSurahs();
  /* LEAD 2026-11-04: Resume deep link — the home "Jari rakhen" card links to
     /quran?surah=N&ayah=A. Honour it: open the surah, then jump + highlight.
     600 ms gives the first surah fetch time on a fresh load; if the ayah
     element is still missing the jump is skipped silently (no fake state). */
  (function () {
    try {
      const p = new URLSearchParams(window.location.search);
      const s = parseInt(p.get('surah'), 10);
      if (!s || s < 1 || s > 114) return;
      const a = parseInt(p.get('ayah'), 10) || 0;
      openSurah(s);
      if (a >= 1) setTimeout(() => {
        const el = $('ayah-' + a);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight');
          if (window.qsResume) window.qsResume.savePosition(s, a);
        }
      }, 600);
    } catch (e) { /* invalid query params must never break the Reader */ }
  })();
  // Expose for voice Q&A "open surah" button
  window.qsOpenSurah = openSurah;
  /* TEAM 3 (2026-10-22): bookmarks.js also renders #bookmark-grid — expose
     the RICH renderer (Arabic previews + Remove buttons) so its refresh loop
     can delegate instead of overwriting rich cards with the plain list. */
  window.qsRenderBookmarksRich = paintBookmarks;
})();
