/**
 * App entry point and hash router.
 *
 *   #/                      → home (search)
 *   #/player/{account_id}   → player profile
 *   #/heroes/{account_id}   → per-player heroes page (filters + sorting)
 *
 * Player links are shareable and survive refreshes; the dictionary registry is
 * loaded once at boot (baked files first, then a live refresh).
 */

import { register, ready as dictsReady } from './lib/dictionaries/registry.js';
import { heroes } from './lib/dictionaries/heroes.js';
import { ranks } from './lib/dictionaries/ranks.js';
import { renderPlayer } from './playerView.js';
import { renderHeroesPage } from './heroesView.js';
import { attachSearchBox } from './searchBox.js';
import { initSettings, getSteamKey } from './settings.js';
import { h, avatarImg } from './lib/util.js';

register('heroes', heroes);
register('ranks', ranks);
const dictionaries = dictsReady();

const view = document.getElementById('view');
const topbarSearch = document.getElementById('topbar-search');

initSettings();
attachSearchBox(topbarSearch);

/* ---------------- home ---------------- */

function renderHome() {
  if (topbarSearch) topbarSearch.hidden = true;
  view.replaceChildren(
    h('section', { class: 'landing' },
      h('h1', { class: 'landing-title' }, 'Look up a Deadlock player'),
      h('p', { class: 'landing-sub' },
        'Search by Steam ID, profile URL or display name. Records are pulled live from the Deadlock Community API.',
      ),
      h('form', { class: 'search', id: 'hero-search', role: 'search', autocomplete: 'off' },
        h('label', { class: 'field-label', for: 'hero-search-input' }, 'Player'),
        h('div', { class: 'search-row' },
          h('input', {
            id: 'hero-search-input',
            class: 'search-input',
            type: 'text',
            placeholder: '765611980… · steamcommunity.com/id/… · display name',
            spellcheck: 'false',
          }),
          h('button', { class: 'btn primary', type: 'submit' }, 'Look up'),
        ),
        h('div', { class: 'try-row' },
          h('span', { class: 'try-label' }, 'Try:'),
          ...['gabe', '76561197960287930', 'steamcommunity.com/id/GabeLoganNewell'].map((example) =>
            h('button', { class: 'chip', type: 'button', title: `Fill the search with ${example}` }, example)
          ),
        ),
        h('ul', { class: 'search-pop', hidden: true }),
      ),
      h('div', { class: 'recents', id: 'recents' }),
      h('p', { class: 'landing-close' }, 'Live data from the Deadlock Community API.'),
    )
  );

  attachSearchBox(document.getElementById('hero-search'));
  document.querySelectorAll('.try-row .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('hero-search-input');
      if (input) {
        input.value = chip.textContent;
        input.focus();
      }
    });
  });
  renderRecents(document.getElementById('recents'));
  document.getElementById('hero-search-input')?.focus({ preventScroll: true });

  // The closing fact at the bottom of the first screen: real counts from the
  // baked dictionaries once they are in.
  const closeLine = view.querySelector('.landing-close');
  dictionaries.then(() => {
    const heroesCount = heroes.size?.() ?? 0;
    const tiersCount = ranks.size?.() ?? 0;
    if (closeLine && heroesCount && tiersCount) {
      closeLine.textContent =
        `Live from the Deadlock Community API \u00b7 ${heroesCount} heroes and ${tiersCount} rank tiers baked in.`;
    }
  });
}

/* ---------------- recents ---------------- */

const RECENTS_KEY = 'sl_recents';

function readRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((r) => r && r.accountId) : [];
  } catch {
    return [];
  }
}

function saveRecent(rec) {
  const list = readRecents().filter((r) => r.accountId !== rec.accountId);
  list.unshift({ ...rec, ts: Date.now() });
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* storage unavailable */
  }
}

function renderRecents(el) {
  if (!el) return;
  const recents = readRecents();
  if (!recents.length) {
    el.replaceChildren();
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.replaceChildren(
    h('p', { class: 'recents-label' }, 'Recent'),
    h('div', { class: 'recents-row' },
      ...recents.map((rec) =>
        h('button', { class: 'recent-chip', type: 'button', dataset: { accountId: rec.accountId } },
          rec.avatar ? avatarImg([rec.avatar], 'chip-avatar', rec.name) : null,
          h('span', {}, rec.name),
        )
      ),
    ),
  );
  el.querySelectorAll('.recent-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      location.hash = `#/player/${chip.dataset.accountId}`;
    });
  });
}

/* ---------------- routes ---------------- */

function route() {
  window.scrollTo(0, 0);
  const playerMatch = location.hash.match(/^#\/player\/(\d{1,10})$/);
  const heroesMatch = location.hash.match(/^#\/heroes\/(\d{1,10})$/);
  if (playerMatch || heroesMatch) {
    if (topbarSearch) {
      topbarSearch.hidden = false;
      const input = topbarSearch.querySelector('input');
      if (input && document.activeElement !== input) input.value = '';
    }
  }
  if (playerMatch) {
    renderPlayer(view, playerMatch[1], { dictsReady: dictionaries, saveRecent });
  } else if (heroesMatch) {
    renderHeroesPage(view, heroesMatch[1], { dictsReady: dictionaries, saveRecent });
  } else {
    renderHome();
  }
}

window.addEventListener('hashchange', route);
route();

/* "/" focuses the visible search, like every good tool. */
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target;
  if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const visible = !topbarSearch?.hidden ? topbarSearch?.querySelector('input') : document.getElementById('hero-search-input');
  if (visible) {
    e.preventDefault();
    visible.focus();
  }
});
