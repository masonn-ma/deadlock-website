/**
 * Dedicated heroes page for one player: every hero they have played,
 * aggregated from the full match history, with a name filter, a queue-mode
 * filter and sorting. Lives at #/heroes/{account_id}; the profile page
 * links here from its top-10 heroes panel, so both pages read from the
 * same aggregation and their numbers always agree.
 */

import { getSteamAccounts, getMatchHistory, ApiError } from './lib/api.js';
import { translate } from './lib/dictionaries/registry.js';
import { aggregateHistory, modeBreakdown } from './lib/aggregate.js';
import * as fmt from './lib/dictionaries/format.js';
import { h, avatarImg, heroIcon, copyChip, copyChipClick, iconExternal } from './lib/util.js';
import { steamId3FromAccount } from './search.js';

let renderToken = 0;

const SORTS = [
  { key: 'games', label: 'Most played' },
  { key: 'winrate', label: 'Best winrate' },
  { key: 'name', label: 'Name' },
];

/**
 * Render the heroes page for an account.
 * @param {HTMLElement} root
 * @param {string} accountId
 * @param {{ dictsReady: Promise<void>, saveRecent?: (rec: object) => void }} ctx
 */
export function renderHeroesPage(root, accountId, ctx) {
  const token = ++renderToken;
  const stale = () => token !== renderToken;

  const filters = { modeKey: null, sort: 'games', query: '' };

  root.replaceChildren(buildSkeleton());

  const headEl = root.querySelector('#heroes-head');
  const descEl = root.querySelector('#hp-desc');
  const modesEl = root.querySelector('#hp-modes');
  const sortEl = root.querySelector('#hp-sorts');
  const searchEl = root.querySelector('#hp-search');
  const listEl = root.querySelector('#hp-list');

  let rows = null;
  let totals = null;

  searchEl?.addEventListener('input', () => {
    filters.query = searchEl.value.trim();
    renderList();
  });

  /* -------- loaders (retryable) -------- */

  const loadHead = () => {
    return getSteamAccounts([Number(accountId)])
      .then(async (data) => {
        if (stale()) return;
        await ctx.dictsReady;
        if (stale()) return;
        const profile = data?.[0] ?? null;
        renderIdentity(headEl, profile, accountId);
        if (profile) {
          ctx.saveRecent?.({
            accountId,
            name: profile.personaname || `Account ${accountId}`,
            avatar: profile.avatarmedium || profile.avatarfull || profile.avatar || null,
          });
        }
      })
      .catch(() => {
        if (stale()) return;
        renderIdentity(headEl, null, accountId); // identity is cosmetic; the data still loads
      });
  };

  const loadHistory = () => {
    listEl.replaceChildren(...listSkeletonRows());
    if (descEl) descEl.textContent = 'Loading match history…';
    return getMatchHistory(accountId)
      .then(async (data) => {
        if (stale()) return;
        await ctx.dictsReady;
        if (stale()) return;
        rows = data;
        totals = aggregateHistory(rows);
        renderFilters();
        renderList();
      })
      .catch((err) => {
        if (stale()) return;
        if (descEl) descEl.textContent = 'Could not load match history';
        listEl.replaceChildren(
          h('li', { class: 'empty-state' },
            h('span', {}, `Couldn\u2019t load the match history (${errMessage(err)}).`),
            h('button', { class: 'btn text', type: 'button', onClick: loadHistory }, 'Retry'),
          ),
        );
      });
  };

  loadHead();
  loadHistory();

  return () => { renderToken++; };

  /* -------- rendering -------- */

  function renderIdentity(el, profile, id) {
    if (!el) return;
    const name = profile?.personaname || `Account ${id}`;
    const shareUrl = `${location.origin}${location.pathname}#/heroes/${id}`;
    el.replaceChildren(
      avatarImg(
        [profile?.avatarfull, profile?.avatarmedium, profile?.avatar],
        'avatar',
        name,
        `${name} avatar`,
      ),
      h('div', { class: 'player-id' },
        h('h1', { class: 'player-name' }, name),
        h('p', { class: 'player-meta' },
          profile
            ? h('a', { class: 'text-link', href: profile.profileurl || '#', target: '_blank', rel: 'noopener' }, 'Steam ↗')
            : 'Steam profile unavailable',
        ),
        h('p', { class: 'player-idline' },
          h('span', { class: 'mono id-chip' }, steamId3FromAccount(id)),
          copyChip(steamId3FromAccount(id), 'Copy ID'),
          copyChip(shareUrl, 'Copy link'),
        ),
      ),
      h('div', { class: 'head-actions' },
        h('a', { class: 'btn text', href: `#/player/${id}` }, '\u2190 Profile'),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': 'Copy link to this page',
          title: 'Copy link to this page',
          onClick: copyChipClick(shareUrl),
        }, iconExternal()),
      ),
    );
  }

  function renderFilters() {
    const modes = modeBreakdown(rows);
    const allGames = modes.reduce((s, m) => s + m.games, 0);
    modesEl.replaceChildren(
      h('span', { class: 'hp-row-label' }, 'Mode'),
      modeChip('All modes', null, allGames),
      ...modes.map((m) => modeChip(m.label, m.label, m.games)),
    );
    sortEl.replaceChildren(
      h('span', { class: 'hp-row-label' }, 'Sort'),
      ...SORTS.map((s) =>
        h('button', {
          class: `chip${filters.sort === s.key ? ' active' : ''}`,
          type: 'button',
          onClick: () => {
            filters.sort = s.key;
            renderFilters();
            renderList();
          },
        }, s.label)
      ),
    );
  }

  function modeChip(label, key, games) {
    const active = filters.modeKey === key;
    return h('button', {
      class: `chip${active ? ' active' : ''}`,
      type: 'button',
      onClick: () => {
        // Clicking an active mode chip unselects it (back to all modes).
        filters.modeKey = active && key !== null ? null : key;
        renderFilters();
        renderList();
      },
    }, label, ` · ${fmt.int(games)}`);
  }

  function renderList() {
    if (!rows) return;
    const agg = aggregateHistory(rows, { modeKey: filters.modeKey });
    let list = agg.perHero;

    const q = filters.query.toLowerCase();
    if (q) {
      list = list.filter((r) => translate('heroes', r.heroId).name.toLowerCase().includes(q));
    }

    if (filters.sort === 'winrate') {
      list.sort((a, b) =>
        (winrateOf(b) ?? -1) - (winrateOf(a) ?? -1) || (b.matches_played ?? 0) - (a.matches_played ?? 0));
    } else if (filters.sort === 'name') {
      list.sort((a, b) =>
        translate('heroes', a.heroId).name.localeCompare(translate('heroes', b.heroId).name));
    } else {
      list.sort((a, b) =>
        (b.matches_played ?? 0) - (a.matches_played ?? 0) || (b.wins ?? 0) - (a.wins ?? 0));
    }

    if (descEl) {
      const parts = [
        list.length === totals.heroCount ? `${list.length} heroes` : `${list.length} of ${totals.heroCount} heroes`,
        `${fmt.int(agg.totalGames)} games`,
      ];
      if (filters.modeKey) parts.push(filters.modeKey);
      descEl.textContent = parts.join(' · ');
    }

    if (list.length === 0) {
      listEl.replaceChildren(
        h('li', { class: 'empty-state' },
          totals.heroCount === 0
            ? 'No Deadlock matches recorded for this account yet.'
            : 'No heroes match the current filter.',
          totals.heroCount > 0 && filters.modeKey != null
            ? h('button', { class: 'btn text', type: 'button', onClick: clearMode }, 'Clear mode filter')
            : null,
        ),
      );
      return;
    }

    listEl.replaceChildren(...list.map((r) => rowHtml(r)));
  }

  function rowHtml(r) {
    const hero = translate('heroes', r.heroId);
    const wr = winrateOf(r);
    return h('li', { class: 'hp-row', title: `${fmt.int(r.wins)} W · ${fmt.int(r.losses)} L` },
      h('div', { class: 'hp-main' },
        heroIcon(hero),
        h('span', { class: 'hero-name' }, hero.name),
        h('span', { class: 'num hero-games' },
          fmt.int(r.matches_played), ' ',
          h('span', { class: 'unit' }, 'games'),
        ),
      ),
      h('div', { class: 'hp-wr' },
        h('span', { class: 'hero-bar-track' },
          // Absolute scale: bar length = win rate, comparable across rows.
          h('span', { class: 'hero-bar', style: `width:${wr ?? 0}%` }),
        ),
        h('span', { class: 'num hero-bar-val' }, wr == null ? '\u2014' : fmt.pct(wr)),
      ),
      h('span', { class: 'num hp-kda' },
        `${fmt.avg1(r.kills, r.matches_played)} / ${fmt.avg1(r.deaths, r.matches_played)} / ${fmt.avg1(r.assists, r.matches_played)}`,
      ),
      h('span', { class: 'hp-last' }, r.last_played ? fmt.timeAgo(r.last_played) : '\u2014'),
    );
  }

  function winrateOf(row) {
    const played = row.matches_played ?? 0;
    if (!played) return null;
    return ((row.wins ?? 0) / played) * 100;
  }

  function clearMode() {
    filters.modeKey = null;
    renderFilters();
    renderList();
  }
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

