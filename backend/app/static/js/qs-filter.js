/* ========================================================================
   qs-filter.js — SURAH FILTER enhancement layer (read-only w.r.t. quran.js)
   ------------------------------------------------------------------------
   SAFE ENHANCEMENT ONLY. This file must never re-implement filtering:
   - It does NOT call renderGrid() (that function is private to quran.js).
   - It does NOT write to #surah-grid's innerHTML — quran.js owns the grid.
   - It does NOT filter on input. Its one 'input' listener ONLY toggles
     the Clear button's visibility; the actual re-render is done by
     quran.js's own 'input' listener when this file dispatches an event.
   What it adds:
   1. A live result count in #surah-count (lead-provided element; if it
      is absent, nothing is created and nothing breaks).
   2. A single "Clear" button next to #surah-filter that empties the
      input and dispatches a bubbling 'input' event, so quran.js itself
      re-renders the full list (including the active Makki/Madani chip).
   Wiring (for the lead): load this script AFTER quran.js on /quran and
   call window.qsFilter.init() once on DOMContentLoaded. init() is
   idempotent — calling it twice creates no duplicate button/observer.
   ======================================================================== */
(function () {
  'use strict';

  var initialized = false;

  /* Count the .surah-card elements currently rendered in the grid.
     Read-only: query only, never writes to the grid. */
  function countCards(grid) {
    if (!grid || !grid.children) return 0;
    var n = 0;
    for (var i = 0; i < grid.children.length; i++) {
      if (grid.children[i].classList &&
          grid.children[i].classList.contains('surah-card')) {
        n++;
      }
    }
    return n;
  }

  /* Update #surah-count's text, if (and only if) the lead provided it.
     Looked up fresh on every call so an element added later still works.
     Never creates layout or elements of its own. */
  function updateCount(grid) {
    var countEl = document.getElementById('surah-count');
    if (!countEl) return; // Absent: do nothing, by design.
    var n = countCards(grid);
    countEl.textContent = (n === 0) ? 'No surahs match' : n + ' surahs';
  }

  /* Show the Clear button only while there is text to clear. */
  function syncClearVisibility(input, clearBtn) {
    if (!input || !clearBtn) return;
    clearBtn.hidden = !input.value;
  }

  function init() {
    if (initialized) return; // Safe to call again; second call is a no-op.
    initialized = true;

    var input = document.getElementById('surah-filter');
    var grid = document.getElementById('surah-grid');
    if (!input && !grid) return; // Nothing this layer can enhance: exit quietly.

    var clearBtn = null;

    /* --- Clear button: exactly one, only if #surah-filter exists. --- */
    if (input) {
      // Reuse an existing button (e.g. from a previous init or the
      // template) instead of ever creating a duplicate.
      clearBtn = document.querySelector('.surah-clear-btn');
      if (!clearBtn && input.parentNode) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn-ghost btn-sm surah-clear-btn';
        clearBtn.textContent = '\u2715 Clear';
        clearBtn.setAttribute('aria-label', 'Clear surah filter');
        // Insert immediately after the input ("next to #surah-filter").
        // insertBefore with nextSibling is safe when input is last child.
        input.parentNode.insertBefore(clearBtn, input.nextSibling);
      }
      // No parent node (should not happen in the real template): skip the
      // button rather than throwing — the count observer below still runs.
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          input.value = '';
          // Let quran.js do the filtering: its own 'input' listener on
          // #surah-filter re-renders the full list. Bubbling so any other
          // delegated listeners also see it, exactly like a real keystroke.
          input.dispatchEvent(new Event('input', { bubbles: true }));
          syncClearVisibility(input, clearBtn);
          try { input.focus(); } catch (e) { /* focus is a nicety, not required */ }
        });
        // Visibility-only listener: NEVER filters, NEVER calls renderGrid.
        input.addEventListener('input', function () {
          syncClearVisibility(input, clearBtn);
        });
        syncClearVisibility(input, clearBtn);
      }
    }

    /* --- Result count: observe the grid, read only. --- */
    if (grid) {
      updateCount(grid);
      if (typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function () {
          // Grid content changed (quran.js re-rendered): re-count and
          // re-sync Clear visibility (covers chip clicks / programmatic
          // changes that do not fire an 'input' event on the filter).
          updateCount(grid);
          if (input && clearBtn) syncClearVisibility(input, clearBtn);
        });
        // childList + subtree: renderGrid replaces all children at once;
        // subtree keeps the count correct if cards are ever nested.
        observer.observe(grid, { childList: true, subtree: true });
      }
      // If MutationObserver is unavailable (very old browser), the count
      // simply stays at its initial value — no error, no fallback writes.
    }
  }

  window.qsFilter = { init: init };
})();
