/**
 * Game mode / match mode / outcome dictionaries.
 *
 * These are numeric enums the Deadlock API emits in match data. The values are
 * confirmed from the API's ClickHouse schema (Enum8 definitions on the
 * `match_player` table), so they are baked in code rather than fetched:
 *
 *   match_mode: 0=Invalid 1=Unranked 2=PrivateLobby 3=CoopBot 4=Ranked
 *               5=ServerTest 6=Tutorial 7=HeroLabs 8=NewPlayerPlacement
 *   game_mode:  0=Invalid 1=Normal 2=OneVsOneTest 3=Sandbox 4=StreetBrawl
 *               5=ExploreNYC 6=Internal
 *   outcome:    0=Invalid 1=Win 2=Loss 3=Penalized 4=PenalizedParty 5=NotScored
 *
 * Unknown integers fall back to "Mode 9"-style text instead of ever breaking.
 */

const GAME_MODE = new Map([
  [0, 'Unknown'],
  [1, 'Normal'],
  [2, '1v1 Test'],
  [3, 'Sandbox'],
  [4, 'Street Brawl'],
  [5, 'Explore NYC'],
  [6, 'Internal'],
]);

const MATCH_MODE = new Map([
  [0, 'Unknown'],
  [1, 'Unranked'],
  [2, 'Private Lobby'],
  [3, 'Co-op Bot'],
  [4, 'Ranked'],
  [5, 'Server Test'],
  [6, 'Tutorial'],
  [7, 'Hero Labs'],
  [8, 'New Player Placement'],
]);

/** Player match outcome — how the match was scored for the player. */
const OUTCOME = new Map([
  [0, 'Invalid'],
  [1, 'Win'],
  [2, 'Loss'],
  [3, 'Penalized'],
  [4, 'Penalized Party'],
  [5, 'Not Scored'],
]);

/** Outcome → UI tone, so chips render consistently. */
export const OUTCOME_TONE = new Map([
  [1, 'positive'],
  [2, 'negative'],
  [3, 'warning'],
  [4, 'warning'],
  [5, 'neutral'],
]);

function makeDict(map, label) {
  return {
    lookup(value) {
      const name = map.get(Number(value));
      return name ? { name } : null;
    },
    fallback(value) {
      return { name: `${label} ${value}` };
    },
  };
}

export const gameMode = makeDict(GAME_MODE, 'Game mode');
export const matchMode = makeDict(MATCH_MODE, 'Match mode');
export const outcome = makeDict(OUTCOME, 'Outcome');

/**
 * One human label per match row: non-normal game modes (Street Brawl,
 * Sandbox, ...) carry their own name; otherwise it is the queue type
 * (Unranked, Ranked, Private Lobby, ...). This collapses the two enums into
 * the single dimension players actually think in when filtering.
 */
export function queueLabel(row) {
  const gm = Number(row?.game_mode ?? 0);
  if (gm !== 1) {
    const entry = gameMode.lookup(gm);
    return entry ? entry.name : gameMode.fallback(gm).name;
  }
  const mm = Number(row?.match_mode ?? 0);
  const entry = matchMode.lookup(mm);
  return entry ? entry.name : matchMode.fallback(mm).name;
}

/** Result of a match for one player, with its UI tone. */
export function outcomeEntry(value) {
  if (value == null) return { name: '\u2014', tone: 'neutral', unknown: true };
  const name = OUTCOME.get(Number(value));
  if (name) return { name, tone: OUTCOME_TONE.get(Number(value)) ?? 'neutral', unknown: false };
  return { name: `Outcome ${value}`, tone: 'neutral', unknown: true };
}
