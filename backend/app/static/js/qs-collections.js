/* qs-collections.js — Named bookmark Collections for the Reader (/quran).
 *
 * COLLECTIONS TEAM — this file is the team's ONLY deliverable. It does not
 * edit, or depend on edits to, quran.js, any template, or any CSS file.
 * It is loaded as a plain <script> (no module system) and exposes exactly
 * one global: window.qsCollections (see the bottom of this file).
 *
 * RULES HONOURED HERE
 * - All user data stays in the browser's localStorage only, never server-side.
 * - Audio behaviour is untouched: this file plays, pauses and records nothing.
 * - Mobile-first: only small buttons / cards, no layout assumptions.
 * - Every localStorage JSON parse/set is wrapped in try/catch.
 * - No unescaped user text ever goes into innerHTML: collection names are
 *   inserted with textContent, and ayah text goes through esc() below.
 * - Bookmark add/remove behaviour is NEVER changed: this file only READS
 *   the existing 'qs-bookmarks' key. It never writes to it.
 *
 * STORAGE
 * - 'qs-collections': JSON array of { id, name, keys }, where keys is an
 *   array of "surah:ayah" strings, e.g. "112:1". This holds NAMED
 *   collections only — never a copy of the bookmarks themselves.
 * - 'qs-bookmarks': the existing bookmark list. The default collection
 *   "Sab" reads this key LIVE on every render, so a bookmark added or
 *   removed elsewhere shows up here automatically, and removing a key
 *   from a named collection never removes the bookmark itself.
 *
 * NEW CSS CLASSES USED (the lead writes the CSS for these; everything
 * else reuses existing classes: .btn, .btn-ghost, .btn-sm, .muted,
 * .small, .bookmark-card):
 * - .qs-collection-group    : one <section> per collection group
 * - .qs-collection-head     : group header row (name + count)
 * - .qs-collection-actions  : Rename/Delete button row for named groups
 * - .qs-collection-cards    : wrapper for a group's ayah cards
 * - .qs-assign-overlay      : full-screen backdrop for the assign dialog
 * - .qs-assign-dialog       : the assign dialog box itself
 * - .qs-assign-list         : checkbox list of existing collections
 * - .qs-assign-row          : one row (checkbox + name) in that list
 * - .qs-assign-input        : the "new collection" name <input>
 */
