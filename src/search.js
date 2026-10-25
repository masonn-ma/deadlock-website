/**
 * Search: parse any player identifier the user typed and resolve it to a
 * Deadlock account id.
 *
 * Accepted inputs:
 *   76561198016438058            SteamID64
 *   [U:1:236736049] / 236736049  SteamID3 / account id
 *   steamcommunity.com/profiles/7656…   numeric profile URL
 *   steamcommunity.com/id/vanity        vanity profile URL
 *   gabe                                display name (community search)
 */

import { searchPlayers, getSteamAccounts, resolveVanity } from './lib/api.js';

const STEAMID64_BASE = 76561197960265728;

export function accountFromSteamId64(steamId64) {
  // SteamID64s (~7.66e16) exceed Number.MAX_SAFE_INTEGER, so the arithmetic
  // must be BigInt; the resulting account id fits in a Number fine.
  try {
    const big = BigInt(String(steamId64).trim());
    const account = big - BigInt(STEAMID64_BASE);
    if (account <= 0n || account >= 2n ** 32n) return null;
    return Number(account);
  } catch {
    return null;
  }
}

export function steamId64FromAccount(accountId) {
  return String(STEAMID64_BASE + Number(accountId));
}

/** SteamID3 string for display: [U:1:236736049]. */
export function steamId3FromAccount(accountId) {
  return `[U:1:${accountId}]`;
}

/**
 * Parse raw input into a structured descriptor.
 * @returns {{ kind: 'account-id'|'steamid64'|'vanity'|'name', value: string }}
 */
export function parseInput(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return null;

  // Full profile URL (or bare steamcommunity host) → numeric or vanity
  const profiles = input.match(/steamcommunity\.com\/profiles\/(\d{6,20})/i);
  if (profiles) return { kind: 'steamid64', value: profiles[1] };

  const vanityInUrl = input.match(/steamcommunity\.com\/id\/([^/\s?#]+)/i);
  if (vanityInUrl) {
    try {
      return { kind: 'vanity', value: decodeURIComponent(vanityInUrl[1]) };
    } catch {
      return { kind: 'vanity', value: vanityInUrl[1] };
    }
  }

  const steamId3 = input.match(/^\[?U:1:(\d{1,10})\]?$/i);
  if (steamId3) return { kind: 'account-id', value: steamId3[1] };

  if (/^7656119\d{10}$/.test(input)) return { kind: 'steamid64', value: input };

  if (/^\d{1,10}$/.test(input)) return { kind: 'account-id', value: input };

  return { kind: 'name', value: input };
}

/**
 * Resolve parsed input to a result for the router.
 * @returns {Promise<
 *   { status:'ok', accountId: string } |
 *   { status:'candidates', candidates: Array, query: string } |
 *   { status:'empty', message: string } |
 *   { status:'invalid', message: string }
 * >}
 */
export async function resolveInput(raw, opts = {}) {
  const parsed = parseInput(raw);
  if (!parsed) return { status: 'invalid', message: 'Type a Steam ID, profile URL or display name.' };

  if (parsed.kind === 'account-id') {
    const accountId = Number(parsed.value);
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || accountId >= 2 ** 32) {
      return { status: 'invalid', message: `That account id doesn\u2019t look valid: ${parsed.value}` };
    }
    return { status: 'ok', accountId: String(accountId) };
  }

  if (parsed.kind === 'steamid64') {
    const accountId = accountFromSteamId64(parsed.value);
    if (accountId == null) {
      return { status: 'invalid', message: `That SteamID64 doesn\u2019t look valid: ${parsed.value}` };
    }
    return { status: 'ok', accountId: String(accountId) };
  }

  if (parsed.kind === 'vanity') return resolveVanityInput(parsed.value, opts);
  return resolveNameInput(parsed.value, opts);
}

/**
 * Vanity URL: the Deadlock community search indexes profile URLs, so we search
 * the vanity name and look for an exact `/id/{vanity}/` match. If the visitor
 * has saved a Steam Web API key we try Steam's exact resolver first.
 */
async function resolveVanityInput(vanity, opts) {
  if (opts.steamKey) {
    const steamId64 = await resolveVanity(opts.steamKey, vanity);
    if (steamId64) {
      const accountId = accountFromSteamId64(steamId64);
      if (accountId != null) return { status: 'ok', accountId: String(accountId) };
    }
  }

  const candidates = await searchCandidates(vanity, { relaxed: true });
  const exact = candidates.find(
    (c) => (c.profileurl || '').toLowerCase().includes(`/id/${vanity.toLowerCase()}/`)
  );
  if (exact) return { status: 'ok', accountId: String(exact.account_id) };

  if (candidates.length) {
    return { status: 'candidates', candidates, query: vanity };
  }

  return {
    status: 'empty',
    message:
      `Couldn\u2019t resolve \u201c${vanity}\u201d. Steam\u2019s vanity lookup needs a Steam Web API key ` +
      `(Settings, top right). Or paste the numeric profile URL: steamcommunity.com/profiles/…`,
  };
}

/** Display name: community search, ranked by activity. One strong hit → go. */
async function resolveNameInput(name, opts) {
  let candidates = await searchCandidates(name);
  if (!candidates.length) candidates = await searchCandidates(name, { relaxed: true });

  if (!candidates.length) {
    return { status: 'empty', message: `No Deadlock players found for \u201c${name}\u201d.` };
  }

  const exact = candidates.filter((c) => (c.personaname || '').toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return { status: 'ok', accountId: String(exact[0].account_id) };
  if (candidates.length === 1) return { status: 'ok', accountId: String(candidates[0].account_id) };

  return { status: 'candidates', candidates, query: name };
}

async function searchCandidates(query, { relaxed = false } = {}) {
  const rows = await searchPlayers(query, { limit: 8, relaxed });
  const seen = new Set();
  return rows.filter((row) => {
    if (row?.account_id == null || seen.has(row.account_id)) return false;
    seen.add(row.account_id);
    return true;
  });
}

/** Quick lookup used by the live suggestion dropdown. */
export function quickSearch(query) {
  return searchCandidates(query);
}

/** Fetch the Steam profile for an account id (used to confirm a direct hit). */
export async function fetchProfile(accountId) {
  const rows = await getSteamAccounts([Number(accountId)]);
  return rows?.[0] ?? null;
}