function listSkeletonRows(count = 9) {
  return Array.from({ length: count }, (_, i) =>
    h('li', { class: 'hp-row' },
      h('div', { class: 'hp-main' },
        h('span', { class: 'skel icon-sk', style: 'width:24px;height:24px' }),
        h('span', { class: 'skel', style: `width:${26 + ((i * 9) % 26)}%;height:13px` }),
      ),
      h('div', { class: 'hp-wr' },
        h('span', { class: 'skel', style: `width:${30 + ((i * 17) % 45)}%;height:10px;border-radius:999px` }),
      ),
      h('span', { class: 'skel', style: 'width:96px;height:13px' }),
      h('span', { class: 'skel', style: 'width:48px;height:13px' }),
    )
  );
}

function buildSkeleton() {
  return h('section', { class: 'player' },
    h('header', { class: 'player-head card', id: 'heroes-head' },
      h('span', { class: 'skel avatar-sk', style: 'width:64px;height:64px' }),
      h('div', { class: 'player-id' },
        h('span', { class: 'skel', style: 'width:40%;height:26px' }),
        h('span', { class: 'skel', style: 'width:30%;height:13px' }),
      ),
      h('div', { class: 'head-actions' },
        h('span', { class: 'skel', style: 'width:100px;height:32px' }),
      ),
    ),
    h('section', { class: 'panel card hp-body' },
      h('header', { class: 'panel-head' },
        h('div', {},
          h('h2', {}, 'Heroes'),
          h('p', { class: 'panel-desc', id: 'hp-desc' }, 'Loading match history…'),
        ),
        h('input', {
          class: 'search-input hp-search',
          id: 'hp-search',
          type: 'text',
          placeholder: 'Filter by hero name',
          spellcheck: 'false',
          'aria-label': 'Filter heroes by name',
        }),
      ),
      h('div', { class: 'hp-filters' },
        h('div', { class: 'hp-chip-row', id: 'hp-modes' },
          h('span', { class: 'skel', style: 'width:240px;height:26px;border-radius:999px' }),
        ),
        h('div', { class: 'hp-chip-row', id: 'hp-sorts' },
          h('span', { class: 'skel', style: 'width:220px;height:26px;border-radius:999px' }),
        ),
      ),
      h('div', { class: 'hp-row hp-hhead', 'aria-hidden': 'true' },
        h('div', { class: 'hp-main' }, h('span', {}, 'Hero')),
        h('div', { class: 'hp-wr' }, h('span', {}, 'Win rate')),
        h('span', { class: 'hp-kda' }, 'Avg K/D/A'),
        h('span', { class: 'hp-last' }, 'Last'),
      ),
      h('ol', { class: 'hp-list', id: 'hp-list' }, listSkeletonRows()),
    ),
  );
}

function errMessage(err) {
  if (err instanceof ApiError) return err.message;
  return err?.message || 'network error';
}
