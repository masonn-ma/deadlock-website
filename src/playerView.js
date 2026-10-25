/**
 * Player profile view: header card, career KPI strip, hero records bar-list
 * and the recent match history table. All raw API integers pass through the
 * dictionary registry before they ever reach the DOM.
 *
 * Hero data has a single source of truth: the full match history, aggregated
 * client-side (lib/aggregate.js) into per-hero records. The same aggregation
 * feeds the profile panel, the career KPIs and the dedicated heroes page,
 * so numbers always agree between pages.
 */

import { getSteamAccounts, getPlayerRank, getMatchHistory, ApiError } from './lib/api.js';
import { aggregateHistory } from './lib/aggregate.js';
import { translate } from './lib/dictionaries/registry.js';
import { outcomeEntry } from './lib/dictionaries/modes.js';
import * as fmt from './lib/dictionaries/format.js';
import { h, avatarImg, copyChip, copyChipClick, heroIcon, iconExternal } from './lib/util.js';
import { steamId3FromAccount, fetchProfile } from './search.js';

const INITIAL_MATCH_ROWS = 10;
const EXPANDED_MATCH_ROWS = 40;

let renderToken = 0;

/**
 * Render the profile page for an account.
 * @param {HTMLElement} root
 * @param {string} accountId
 * @param {{ dictsReady: Promise<void>, saveRecent?: (rec: object) => void }} ctx
 */
