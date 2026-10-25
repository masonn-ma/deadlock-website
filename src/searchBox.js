/**
 * Search box behaviour: live suggestions from the community name search while
 * typing, resolution on submit, and a keyboard-navigable dropdown.
 *
 * Used by both the landing hero search and the top bar search - the markup
 * contract is a <form> containing one <input> and one <ul class="search-pop">.
 */

import { resolveInput, quickSearch } from './search.js';
import { getSteamKey } from './settings.js';
import { h, avatarImg } from './lib/util.js';
import * as fmt from './lib/dictionaries/format.js';

export function attachSearchBox(form) {
  if (!form || form.dataset.searchWired) return;
  form.dataset.searchWired = '1';
  const input = form.querySelector('input');
  const button = form.querySelector('button[type=submit]');
  const pop = form.querySelector('.search-pop');
  if (!input || !pop) return;

  let items = [];
  let activeIndex = -1;
  let searching = false;
  let lastSuggestQuery = '';

  const close = () => {
    pop.hidden = true;
    pop.replaceChildren();
    items = [];
    activeIndex = -1;
    lastSuggestQuery = '';
  };

  const navigate = (accountId) => {
    close();
    if (location.hash === `#/player/${accountId}`) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      location.hash = `#/player/${accountId}`;
    }
  };

  const renderError = (message) => {
    items = [];
    activeIndex = -1;
    pop.replaceChildren(h('li', { class: 'pop-error' }, message));
    pop.hidden = false;
  };

  const renderRows = (rows) => {
    items = rows;
    activeIndex = -1;
    pop.replaceChildren(
      ...rows.map((row, i) =>
        h('li', {
          class: 'pop-row',
          role: 'option',
          'aria-selected': 'false',
          dataset: { index: String(i) },
          onClick: () => navigate(row.account_id),
          onmouseenter: () => setActive(i),
        },
          avatarImg([row.avatarmedium, row.avatar, row.avatarfull], 'pop-avatar', row.personaname || 'Unknown'),
          h('span', { class: 'pop-name' }, row.personaname || 'Unknown'),
          h('span', { class: 'pop-meta' }, `${fmt.int(row.matches_played_last_30d)} matches · 30 days`),
        )
      )
    );
    pop.hidden = false;
  };

  function setActive(index) {
    activeIndex = index;
    [...pop.children].forEach((li, i) => {
      li.classList.toggle('active', i === activeIndex);
      li.setAttribute('aria-selected', String(i === activeIndex));
    });
  }

  const setLoading = (on) => {
    searching = on;
    if (!button) return;
    if (on) {
      button.dataset.label = button.textContent;
      button.textContent = 'Searching…';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || 'Look up';
      button.disabled = false;
    }
  };

  input.addEventListener('input', async () => {
    const value = input.value.trim();
    if (value.length < 3 || searching) {
      close();
      return;
    }
    const query = value;
    try {
      const rows = await quickSearch(query);
      if (searching || input.value.trim() !== query) return; // stale keystroke
      if (!rows.length) {
        if (lastSuggestQuery === query) return;
        close();
      } else {
        lastSuggestQuery = query;
        renderRows(rows);
      }
    } catch {
      /* suggestions are best-effort; submit still does full resolution */
      close();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      input.blur();
      return;
    }
    if (pop.hidden || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0 && !e.isComposing) {
      e.preventDefault();
      navigate(items[activeIndex].account_id);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value || searching) return;
    close();
    setLoading(true);
    try {
      const res = await resolveInput(value, { steamKey: getSteamKey() });
      if (res.status === 'ok') navigate(res.accountId);
      else if (res.status === 'candidates') renderRows(res.candidates);
      else renderError(res.message);
    } catch (err) {
      renderError(`Search failed: ${err?.message || 'network error'}`);
    } finally {
      setLoading(false);
    }
  });

  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) close();
  });
}
