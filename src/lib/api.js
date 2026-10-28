/**
 * Fetch layer for the Deadlock Community API (https://deadlock-api.com).
 *
 * Every call goes through here so the whole site gets the same guarantees:
 *   - request timeout (AbortController) with one automatic retry on network / 5xx,
 *   - a short-lived in-memory + sessionStorage cache so re-visits feel instant,
 *   - typed errors with the API's own detail message when available.
 *
 * The API is CORS-open (`Access-Control-Allow-Origin: *`), so a static GitHub
 * Pages site can call it directly from the browser - no backend, no key.
 */

const BASE = 'https://api.deadlock-api.com/v1';
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_TTL = 5 * 60 * 1000; // player data cache: 5 minutes

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const memoryCache = new Map();

function cacheKey(url) {
  return `sl_cache:${url}`;
}

function readCache(url, ttl) {
  const mem = memoryCache.get(url);
  if (mem && Date.now() - mem.t < ttl) return mem.data;
  try {
    const raw = sessionStorage.getItem(cacheKey(url));
    if (!raw) return undefined;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.t < ttl) {
      memoryCache.set(url, entry);
      return entry.data;
    }
    sessionStorage.removeItem(cacheKey(url));
  } catch {
    /* storage unavailable (private mode) - cache simply doesn't work */
  }
  return undefined;
}

function writeCache(url, data) {
  const entry = { t: Date.now(), data };
  memoryCache.set(url, entry);
  try {
    sessionStorage.setItem(cacheKey(url), JSON.stringify(entry));
  } catch {
    /* quota exceeded - ignore, memory cache still works */
  }
}

async function fetchJsonOnce(url, timeout, signalContext) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signalContext) signalContext.push(controller);
  const timer = setTimeout(abort, timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.detail ?? body?.error ?? '';
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(detail || `API returned HTTP ${res.status}`, res.status);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    if (signalContext) {
      const i = signalContext.indexOf(controller);
      if (i >= 0) signalContext.splice(i, 1);
    }
  }
}

/**
 * GET a Deadlock API endpoint, with cache, timeout and one retry.
 * @param {string} path - path after `/v1`, e.g. `/players/steam`
 * @param {Record<string, string|number|boolean|null>} [params]
 * @param {{ttl?: number, timeout?: number, retries?: number, slim?: (data: any) => any}} [opts]
 *   `slim` trims the payload before it reaches the cache - use for oversized
 *   responses so sessionStorage never swallows megabytes of dead weight.
 */
export async function api(path, params = {}, opts = {}) {
  const { ttl = DEFAULT_TTL, timeout = DEFAULT_TIMEOUT, retries = 1 } = opts;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    qs.set(key, String(value));
  }
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`;

  const cached = readCache(url, ttl);
  if (cached !== undefined) return cached;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await fetchJsonOnce(url, timeout, opts.abortContext);
      const kept = opts.slim ? opts.slim(data) : data;
      writeCache(url, kept);
      return kept;
    } catch (err) {
      lastError = err;
      // Aborted by the caller (user navigated away) - don't retry.
      if (err.name === 'AbortError') throw new ApiError('Request timed out', 0);
      const retryable = err instanceof ApiError ? err.status === 0 || err.status >= 500 || err.status === 429 : true;
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw lastError instanceof ApiError ? lastError : new ApiError(lastError?.message || 'Network error', 0);
}

/* ------------------------------------------------------------------ */
/* Endpoint helpers                                                    */
/* ------------------------------------------------------------------ */

/** Name search → array of SteamAccount-ish rows (personaname, avatarfull, …). */
export async function searchPlayers(query, { limit = 8, relaxed = false } = {}) {
  try {
    return await api('/players/steam-search', {
      search_query: query,
      limit,
      // The API defaults this filter to 5; relaxing it finds profiles that
      // haven't played in the last 30 days.
      min_matches_played_last_30d: relaxed ? 0 : undefined,
      min_last_team_avg_badge: relaxed ? 0 : undefined,
    });
  } catch (err) {
    // The search endpoint answers 404 "No Steam profiles found." when a query
    // has zero hits - that is an empty result set, not a failure.
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

/** Batch Steam profiles. Accepts bare account ids (SteamID3 numbers). */
export function getSteamAccounts(accountIds) {
  return api('/players/steam', { account_ids: accountIds.join(',') }, { ttl: 10 * 60 * 1000 });
}

export function getPlayerRank(accountId) {
  return api(`/players/${accountId}/rank`, {}, { ttl: 60 * 1000 });
}

export function getHeroStats(accountId) {
  return api('/players/hero-stats', { account_ids: accountId });
}

export function getMatchHistory(accountId) {
  return api(`/players/${accountId}/match-history`);
}

/**
 * Match detail via the metadata endpoint - both team rosters with per-player
 * hero, K/D/A, souls and level. The raw payload is ~1MB per match (per-player
 * stat timelines, item builds), so it is trimmed to roster fields before it is
 * cached. A finished match never changes, so a long TTL is safe.
 */
export function getMatchMetadata(matchId) {
  return api(`/matches/${matchId}/metadata`, {}, { ttl: 24 * 60 * 60 * 1000, slim: slimMatchMetadata });
}

/** Keep only the roster fields the match-detail card renders. */
function slimMatchMetadata(raw) {
  const info = raw?.match_info ?? {};
  return {
    match_id: info.match_id,
    start_time: info.start_time,
    duration_s: info.duration_s,
    winning_team: info.winning_team,
    game_mode: info.game_mode,
    match_mode: info.match_mode,
    players: (info.players ?? []).map((p) => ({
      account_id: p.account_id,
      player_slot: p.player_slot,
      team: p.team,
      hero_id: p.hero_id,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      net_worth: p.net_worth,
      level: p.level,
      last_hits: p.last_hits,
      denies: p.denies,
      abandon_match_time_s: p.abandon_match_time_s,
    })),
  };
}

/** Dictionary sources (used by the dictionaries modules with a 24h cache). */
export function getHeroesAsset() {
  return api('/assets/heroes', { only_active: true }, { ttl: 24 * 60 * 60 * 1000 });
}

export function getRanksAsset() {
  return api('/assets/ranks', {}, { ttl: 24 * 60 * 60 * 1000 });
}

/**
 * Optional Steam Web API vanity resolution. Requires the visitor's own free
 * Steam Web API key (stored in localStorage). Steam's API does not send CORS
 * headers reliably, so this may fail in some browsers - callers must treat
 * `null` as "couldn't resolve, fall back to the community search".
 * @returns {Promise<string|null>} steamID64 or null
 */
export async function resolveVanity(steamApiKey, vanityUrl) {
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${encodeURIComponent(steamApiKey)}&vanityurl=${encodeURIComponent(vanityUrl)}`
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body?.response?.success === 1 ? body.response.steamid : null;
  } catch {
    return null; // CORS or network failure - caller falls back.
  }
}
