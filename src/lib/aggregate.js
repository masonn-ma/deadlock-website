/**
 * Client-side aggregation of raw match-history rows into per-hero records.
 *
 * The match-history endpoint is the single source of truth for hero data: the
 * same rows feed the profile page's top-10 panel, its career KPIs and the
 * dedicated heroes page, so numbers always agree between pages.
 *
 * A win is reconstructed from the winner's team id (match_result) compared
 * with the player's own team (player_team). player_match_outcome is only
 * populated on recent matches, but the two agree on every row where both
 * exist (verified live), and match_result is present on all rows.
 */

import { queueLabel } from './dictionaries/modes.js';

/**
 * @param {Array} rows - raw match-history rows
 * @param {{ modeKey?: string|null }} [opts] - queue label to filter to, or null for all modes
 * @returns {{ perHero: Array, totalGames: number, totalWins: number, heroCount: number }}
 */
export function aggregateHistory(rows, { modeKey = null } = {}) {
  const perHero = new Map();
  for (const m of rows ?? []) {
    if (modeKey != null && queueLabel(m) !== modeKey) continue;
    const a = perHero.get(m.hero_id) ??
      { heroId: m.hero_id, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, lastPlayed: 0 };
    a.games += 1;
    if (m.match_result === m.player_team) a.wins += 1;
    a.kills += m.player_kills ?? 0;
    a.deaths += m.player_deaths ?? 0;
    a.assists += m.player_assists ?? 0;
    a.lastPlayed = Math.max(a.lastPlayed, m.start_time ?? 0);
    perHero.set(m.hero_id, a);
  }

  const list = [...perHero.values()].map((a) => ({
    heroId: a.heroId,
    matches_played: a.games,
    wins: a.wins,
    losses: a.games - a.wins,
    kills: a.kills,
    deaths: a.deaths,
    assists: a.assists,
    last_played: a.lastPlayed || null,
  }));

  return {
    perHero: list,
    totalGames: list.reduce((s, r) => s + r.matches_played, 0),
    totalWins: list.reduce((s, r) => s + r.wins, 0),
    heroCount: list.length,
  };
}

/**
 * Distinct queue labels in a history with their counts, most played first.
 * @returns {Array<{ label: string, games: number }>}
 */
export function modeBreakdown(rows) {
  const counts = new Map();
  for (const m of rows ?? []) {
    const label = queueLabel(m);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, games]) => ({ label, games }));
}
