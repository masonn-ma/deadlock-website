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

import { getSteamAccounts, getPlayerRank, getMatchHistory, getMatchMetadata, ApiError } from './lib/api.js';
import { aggregateHistory } from './lib/aggregate.js';
import { translate } from './lib/dictionaries/registry.js';
import { outcomeEntry, queueLabel } from './lib/dictionaries/modes.js';
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
    expandedMatchId: null,   // one open accordion row at a time
    matchDetails: new Map(), // matchId -> { status, data?, names?, error? }
    matchesRerender: null,   // live renderList hook for async roster updates
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
    h('span', {}, ''),
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
    descEl.textContent = `Last match ${fmt.timeAgo(sorted[0]?.start_time)} \u00b7 click a row for details`;
  }

  /** Open/close a row (one accordion at a time) and fetch rosters once. */
  const toggleMatch = (matchId) => {
    const expanding = state.expandedMatchId !== matchId;
    state.expandedMatchId = expanding ? matchId : null;
    if (expanding) ensureMatchDetail(state, matchId);
    renderList();
  };

  const renderList = () => {
    if (!listEl.isConnected) return; // view replaced by another route render
    state.matchesRerender = renderList; // async roster updates retarget the live list
    listEl.replaceChildren(
      ...sorted.slice(0, state.matchCount).map((m) => matchRow(m, state, toggleMatch))
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

/* ------------------------------------------------------------------ */
/* Match expansion: row = accordion header, panel = detail layers       */
/* ------------------------------------------------------------------ */

/**
 * One match row. Collapsed it is the clickable summary grid; expanded it also
 * carries the detail panel (grid-column 1/-1) below the columns.
 */
function matchRow(m, state, toggleMatch) {
  const hero = translate('heroes', m.hero_id);
  const outcome = rowOutcome(m);
  const expanded = state.expandedMatchId === m.match_id;
  const delta = m.ranked_delta;
  return h('li', {
      class: `mrow${expanded ? ' expanded' : ''}`,
      role: 'button',
      tabindex: '0',
      'aria-expanded': String(expanded),
      'aria-label': `Match details, ${hero.name}`,
      onClick: (e) => {
        if (e.target.closest('button, a')) return; // inner controls manage themselves
        toggleMatch(m.match_id);
      },
      onKeydown: (e) => {
        if (e.target !== e.currentTarget) return; // inner controls handle their own keys
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleMatch(m.match_id);
      },
    },
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
    chevEl(),
    expanded ? matchExpand(m, state) : null,
  );
}

/** Collapsed-row chevron that rotates when the row is open. */
function chevEl() {
  const el = document.createElement('span');
  el.className = 'm-chev';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">'
    + '<path d="M3 1.5 6.5 5 3 8.5" stroke="currentColor" stroke-width="1.5" '
    + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return el;
}

/**
 * Expanded detail panel. Layer 1 is derived from the history row alone
 * (instant, no network); layer 2 is the fetched team roster.
 */
function matchExpand(m, state) {
  const hero = translate('heroes', m.hero_id);
  const brawl = m.game_mode === 4 && m.brawl_score_team0 != null && m.brawl_score_team1 != null;

  const stats = [
    ['Souls / min', fmt.perMin(m.net_worth, m.match_duration_s)],
    ['Last hits', fmt.int(m.last_hits)],
    ['Denies', fmt.int(m.denies)],
  ];
  if (brawl) {
    const mine = m.player_team === 0 ? m.brawl_score_team0 : m.brawl_score_team1;
    const theirs = m.player_team === 0 ? m.brawl_score_team1 : m.brawl_score_team0;
    stats.push(['Rounds', `${fmt.int(mine)} \u2013 ${fmt.int(theirs)}`]);
  }

  const flags = [];
  if (m.abandoned_time_s > 0) {
    flags.push(h('span', { class: 'pill tone-warning', title: `Abandoned at ${fmt.duration(m.abandoned_time_s)}` },
      `Abandoned ${fmt.duration(m.abandoned_time_s)}`));
  }
  if (m.low_pri_pool) flags.push(h('span', { class: 'pill tone-warning' }, 'Low priority'));
  if (m.ranked_calibration_match) flags.push(h('span', { class: 'pill tone-neutral' }, 'Calibration'));
  if (m.ranked_used_demotion_protection) flags.push(h('span', { class: 'pill tone-neutral' }, 'Demotion protection'));

  return h('div', { class: 'm-expand' },
    h('div', { class: 'm-x-head' },
      h('div', { class: 'm-x-hero' },
        heroIcon(hero, 'hero-icon sm'),
        h('span', { class: 'm-x-hero-name' }, hero.name),
        m.hero_level != null ? h('span', { class: 'm-x-level' }, `Level ${m.hero_level}`) : null,
      ),
      h('div', { class: 'm-x-meta' },
        h('span', { class: 'pill tone-neutral', title: 'Queue' }, queueLabel(m)),
        h('span', { class: 'm-x-date' }, fmt.dateTime(m.start_time)),
      ),
    ),
    h('div', { class: 'm-x-id' }, `Match ${fmt.int(m.match_id)}`, copyChip(String(m.match_id), 'Copy ID')),
    h('div', { class: 'm-x-stats' },
      stats.map(([label, value]) =>
        h('span', { class: 'm-x-stat' },
          h('span', { class: 'm-x-stat-label' }, label),
          h('span', { class: 'num m-x-stat-value' }, value),
        )
      ),
    ),
    flags.length ? h('div', { class: 'm-x-flags' }, flags) : null,
    h('div', { class: 'm-x-roster' }, matchRoster(m, state)),
  );
}

/** Layer 2: both team rosters, with skeletons while the fetch is in flight. */
function matchRoster(m, state) {
  const entry = state.matchDetails.get(m.match_id);

  if (!entry || entry.status === 'loading') {
    return h('div', { class: 'm-teams' }, rosterSkeleton(), rosterSkeleton());
  }

  if (entry.status === 'error') {
    return h('div', { class: 'm-x-roster-error' },
      h('span', {}, `Team rosters unavailable (${entry.error}).`),
      h('button', {
        class: 'btn text',
        type: 'button',
        onClick: () => ensureMatchDetail(state, m.match_id),
      }, 'Retry'),
    );
  }

  const data = entry.data;
  const byId = new Map((entry.names ?? []).map((n) => [n.account_id, n.personaname]));
  const mine = m.player_team ?? data.players[0]?.team ?? 0;

  const rosterRows = (side) => data.players
    .filter((p) => p.team === side)
    .sort((a, b) => (b.net_worth ?? 0) - (a.net_worth ?? 0))
    .map((p) => {
      const hero = translate('heroes', p.hero_id);
      const isMe = Number(p.account_id) === Number(state.accountId);
      return h('div', { class: `m-r-row${isMe ? ' you' : ''}` },
        h('span', { class: 'm-r-name' },
          heroIcon(hero, 'hero-icon sm'),
          h('span', { class: 'm-r-names' },
            h('span', { class: 'm-r-hero' }, hero.name),
            h('span', { class: 'm-r-player', title: `[U:1:${p.account_id}]` },
              byId.get(p.account_id) ?? `[U:1:${p.account_id}]`,
            ),
          ),
        ),
        h('span', { class: 'num m-r-kda' }, fmt.kda(p.kills, p.deaths, p.assists)),
        h('span', { class: 'num m-r-nw' }, fmt.int(p.net_worth)),
        h('span', { class: 'num m-r-lv' }, p.level ?? '\u2014'),
      );
    });

  const teamCol = (side, label) => {
    const won = side === data.winning_team;
    return h('div', { class: 'm-team' },
      h('div', { class: 'm-team-head' },
        h('span', { class: 'm-team-name' }, label),
        h('span', { class: `m-team-outcome ${won ? 'win' : 'loss'}` }, won ? 'Win' : 'Loss'),
      ),
      rosterRows(side),
    );
  };

  return h('div', { class: 'm-teams' },
    teamCol(mine, 'Your team'),
    teamCol(mine === 0 ? 1 : 0, 'Enemy team'),
  );
}

function rosterSkeleton() {
  return h('div', { class: 'm-team' },
    h('span', { class: 'skel', style: 'width:96px;height:12px' }),
    Array.from({ length: 4 }, () =>
      h('div', { class: 'm-r-row' },
        h('span', { class: 'm-r-name' },
          h('span', { class: 'skel icon-sk', style: 'width:20px;height:20px' }),
          h('span', { class: 'skel', style: 'flex:1;height:12px' }),
        ),
        h('span', { class: 'skel', style: 'width:64px;height:12px' }),
        h('span', { class: 'skel', style: 'width:44px;height:12px' }),
        h('span', { class: 'skel', style: 'width:16px;height:12px' }),
      )
    ),
  );
}

/**
 * Fetch and cache one match's roster data. `state.matchDetails` keeps the
 * result for the whole view (re-renders never refetch); a Steam-name failure
 * degrades to account ids instead of blanking the rosters.
 */
async function ensureMatchDetail(state, matchId) {
  const existing = state.matchDetails.get(matchId);
  if (existing && existing.status !== 'error') return;
  const entry = { status: 'loading' };
  state.matchDetails.set(matchId, entry);
  if (state.expandedMatchId === matchId) state.matchesRerender?.(); // error -> skeleton right away
  try {
    const meta = await getMatchMetadata(matchId);
    // Names are cosmetic - a Steam hiccup must not sink the whole panel.
    const names = await getSteamAccounts(meta.players.map((p) => p.account_id)).catch(() => null);
    entry.status = 'ok';
    entry.data = meta;
    entry.names = names;
  } catch (err) {
    entry.status = 'error';
    entry.error = errMessage(err);
  }
  if (state.expandedMatchId === matchId) state.matchesRerender?.();
}

/** Row pill: the scored outcome when present, else the verified
 *  match_result === player_team win test (old rows carry no outcome enum). */
function rowOutcome(m) {
  const entry = outcomeEntry(m.player_match_outcome);
  if (!entry.unknown) return entry;
  if (m.player_team == null || m.match_result == null) return entry;
  return m.match_result === m.player_team
    ? { name: 'Win', tone: 'positive' }
    : { name: 'Loss', tone: 'negative' };
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
