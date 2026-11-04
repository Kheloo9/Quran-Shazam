/* qs-notes.js — Per-ayah Notes (NOTES team).
 *
 * Storage: localStorage key 'qs-notes', a JSON object mapping
 * "surah:ayah" -> note text, e.g. { "112:1": "Read this daily." }.
 * Notes are capped at 500 characters. Corrupt stored JSON resets to
 * an empty object instead of crashing.
 *
 * Privacy: everything stays in the browser's localStorage only, exactly
 * like bookmarks — nothing is sent to the server.
 * Audio behaviour is untouched: this file never plays or changes audio.
 *
 * Lead hooks (the lead wires these up; this file never edits quran.js):
 *  - After renderAyahs() runs, call window.qsNotes.paintNoteButtons()
 *    so every visible ayah card gets its 📝 button.
 *  - On the /quran page, call window.qsNotes.renderNotesList(container)
 *    with the notes container (planned id #notes-grid inside
 *    #notes-section). This file never assumes that container exists
 *    at load time — renderNotesList() simply no-ops on a null container,
 *    and save/delete re-render it only if it was rendered before.
 *
 * Rendering safety: user note text is NEVER put into innerHTML
 * unescaped. The notes list is built with esc() (below) for every
 * user-supplied string, and the editor modal is built entirely with
 * document.createElement + textContent/value (no innerHTML at all).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'qs-notes';
  var MAX_LEN = 500;
  var KEY_RE = /^[0-9]+:[0-9]+$/;

  /* The container renderNotesList() last rendered into, if any. Used so
     save/delete can refresh the list without the lead re-calling it. */
  var lastNotesContainer = null;

  /* Escape &, <, >, " and ' for safe use inside innerHTML strings. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isValidKey(key) {
    return typeof key === 'string' && KEY_RE.test(key);
  }

  /* Read all notes. Corrupt / non-object stored JSON resets to {}.
     Returns a fresh object each call so callers cannot mutate the
     stored state by accident. Over-long or non-string values (only
     possible if storage was tampered with by hand) are dropped /
     truncated on read; normal writes are already capped in saveNote. */
  function getNotes() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return {};
    }
    if (!raw) return {};
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      /* Corrupt JSON: reset to empty, never crash. Best effort to
         clear the bad value so the next read is clean. */
      try { localStorage.removeItem(STORAGE_KEY); } catch (e2) {}
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      return {};
    }
    var out = {};
    Object.keys(parsed).forEach(function (k) {
      if (!isValidKey(k)) return;
      if (typeof parsed[k] !== 'string') return;
      var v = parsed[k].trim().slice(0, MAX_LEN);
      if (v) out[k] = v;
    });
    return out;
  }

  /* Persist a notes object. Returns false if storage fails (e.g. the
     browser blocked localStorage or the quota is full) instead of
     throwing into the caller. */
  function persist(notes) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Refresh every surface a note change affects: the 📝 buttons on the
     visible ayah cards, and the notes list if one is currently shown. */
  function refreshNotesUI() {
    paintNoteButtons();
    if (lastNotesContainer) {
      if (typeof document !== 'undefined' && document.contains(lastNotesContainer)) {
        renderNotesList(lastNotesContainer);
      } else {
        /* Container was removed from the page; stop tracking it. */
        lastNotesContainer = null;
      }
    }
  }

  function hasNote(key) {
    if (!isValidKey(key)) return false;
    var notes = getNotes();
    return typeof notes[key] === 'string' && notes[key].trim().length > 0;
  }

  /* Save a note. The text is trimmed and capped at 500 chars; an empty
     (or whitespace-only) text deletes the note instead. Saving an
     existing note moves it to the end of the object, so the newest
     (most recently written) note sorts first in renderNotesList().
     Returns true on success, false on a bad key or storage failure. */
  function saveNote(key, text) {
    if (!isValidKey(key)) return false;
    var clean = String(text == null ? '' : text).trim().slice(0, MAX_LEN);
    if (!clean) return deleteNote(key);
    var notes = getNotes();
    if (Object.prototype.hasOwnProperty.call(notes, key)) delete notes[key];
    notes[key] = clean;
    if (!persist(notes)) return false;
    refreshNotesUI();
    return true;
  }

  /* Delete a note. Returns true if a note existed and was removed. */
  function deleteNote(key) {
    if (!isValidKey(key)) return false;
    var notes = getNotes();
    if (!Object.prototype.hasOwnProperty.call(notes, key)) return false;
    delete notes[key];
    if (!persist(notes)) return false;
    refreshNotesUI();
    return true;
  }

  /* Work out the "surah:ayah" key for an ayah card. The bookmark/play/
     share buttons rendered by quran.js already carry it (data-bm,
     data-play, data-share), so read it from there — this file never
     guesses the surah from the card id alone (id="ayah-N" has no
     surah in it). Cards with no usable key are skipped. */
  function keyForCard(card) {
    var btn = card.querySelector('.bookmark-btn')
      || card.querySelector('.play-btn')
      || card.querySelector('.share-btn');
    if (!btn) return null;
    var key = btn.getAttribute('data-bm')
      || btn.getAttribute('data-play')
      || btn.getAttribute('data-share');
    return isValidKey(key) ? key : null;
  }

  /* Append a 📝 button to every visible ayah card that does not have
     one yet, and refresh the 'active' state of all of them (active =
     a note exists for that ayah). No-op when #ayah-list is absent,
     e.g. on pages other than the Reader. Safe to call repeatedly:
     existing buttons are never duplicated. */
  function paintNoteButtons() {
    if (typeof document === 'undefined') return;
    var list = document.getElementById('ayah-list');
    if (!list) return;
    var notes = getNotes();
    list.querySelectorAll('.ayah-card').forEach(function (card) {
      var btns = card.querySelector('.ayah-btns');
      if (!btns) return;
      var key = keyForCard(card);
      if (!key) return;
      var btn = btns.querySelector('.note-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'icon-btn note-btn';
        btn.type = 'button';
        btn.setAttribute('data-note', key);
        btn.title = 'Note';
        btn.setAttribute('aria-label', 'Note for ' + key);
        btn.textContent = '📝';
        btn.addEventListener('click', function () {
          openNoteEditor(btn.getAttribute('data-note'));
        });
        btns.appendChild(btn);
      } else {
        /* Keep the key in sync in case the card was re-rendered. */
        btn.setAttribute('data-note', key);
      }
      btn.classList.toggle('active', !!notes[key]);
    });
  }

  /* Jump to an ayah the way search-hit navigation does: open the surah,
     wait 300ms for it to render, then scroll the ayah into view and
     highlight it. A missing qsOpenSurah still attempts the scroll. */
  function jumpToAyah(s, a) {
    var open = window.qsOpenSurah;
    var go = function () {
      setTimeout(function () {
        var el = document.getElementById('ayah-' + a);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight');
        }
      }, 300);
    };
    if (typeof open === 'function') {
      try {
        var r = open(s);
        if (r && typeof r.then === 'function') r.then(go, go);
        else go();
      } catch (e) {
        go();
      }
    } else {
      go();
    }
  }

  /* Render one card per note, newest first, into `container`.
     No-op if container is null (the lead may not have mounted
     #notes-grid yet). Empty state per spec. */
  function renderNotesList(container) {
    if (!container) return;
    lastNotesContainer = container;
    var notes = getNotes();
    /* Object insertion order is oldest-first, so reverse for newest. */
    var keys = Object.keys(notes).reverse();
    if (!keys.length) {
      container.innerHTML = '<p class="muted">No notes yet. Tap 📝 on any ayah.</p>';
      return;
    }
    container.innerHTML = keys.map(function (key) {
      var parts = key.split(':');
      return '<div class="note-card">'
        + '<strong>' + esc(parts[0]) + ':' + esc(parts[1]) + '</strong>'
        + '<p class="note-text">' + esc(notes[key]) + '</p>'
        + '<div class="note-card-actions">'
        + '<button type="button" class="btn btn-sm" data-note-action="open" data-note="' + esc(key) + '">Open</button>'
        + '<button type="button" class="btn btn-sm btn-ghost" data-note-action="delete" data-note="' + esc(key) + '">Delete</button>'
        + '</div></div>';
    }).join('');
    container.querySelectorAll('[data-note-action]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-note');
        if (!isValidKey(key)) return;
        if (b.getAttribute('data-note-action') === 'delete') {
          deleteNote(key);
        } else {
          var parts = key.split(':');
          jumpToAyah(+parts[0], +parts[1]);
        }
      });
    });
  }

  /* Close the note editor modal, if one is open. */
  function closeNoteEditor() {
    var overlay = document.querySelector('.note-dialog-overlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (closeNoteEditor._onKey) {
      document.removeEventListener('keydown', closeNoteEditor._onKey);
      closeNoteEditor._onKey = null;
    }
  }

  /* Build the note editor modal ENTIRELY dynamically — no template
     changes needed. Prefilled with the existing note (if any). Save
     stores the trimmed text (empty = delete); Delete shows only when
     a note exists; Cancel / overlay click / Escape close without
     saving. After save/delete, button states and the notes list (if
     rendered) refresh via saveNote/deleteNote. */
  function openNoteEditor(key) {
    if (!isValidKey(key)) return;
    closeNoteEditor();

    var existing = getNotes()[key] || '';

    var overlay = document.createElement('div');
    overlay.className = 'note-dialog-overlay';

    var dialog = document.createElement('div');
    dialog.className = 'note-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Note for ' + key);

    var title = document.createElement('h3');
    title.className = 'note-dialog-title';
    title.textContent = 'Note — ' + key;
    dialog.appendChild(title);

    var textarea = document.createElement('textarea');
    textarea.className = 'note-textarea';
    textarea.maxLength = MAX_LEN;
    textarea.rows = 5;
    textarea.placeholder = 'Write your note here…';
    textarea.setAttribute('aria-label', 'Note text');
    textarea.value = existing;
    dialog.appendChild(textarea);

    var count = document.createElement('p');
    count.className = 'muted small note-char-count';
    count.textContent = textarea.value.length + ' / ' + MAX_LEN;
    dialog.appendChild(count);
    textarea.addEventListener('input', function () {
      count.textContent = textarea.value.length + ' / ' + MAX_LEN;
    });

    var actions = document.createElement('div');
    actions.className = 'note-dialog-actions';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function () {
      saveNote(key, textarea.value);
      closeNoteEditor();
    });
    actions.appendChild(saveBtn);

    if (existing) {
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-ghost';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', function () {
        deleteNote(key);
        closeNoteEditor();
      });
      actions.appendChild(delBtn);
    }

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeNoteEditor);
    actions.appendChild(cancelBtn);

    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    /* Clicking the backdrop (not the dialog itself) closes. */
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeNoteEditor();
    });
    document.body.appendChild(overlay);

    closeNoteEditor._onKey = function (e) {
      if (e.key === 'Escape') closeNoteEditor();
    };
    document.addEventListener('keydown', closeNoteEditor._onKey);

    textarea.focus();
    try { textarea.setSelectionRange(textarea.value.length, textarea.value.length); } catch (e) {}
  }

  window.qsNotes = {
    getNotes: getNotes,
    saveNote: saveNote,
    deleteNote: deleteNote,
    hasNote: hasNote,
    paintNoteButtons: paintNoteButtons,
    renderNotesList: renderNotesList,
    openNoteEditor: openNoteEditor
  };
})();