export function renderPlayer(root, accountId, ctx) {
  const token = ++renderToken;
  const stale = () => token !== renderToken;

  const state = {
    accountId,
    profile: null,
    rank: null,
    agg: null,
    history: null,
    matchCount: INITIAL_MATCH_ROWS,
  };

  root.replaceChildren(buildSkeleton());

  const headEl = root.querySelector('#player-head');
  const kpiEl = root.querySelector('#player-kpi');
  kpiEl._state = state; // partial renders read the shared view state
  const heroEl = root.querySelector('#hero-list');
  const heroFoot = root.querySelector('#heroes-foot');
  const matchEl = root.querySelector('#match-list');
  const matchFoot = root.querySelector('#matches-foot');
  const matchDesc = root.querySelector('#matches-desc');

  /* -------- loaders (each retryable on its own) -------- */

  const loadHead = () => {
    skeletonizeHead(headEl, kpiEl);
    return Promise.all([
      fetchProfile(accountId).catch((err) => ({ error: err })),
      getPlayerRank(accountId).catch((err) => ({ error: err })),
    ]).then(async ([profile, rank]) => {
      if (stale()) return;
      await ctx.dictsReady; // dictionaries must be ready before rank/hero translation
      if (stale()) return;
      if (profile.error) {
        state.profile = null;
        state.rank = rank.error ? null : rank;
        renderHeadError(headEl, profile.error, accountId);
        renderKpis(kpiEl);
      } else {
        state.profile = profile;
        state.rank = rank.error ? null : rank;
        renderHead(headEl, profile);
        renderKpis(kpiEl);
        ctx.saveRecent?.({
          accountId,
          name: profile.personaname || `Account ${accountId}`,
          avatar: profile.avatarmedium || profile.avatarfull || profile.avatar || null,
        });
      }
    });
  };

  const loadHistory = () => {
    return getMatchHistory(accountId)
      .then(async (data) => {
        if (stale()) return;
        await ctx.dictsReady;
        if (stale()) return;
        state.history = data;
        state.agg = aggregateHistory(data);
        renderHeroes(heroEl, heroFoot, state);
        renderMatches(matchEl, matchFoot, matchDesc, state);
        renderKpis(kpiEl);
      })
      .catch((err) => {
        if (stale()) return;
        sectionError(heroEl, heroFoot.parentElement, err, 'hero records', loadHistory);
        sectionError(matchEl, matchFoot.parentElement, err, 'match history', loadHistory);
      });
  };

  loadHead();
  headReloader = loadHead;
  loadHistory();

  return () => { renderToken++; headReloader = null; };
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

function skel(width, height, extra = '') {
  return h('span', { class: `skel ${extra}`, style: `width:${width};height:${height}px` });
}

function skeletonHead() {
  return h('header', { class: 'player-head card', id: 'player-head' },
    h('span', { class: 'skel avatar-sk', style: 'width:64px;height:64px' }),
    h('div', { class: 'player-id' },
      skel('40%', 26, 'name-sk'),
      skel('55%', 13, 'meta-sk'),
      skel('35%', 20, 'meta-sk'),
    ),
    h('div', { class: 'head-actions' },
      h('span', { class: 'skel', style: 'width:32px;height:32px;border-radius:999px' }),
    ),
  );
}

function skeletonKpi() {
  const labels = ['Rank', 'Matches · 30 days', 'Win rate', 'Heroes played'];
  return h('section', { class: 'kpi', id: 'player-kpi', 'aria-label': 'Career summary' },
    ...labels.map((label, i) =>
      h('div', { class: 'kpi-cell' },
        h('p', { class: 'kpi-label' }, label),
        h('p', { class: 'kpi-value' }, skel(`${35 + ((i * 9) % 30)}%`, 24)),
      )
    )
  );
}

function heroSkeletonRows(count = 7) {
  return Array.from({ length: count }, (_, i) =>
    h('li', { class: 'hero-row' },
      h('div', { class: 'hero-row-top' },
        h('span', { class: 'skel icon-sk', style: 'width:24px;height:24px' }),
        skel(`${22 + ((i * 7) % 24)}%`, 14),
        h('span', { class: 'num skel', style: 'width:64px;height:13px;margin-left:auto' }),
      ),
      h('div', { class: 'hero-row-bar' },
        h('span', { class: 'skel', style: `width:${25 + ((i * 13) % 55)}%;height:10px;border-radius:999px` }),
      ),
    )
  );
}

function matchSkeletonRows(count = 10) {
  return Array.from({ length: count }, (_, i) =>
    h('li', { class: 'mrow' },
      h('span', { class: 'm-hero' },
        h('span', { class: 'skel icon-sk', style: 'width:24px;height:24px' }),
        skel(`${28 + ((i * 11) % 38)}%`, 14),
      ),
      h('span', { class: 'skel pill-sk', style: 'width:52px;height:20px' }),
      h('div', { class: 'm-detail' },
        h('span', { class: 'num skel', style: 'width:78px;height:13px' }),
        h('span', { class: 'num skel', style: 'width:58px;height:13px' }),
        h('span', { class: 'num skel', style: 'width:50px;height:13px' }),
        h('span', { class: 'num skel', style: 'width:44px;height:13px' }),
        h('span', { class: 'num skel', style: 'width:54px;height:13px' }),
      ),
    )
  );
}

function buildSkeleton() {
  return h('section', { class: 'player' },
    skeletonHead(),
    skeletonKpi(),
    h('div', { class: 'panels' },
      h('section', { class: 'panel card heroes-panel' },
        panelHead('Heroes', 'Lifetime · ranked & unranked'),
        h('ol', { class: 'hero-list', id: 'hero-list' }, heroSkeletonRows()),
        h('footer', { class: 'panel-foot', id: 'heroes-foot' }),
      ),
      h('section', { class: 'panel card matches-panel' },
        panelHead('Recent matches', 'Loading tracked matches…', 'matches-desc'),
        h('div', { class: 'mtable' },
          matchHeadRow(),
          h('ol', { class: 'mlist', id: 'match-list' }, matchSkeletonRows()),
        ),
        h('footer', { class: 'panel-foot', id: 'matches-foot' }),
      ),
    ),
  );
}

function skeletonizeHead(headEl, kpiEl) {
  if (headEl) headEl.replaceChildren(...skeletonHead().childNodes);
  if (kpiEl) kpiEl.replaceChildren(...skeletonKpi().childNodes);
}

function panelHead(title, desc, descId = '') {
  return h('header', { class: 'panel-head' },
    h('div', {},
      h('h2', {}, title),
      h('p', { class: 'panel-desc', id: descId || null }, desc),
    ),
  );
}

function matchHeadRow() {
  return h('div', { class: 'mrow mhead', 'aria-hidden': 'true' },
    h('span', {}, 'Hero'),
    h('span', {}, 'Result'),
    h('div', { class: 'm-detail' },
      h('span', { class: 'num' }, 'K / D / A'),
      h('span', { class: 'num' }, 'Souls'),
      h('span', { class: 'num' }, 'Time'),
      h('span', { class: 'num' }, 'Points'),
      h('span', { class: 'num' }, 'When'),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Header + KPIs                                                       */
/* ------------------------------------------------------------------ */

function renderHead(el, profile) {
  if (!el) return;
  const name = profile.personaname || 'Unknown player';
  const meta = [];
  if (profile.realname) meta.push(profile.realname);
  if (profile.countrycode) meta.push(profile.countrycode.toUpperCase());
  const shareUrl = `${location.origin}${location.pathname}#/player/${profile.account_id}`;

  el.replaceChildren(
    avatarImg([profile.avatarfull, profile.avatarmedium, profile.avatar], 'avatar', name, `${name} avatar`),
    h('div', { class: 'player-id' },
      h('h1', { class: 'player-name' }, name),
      h('p', { class: 'player-meta' },
        meta.length ? `${meta.join(' · ')} · ` : '',
        h('a', { class: 'text-link', href: profile.profileurl || '#', target: '_blank', rel: 'noopener' }, 'Steam ↗'),
      ),
      h('p', { class: 'player-idline' },
        h('span', { class: 'mono id-chip' }, steamId3FromAccount(profile.account_id)),
        copyChip(steamId3FromAccount(profile.account_id), 'Copy ID'),
        copyChip(shareUrl, 'Copy link'),
      ),
    ),
    h('div', { class: 'head-actions' },
      h('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Copy link to this profile',
        title: 'Copy link to this profile',
        onClick: copyChipClick(shareUrl),
      }, iconExternal()),
    ),
  );
}

function renderKpis(kpiEl) {
  if (!kpiEl) return;
  const { profile, rank, agg } = current(kpiEl);

  // Career win rate from the same aggregation as the hero panels.
  const winrate = agg && agg.totalGames > 0 ? (agg.totalWins / agg.totalGames) * 100 : null;

  const rankEntry = rank
    ? translate('ranks', rank.badge ?? { tier: rank.rank, subrank: rank.subrank })
    : null;
  // The exact rating number behind the badge: the flat progress the player's
  // most recent ranked match left off at.
  const elo = rank?.last_match?.player_rank_final_flat_progress;

  kpiEl.replaceChildren(
    kpiCell('Rank', rankEntry
      ? h('span', { class: 'kpi-rank' },
          rankEntry.badge ? h('img', { src: rankEntry.badge, alt: '', class: 'kpi-badge' }) : null,
          h('span', { class: 'kpi-rank-text' },
            h('span', { class: 'kpi-rank-name gold' }, rankEntry.name),
            elo != null ? h('span', { class: 'kpi-elo num' }, `ELO ${fmt.int(elo)}`) : null,
          ),
        )
      : h('span', { class: 'muted' }, '\u2014')),
    kpiCell('Matches · 30 days', h('span', { class: 'num kpi-num' }, profile ? fmt.int(profile.matches_played_last_30d ?? 0) : '\u2014')),
    kpiCell('Win rate', agg
      ? h('span', { class: 'num kpi-num' }, winrate == null ? '\u2014' : fmt.pct(winrate))
      : h('span', { class: 'skel', style: 'width:45%;height:24px;display:inline-block' })),
    kpiCell('Heroes played', agg
      ? h('span', { class: 'num kpi-num' }, String(agg.heroCount))
      : h('span', { class: 'skel', style: 'width:45%;height:24px;display:inline-block' })),
  );
}

/* View state is stashed on the KPI element so partial renders can read it. */
function current(kpiEl) {
  return kpiEl._state ?? {};
}

function kpiCell(label, valueNode) {
  return h('div', { class: 'kpi-cell' },
    h('p', { class: 'kpi-label' }, label),
    h('p', { class: 'kpi-value' }, valueNode),
  );
}

function renderHeadError(el, err, accountId) {
  el.replaceChildren(
    h('div', { class: 'section-error' },
      h('p', {}, `Couldn\u2019t load the Steam profile (${errMessage(err)}).`),
      h('p', { class: 'error-actions' },
        h('button', { class: 'btn text', type: 'button', onClick: loadHeadRef }, 'Retry'),
        h('a', { class: 'btn text', href: '#/' }, 'Back to search'),
      ),
      h('p', { class: 'error-hint mono' }, `account ${accountId}`),
    )
  );
}

/** Re-run the header load from a Retry button. */
let headReloader = null;
function loadHeadRef() {
  headReloader?.();
}

/* ------------------------------------------------------------------ */
/* Hero records                                                        */
/* ------------------------------------------------------------------ */

function renderHeroes(listEl, footEl, state) {
  if (!listEl) return;
  const agg = state.agg;

  if (!agg || agg.perHero.length === 0) {
    listEl.replaceChildren(emptyState('No ranked or unranked matches recorded for this account yet.'));
    if (footEl) footEl.replaceChildren();
    return;
  }

  const sorted = [...agg.perHero].sort(
    (a, b) => (b.matches_played ?? 0) - (a.matches_played ?? 0) || (b.wins ?? 0) - (a.wins ?? 0)
  );

  listEl.replaceChildren(
    ...sorted.slice(0, 10).map((row) => {
      const hero = translate('heroes', row.heroId);
      const wr = winrateOf(row);
      return h('li', {
        class: 'hero-row',
        title: `${fmt.int(row.wins)} W · ${fmt.int(row.losses)} L`,
      },
        h('div', { class: 'hero-row-top' },
          heroIcon(hero, 'hero-icon'),
          h('span', { class: 'hero-name' }, hero.name),
          h('span', { class: 'num hero-games' },
            fmt.int(row.matches_played), ' ',
            h('span', { class: 'unit' }, 'games'),
          ),
        ),
        h('div', { class: 'hero-row-bar' },
          h('span', { class: 'hero-bar-track' },
            // Absolute scale: bar length = win rate, comparable across rows.
            h('span', { class: 'hero-bar', style: `width:${wr ?? 0}%` }),
          ),
          h('span', { class: 'num hero-bar-val' }, wr == null ? '\u2014' : fmt.pct(wr)),
        ),
      );
    })
  );

  if (footEl) {
    footEl.replaceChildren(
      sorted.length > 10
        ? h('a', { class: 'btn ghost full', href: `#/heroes/${state.accountId}` }, `All ${sorted.length} heroes`)
        : h('p', { class: 'panel-note' }, `All ${sorted.length} heroes played.`)
    );
  }
}

function winrateOf(row) {
  const played = row.matches_played ?? 0;
  if (!played) return null;
  return ((row.wins ?? 0) / played) * 100;
}

/* ------------------------------------------------------------------ */
/* Match history                                                       */
/* ------------------------------------------------------------------ */

function renderMatches(listEl, footEl, descEl, state) {
  if (!listEl) return;
  const history = state.history;

  if (!Array.isArray(history) || history.length === 0) {
    listEl.replaceChildren(emptyState('No Deadlock matches recorded for this account yet.'));
    if (footEl) footEl.replaceChildren();
    if (descEl) descEl.textContent = 'Tracked by the Deadlock API';
    return;
  }

  const sorted = [...history].sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0));
  if (descEl) {
    descEl.textContent = `Last match ${fmt.timeAgo(sorted[0]?.start_time)} · tracked by the Deadlock API`;
  }

  const renderList = () => {
    listEl.replaceChildren(
      ...sorted.slice(0, state.matchCount).map((m) => {
        const hero = translate('heroes', m.hero_id);
        const outcome = outcomeEntry(m.player_match_outcome);
        const delta = m.ranked_delta;
        return h('li', { class: 'mrow' },
          h('div', { class: 'm-hero', title: `Match ${fmt.int(m.match_id)}` },
            heroIcon(hero, 'hero-icon sm'),
            h('span', { class: 'm-hero-name' }, hero.name),
          ),
          h('span', { class: 'm-result' },
            h('span', { class: `pill tone-${outcome.tone}`, title: outcome.name }, outcome.name),
          ),
          h('div', { class: 'm-detail' },
            h('span', { class: 'num m-kda' }, fmt.kda(m.player_kills, m.player_deaths, m.player_assists)),
            h('span', { class: 'num m-souls' }, fmt.int(m.net_worth)),
            h('span', { class: 'num m-dur' }, fmt.duration(m.match_duration_s)),
            delta == null
              ? h('span', { class: 'num m-pts muted' }, '\u2014')
              : h('span', { class: `num m-pts ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'muted'}` }, deltaSigned(delta)),
            h('span', { class: 'm-when' }, fmt.timeAgo(m.start_time)),
          ),
        );
      })
    );

    if (footEl) {
      const total = sorted.length;
      if (state.matchCount < total && state.matchCount < EXPANDED_MATCH_ROWS) {
        footEl.replaceChildren(
          h('button', {
            class: 'btn ghost full',
            type: 'button',
            onClick: () => {
              state.matchCount = EXPANDED_MATCH_ROWS;
              renderList();
            },
          }, `Show ${Math.min(EXPANDED_MATCH_ROWS, total)} of ${fmt.int(total)} matches`)
        );
      } else {
        footEl.replaceChildren(
          h('p', { class: 'panel-note' }, `Showing ${Math.min(state.matchCount, total)} of ${fmt.int(total)} matches`)
        );
      }
    }
  };
  renderList();
}

function deltaSigned(delta) {
  if (delta > 0) return `+${fmt.int(delta)}`;
  if (delta < 0) return `\u2212${fmt.int(Math.abs(delta))}`;
  return '0';
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function emptyState(message) {
  return h('li', { class: 'empty-state' }, message);
}

/** Replace a panel's list with an inline error + retry. */
function sectionError(listEl, panelEl, err, label, retryFn) {
  if (!listEl || !panelEl) return;
  listEl.replaceChildren();
  const old = panelEl.querySelector('.section-error');
  if (old) old.remove();
  const foot = panelEl.querySelector('.panel-foot');
  panelEl.insertBefore(
    h('div', { class: 'section-error' },
      h('p', {}, `Couldn\u2019t load ${label} (${errMessage(err)}).`),
      h('button', { class: 'btn text', type: 'button', onClick: retryFn }, 'Retry'),
    ),
    foot ?? null
  );
}

function errMessage(err) {
  if (err instanceof ApiError) return err.message;
  return err?.message || 'network error';
}
