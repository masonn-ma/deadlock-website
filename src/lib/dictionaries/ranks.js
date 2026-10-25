/**
 * Rank dictionary: rank badge integer (`tier * 10 + subrank`) → tier name,
 * subrank roman numeral, tier colour and the official badge artwork.
 *
 * Data source: /v1/assets/ranks (tier names + colours + large badge images).
 * Subrank artwork is a stable API URL pattern:
 *   https://api.deadlock-api.com/v1/assets/ranks/{tier}/{subrank}/image
 *
 * Loading order is the same reliability chain as heroes: localStorage cache →
 * baked data/baked/ranks.json → live API refresh.
 */
import { getRanksAsset } from '../api.js';
import { roman } from './format.js';

const CACHE_KEY = 'sl_dict_ranks_v1';
const TTL = 24 * 60 * 60 * 1000;
const ETERNUS_TIER = 11; // subranks are percentile cuts, no roman numerals

/** @type {Map<number, any>|null} */
let map = null;
let loadPromise = null;

async function load() {
  if (readCache()) return;

  try {
    const res = await fetch('data/baked/ranks.json', { headers: { accept: 'application/json' } });
    if (res.ok) {
      const baked = await res.json();
      ingest(baked, 'baked');
    }
  } catch {
    /* fall through */
  }

  try {
    const live = await getRanksAsset();
    ingest(
      live.map((r) => ({ tier: r.tier, name: r.name, color: r.color, badgeLarge: r.images?.large ?? null })),
      'live'
    );
  } catch {
    /* offline */
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.t > TTL) return false;
    ingest(entry.data, 'cache');
    return true;
  } catch {
    return false;
  }
}

function ingest(rows, source) {
  const next = new Map();
  for (const tier of rows) {
    if (tier?.tier == null || !tier.name) continue;
    next.set(Number(tier.tier), {
      tier: Number(tier.tier),
      name: tier.name,
      color: tier.color || '#97907f',
      badgeLarge: tier.badgeLarge ?? null,
    });
  }
  if (next.size === 0) return;
  map = next;
  if (source !== 'cache') {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: rows }));
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {number} badge  tier * 10 + subrank (e.g. 52 = Mystic II)
 * @returns {{ name: string, badge: string|null, color: string, tier: number, subrank: number } | null}
 */
function lookupBadge(badge) {
  const tier = Math.floor(Number(badge) / 10);
  const subrank = Number(badge) % 10;
  const tierEntry = map?.get(tier);
  if (!tierEntry) return null;

  const hasSub = subrank > 0 && tier !== ETERNUS_TIER;
  const name = hasSub ? `${tierEntry.name} ${roman(subrank)}` : tierEntry.name;
  const image = hasSub
    ? `https://api.deadlock-api.com/v1/assets/ranks/${tier}/${subrank}/image`
    : tierEntry.badgeLarge;
  return { name, badge: image, color: tierEntry.color, tier, subrank };
}

export const ranks = {
  async ready() {
    if (map) return;
    if (!loadPromise) loadPromise = load();
    await loadPromise;
  },

  /** Number of known rank tiers, for closing facts. */
  size() {
    return map?.size ?? 0;
  },

  /**
   * Accepts either a full badge int (52) or a {tier, subrank} pair.
   * @param {number|{tier:number, subrank:number}} value
   */
  lookup(value) {
    if (value == null) return null;
    const badge = typeof value === 'object' ? value.tier * 10 + value.subrank : Number(value);
    if (!Number.isFinite(badge)) return null;
    if (badge === 0) return { name: 'Unranked', badge: null, color: '#97907f', tier: 0, subrank: 0 };
    return lookupBadge(badge);
  },

  fallback(badge) {
    return { name: badge === 0 ? 'Unranked' : `Rank ${badge}`, badge: null, color: '#97907f' };
  },
};