(function () {
  'use strict';

  var COLLECTIONS_KEY = 'qs-collections';
  var BOOKMARKS_KEY = 'qs-bookmarks';
  var MAX_NAME_LEN = 40;   // collection names are capped at 40 characters
  var MAX_CARDS = 50;      // per-group card cap, mirroring renderBookmarkGrid
  var SAB_ID = 'sab';      // pseudo-id of the default group (never stored)

  /* Incremented on every renderCollections() call. Async card fetches
     check it before painting, so a stale render can never overwrite a
     newer one (e.g. after a rapid Remove -> re-render). */
  var renderSeq = 0;

  /* ---------------- small helpers ---------------- */

  // Own esc() helper: escape &, <, >, ", ' — never put raw user text
  // (collection names, ayah text, translations) into innerHTML.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // A valid bookmark key: "surah:ayah", both positive integers, surah 1-114.
  function parseKey(key) {
    if (typeof key !== 'string') return null;
    var parts = key.split(':');
    if (parts.length !== 2) return null;
    var s = parseInt(parts[0], 10);
    var a = parseInt(parts[1], 10);
    if (!s || !a || s < 1 || s > 114) return null;
    if (String(s) !== parts[0] || String(a) !== parts[1]) return null;
    return [s, a];
  }

  function isValidKey(key) { return parseKey(key) !== null; }

  // Clean a raw name: trim, cap at 40 chars. Returns '' for empty/invalid.
  function cleanName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().slice(0, MAX_NAME_LEN);
  }

  function newId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* fall through to the fallback below */ }
    return 'c-' + Date.now().toString(36) + '-'
      + Math.random().toString(36).slice(2, 10);
  }

  /* ---------------- storage: named collections ---------------- */

  // Load named collections. Corrupt JSON (or a non-array) resets to empty
  // and never crashes; malformed entries are dropped, valid ones kept.
  function loadCollections() {
    var raw;
    try { raw = localStorage.getItem(COLLECTIONS_KEY); }
    catch (e) { return []; }
    if (raw == null || raw === '') return [];
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      // Corrupt JSON: reset the stored value to empty, then return empty.
      try { localStorage.setItem(COLLECTIONS_KEY, '[]'); } catch (e2) {}
      return [];
    }
    if (!Array.isArray(parsed)) {
      try { localStorage.setItem(COLLECTIONS_KEY, '[]'); } catch (e) {}
      return [];
    }
    var out = [];
    parsed.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var name = cleanName(c.name);
      if (!name || typeof c.id !== 'string' || !c.id) return;
      if (!Array.isArray(c.keys)) return;
      var keys = [];
      c.keys.forEach(function (k) {
        if (isValidKey(k) && keys.indexOf(k) === -1) keys.push(k);
      });
      out.push({ id: c.id, name: name, keys: keys });
    });
    return out;
  }

  // Save named collections. Returns true on success, false on failure
  // (e.g. storage full / private mode) — callers report failure, not crash.
  function saveCollections(list) {
    try {
      localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- storage: bookmarks ("Sab" source of truth) ---------------- */

  // Read 'qs-bookmarks' LIVE every time: this is the default collection
  // "Sab". Bookmarks are never copied into 'qs-collections', so this list
  // can never go stale, and nothing here can change bookmark behaviour.
  function getSabKeys() {
    var raw;
    try { raw = localStorage.getItem(BOOKMARKS_KEY); }
    catch (e) { return []; }
    if (raw == null || raw === '') return [];
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    var out = [];
    parsed.forEach(function (k) {
      if (isValidKey(k) && out.indexOf(k) === -1) out.push(k);
    });
    return out;
  }

  /* ---------------- public API: CRUD ---------------- */

  // Returns a deep-ish copy, so callers mutating the result cannot corrupt
  // stored data. Named collections only — "Sab" is not stored, see above.
  function getCollections() {
    return loadCollections().map(function (c) {
      return { id: c.id, name: c.name, keys: c.keys.slice() };
    });
  }

  // Returns the new collection object, or null if the name is empty
  // (after trimming) or the save failed.
  function createCollection(name) {
    var clean = cleanName(name);
    if (!clean) return null;
    var list = loadCollections();
    var col = { id: newId(), name: clean, keys: [] };
    list.push(col);
    if (!saveCollections(list)) return null;
    return { id: col.id, name: col.name, keys: [] };
  }

  // Returns true if renamed, false if the id is unknown, the name is
  // empty (after trimming), or the save failed. Empty names are rejected,
  // never stored — a failed rename leaves the old name untouched.
  function renameCollection(id, name) {
    var clean = cleanName(name);
    if (!clean) return false;
    var list = loadCollections();
    var found = false;
    list.forEach(function (c) { if (c.id === id) { c.name = clean; found = true; } });
    if (!found) return false;
    return saveCollections(list);
  }

  // Returns true if a collection was deleted, false if the id is unknown
  // or the save failed. Deleting a collection NEVER touches bookmarks.
  function deleteCollection(id) {
    var list = loadCollections();
    var next = list.filter(function (c) { return c.id !== id; });
    if (next.length === list.length) return false;
    return saveCollections(next);
  }

  // Add a key to a named collection (no duplicates within a collection).
  // Returns true if the key is now in the collection (including when it
  // was already there), false if the id/key is invalid or save failed.
  // The "Sab" pseudo-id is not a stored collection: returns false for it.
  function addToCollection(id, key) {
    if (!isValidKey(key) || id === SAB_ID) return false;
    var list = loadCollections();
    var target = null;
    list.forEach(function (c) { if (c.id === id) target = c; });
    if (!target) return false;
    if (target.keys.indexOf(key) === -1) {
      target.keys.push(key);
      return saveCollections(list);
    }
    return true; // already present — no duplicate created
  }

  // Remove a key from a named collection ONLY. The bookmark itself is
  // untouched (this never writes to 'qs-bookmarks'). Returns true if the
  // key is now absent (including when it was never there), false if the
  // id/key is invalid or the save failed. "Sab" has no remove: false.
  function removeFromCollection(id, key) {
    if (!isValidKey(key) || id === SAB_ID) return false;
    var list = loadCollections();
    var target = null;
    list.forEach(function (c) { if (c.id === id) target = c; });
    if (!target) return false;
    var idx = target.keys.indexOf(key);
    if (idx !== -1) {
      target.keys.splice(idx, 1);
      return saveCollections(list);
    }
    return true; // already absent
  }

  /* ---------------- navigation: open one ayah ---------------- */

  // Same jump as search-hit navigation: open the surah, wait 300 ms for
  // it to render, then scroll the ayah into view (centred) and highlight
  // it. The highlight auto-clears after 3 s, mirroring jumpToAyah.
  // If the reader opener is not available, this safely does nothing.
  async function openAyah(key) {
    var parsed = parseKey(key);
    if (!parsed) return;
    if (typeof window.qsOpenSurah !== 'function') return;
    var s = parsed[0], a = parsed[1];
    document.querySelectorAll('.ayah.highlight').forEach(function (x) {
      x.classList.remove('highlight');
    });
    try { await window.qsOpenSurah(s); } catch (e) { return; }
    setTimeout(function () {
      var el = document.getElementById('ayah-' + a);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight');
      setTimeout(function () { el.classList.remove('highlight'); }, 3000);
    }, 300);
  }

  /* ---------------- rendering ---------------- */

  // Fetch one ayah's preview, fail-soft: any failure returns null and the
  // card is simply skipped — one bad key never kills the group. Mirrors
  // renderBookmarkGrid: one surah fetch per key, Arabic + English snippet.
  async function fetchCardHtml(key) {
    var parsed = parseKey(key);
    if (!parsed) return null;
    var s = parsed[0], a = parsed[1];
    try {
      var r = await fetch('/api/quran/surah/' + s);
      if (!r.ok) return null;
      var d = await r.json();
      var ayah = (d.ayahs || []).find(function (x) { return x.ayah === a; });
      if (!ayah) return null;
      return '<div class="bookmark-card" data-key="' + esc(key) + '">'
        + '<bdi><strong>' + esc(s) + ':' + esc(a) + '</strong></bdi>'
        + '<div class="arabic small" dir="rtl">' + esc(ayah.arabic) + '</div>'
        + '<p class="muted small">' + esc((ayah.translation_en || '').slice(0, 120)) + '…</p>'
        + '<button class="btn btn-ghost btn-sm" data-open="' + esc(key) + '">Open</button>'
        + ' <button class="btn btn-ghost btn-sm" data-remove="' + esc(key) + '">Remove</button>'
        + '</div>';
    } catch (e) { return null; }
  }

  // Render one group's cards into its wrapper. "Sab" cards get no Remove
  // button (removal stays in the existing bookmark grid); named groups
  // get a working Remove that affects only that collection. The wrapper
  // is re-queried, not closed over, so a re-render cannot paint into a
  // detached node. `seq` guards against stale async renders.
  async function renderGroupCards(groupEl, keys, isSab, collectionId, seq) {
    var cardsEl = groupEl.querySelector('.qs-collection-cards');
    if (!cardsEl) return;
    if (!keys.length) {
      cardsEl.innerHTML = '<p class="muted small">'
        + esc(isSab
          ? 'No bookmarks yet. Tap the bookmark button on any ayah to save it here.'
          : 'No ayahs in this collection yet.')
        + '</p>';
      return;
    }
    cardsEl.innerHTML = '<p class="muted small">Loading…</p>';
    // Mirror renderBookmarkGrid: Promise.all, 50-item cap, fail-soft per card.
    var results = await Promise.all(
      keys.slice(0, MAX_CARDS).map(fetchCardHtml)
    );
    if (seq !== renderSeq) return; // a newer render started — stay out
    var cards = results.filter(Boolean);
    if (!cards.length) {
      cardsEl.innerHTML = '<p class="muted small">Could not load ayahs.</p>';
      return;
    }
    cardsEl.innerHTML = cards.join('');
    // "Sab": strip the Remove buttons — removal stays in the bookmark grid.
    if (isSab) {
      cardsEl.querySelectorAll('[data-remove]').forEach(function (b) { b.remove(); });
    }
    cardsEl.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { openAyah(b.dataset.open); });
    });
    if (!isSab) {
      cardsEl.querySelectorAll('[data-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          removeFromCollection(collectionId, b.dataset.remove);
          // Re-render into the live container (if it still exists).
          var grid = document.getElementById('collections-grid');
          if (grid) renderCollections(grid);
        });
      });
    }
  }

  // Build one group section. The header (name + count) is built with
  // textContent so a collection name can never inject HTML; only the
  // fetched ayah cards use innerHTML, and those pass through esc().
  function buildGroup(name, keys, isSab, collectionId) {
    var section = document.createElement('section');
    section.className = 'qs-collection-group';
    if (!isSab) section.dataset.collectionId = collectionId;

    var head = document.createElement('div');
    head.className = 'qs-collection-head';
    var title = document.createElement('strong');
    title.textContent = name; // textContent: never innerHTML for user text
    var count = document.createElement('span');
    count.className = 'muted small';
    count.textContent = ' (' + keys.length + ')';
    head.appendChild(title);
    head.appendChild(count);
    section.appendChild(head);

    if (!isSab) {
      var actions = document.createElement('div');
      actions.className = 'qs-collection-actions';
      var renameBtn = document.createElement('button');
      renameBtn.className = 'btn btn-ghost btn-sm';
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', function () {
        var next = window.prompt('Rename collection:', name);
        if (next == null) return; // cancelled
        if (renameCollection(collectionId, next)) {
          var grid = document.getElementById('collections-grid');
          if (grid) renderCollections(grid);
        }
        // Empty/invalid new name: renameCollection() returns false and
        // the old name stays — nothing else to do.
      });
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-ghost btn-sm';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function () {
        if (!window.confirm('Delete collection "' + name + '"? Its ayahs stay bookmarked.')) return;
        if (deleteCollection(collectionId)) {
          var grid = document.getElementById('collections-grid');
          if (grid) renderCollections(grid);
        }
      });
      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
      section.appendChild(actions);
    }

    var cards = document.createElement('div');
    cards.className = 'qs-collection-cards';
    section.appendChild(cards);
    return section;
  }

  // Render all groups into `container` (an element, or an element id
  // string). Guard: does nothing if container is null / not found.
  // Order: default "Sab" group first (live from 'qs-bookmarks'), then
  // each named collection in stored order. If there are no named
  // collections yet, the exact empty-state line below is shown.
  async function renderCollections(container) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    var seq = ++renderSeq;
    var named = loadCollections();
    var sabKeys = getSabKeys();

    // Clear without innerHTML user text (container holds only our output).
    while (container.firstChild) container.removeChild(container.firstChild);

    var sabGroup = buildGroup('Sab', sabKeys, true, SAB_ID);
    container.appendChild(sabGroup);
    var sabPromise = renderGroupCards(sabGroup, sabKeys, true, SAB_ID, seq);

    var groupPromises = [sabPromise];
    named.forEach(function (c) {
      var g = buildGroup(c.name, c.keys, false, c.id);
      container.appendChild(g);
      groupPromises.push(renderGroupCards(g, c.keys, false, c.id, seq));
    });

    if (!named.length) {
      var empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No collections yet. Create one and add bookmarks to it.';
      container.appendChild(empty);
    }
    await Promise.all(groupPromises);
  }

  /* ---------------- assign dialog ---------------- */

  function closeAssignDialog() {
    var old = document.querySelector('.qs-assign-overlay');
    if (old) old.remove();
  }

  // Build a dialog ENTIRELY dynamically (document.createElement — no
  // template changes): checkboxes for existing named collections, a
  // "new collection" name input, and a Save button. Save adds the key to
  // every checked collection (no duplicates) and, if a new name was
  // typed, to a new collection of that name — or to the existing
  // collection of the same name, if one already exists (no duplicate
  // names created). Works standalone: the lead may later wire it to a
  // per-bookmark "+ Collection" button, but it needs no such wiring.
  // Returns false for an invalid key, true otherwise. The dialog itself
  // never uses innerHTML — all labels use textContent.
  function openAssignDialog(key) {
    if (!isValidKey(key)) return false;
    closeAssignDialog(); // never stack two dialogs

    var named = loadCollections();

    var overlay = document.createElement('div');
    overlay.className = 'qs-assign-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeAssignDialog();
    });

    var dialog = document.createElement('div');
    dialog.className = 'qs-assign-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Add to collection');

    var title = document.createElement('strong');
    title.textContent = 'Add ' + key + ' to collection';
    dialog.appendChild(title);

    var list = document.createElement('div');
    list.className = 'qs-assign-list';
    if (!named.length) {
      var none = document.createElement('p');
      none.className = 'muted small';
      none.textContent = 'No collections yet — create one below.';
      list.appendChild(none);
    }
    var boxes = []; // { id, input }
    named.forEach(function (c) {
      var row = document.createElement('label');
      row.className = 'qs-assign-row';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = c.keys.indexOf(key) !== -1; // pre-tick if already in it
      var label = document.createElement('span');
      label.textContent = c.name; // textContent: never innerHTML
      row.appendChild(box);
      row.appendChild(label);
      list.appendChild(row);
      boxes.push({ id: c.id, input: box });
    });
    dialog.appendChild(list);

    var newInput = document.createElement('input');
    newInput.className = 'qs-assign-input';
    newInput.type = 'text';
    newInput.maxLength = MAX_NAME_LEN;
    newInput.placeholder = 'New collection name';
    newInput.setAttribute('aria-label', 'New collection name');
    dialog.appendChild(newInput);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-sm';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function () {
      boxes.forEach(function (b) {
        if (b.input.checked) addToCollection(b.id, key);
      });
      var newName = cleanName(newInput.value);
      if (newName) {
        // Same name (case-insensitive) as an existing collection? Add
        // there instead of creating a duplicate-named collection.
        var existing = null;
        loadCollections().forEach(function (c) {
          if (c.name.toLowerCase() === newName.toLowerCase()) existing = c;
        });
        if (existing) addToCollection(existing.id, key);
        else {
          var created = createCollection(newName);
          if (created) addToCollection(created.id, key);
        }
      }
      closeAssignDialog();
      // Refresh the collections view if the lead has mounted it.
      var grid = document.getElementById('collections-grid');
      if (grid) renderCollections(grid);
    });
    dialog.appendChild(saveBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeAssignDialog);
    dialog.appendChild(cancelBtn);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        closeAssignDialog();
        document.removeEventListener('keydown', onEsc);
      }
    });
    return true;
  }

  /* ---------------- public API ---------------- */
  window.qsCollections = {
    getCollections: getCollections,
    createCollection: createCollection,
    renameCollection: renameCollection,
    deleteCollection: deleteCollection,
    addToCollection: addToCollection,
    removeFromCollection: removeFromCollection,
    renderCollections: renderCollections,
    openAssignDialog: openAssignDialog
  };
})();
