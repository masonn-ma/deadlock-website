/**
 * Hero dictionary: hero_id (integer) → { name, icon, color, … }.
 *
 * Loading order, most reliable first:
 *   1. localStorage cache (24h TTL)      - instant, offline-safe
 *   2. data/baked/heroes.json            - committed with the repo, always there
 *   3. live API (/v1/assets/heroes)      - background refresh; updates cache
 *
 * `ready()` resolves once at least one source succeeded (or all failed, in
 * which case lookups fall back to "Hero #67" text and never break the UI).
 */
import { getHeroesAsset } from '../api.js';

const CACHE_KEY = 'sl_dict_heroes_v1';
const TTL = 24 * 60 * 60 * 1000;

/** @type {Map<number, any>|null} */
let map = null;
let loadPromise = null;

async function load() {
  // 1. localStorage
  if (readCache()) return;

  // 2. baked file shipped with the repo
  try {
    const res = await fetch('data/baked/heroes.json', { headers: { accept: 'application/json' } });
    if (res.ok) {
      const baked = await res.json();
      ingest(baked, 'baked');
    }
  } catch {
    /* fall through to live API */
  }

  // 3. live refresh (also covers the no-baked-file case)
  try {
    const live = await getHeroesAsset();
    ingest(live, 'live');
  } catch {
    /* offline - baked copy (if any) keeps the site working */
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

/**
 * Normalise either the baked shape (already slim) or the raw asset rows
 * (full hero objects) into the internal map.
 */
function ingest(rows, source) {
  const next = new Map();
  for (const hero of rows) {
    const entry = normalize(hero);
    if (entry && entry.id != null) next.set(Number(entry.id), entry);
  }
  if (next.size === 0) return;
  map = next;
  if (source !== 'cache') {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: rows }));
    } catch {
      /* storage full - fine */
    }
  }
}

function normalize(hero) {
  if (hero == null) return null;
  const images = hero.images ?? {};
  return {
    id: hero.id,
    name: hero.name ?? hero.displayed_name ?? null,
    className: hero.class_name ?? hero.className ?? null,
    type: hero.hero_type ?? hero.type ?? null,
    complexity: hero.complexity ?? null,
    color: hero.colors?.style_hex ?? hero.color ?? null,
    icon: hero.icon ?? images.icon_image_small_webp ?? images.icon_image_small ?? null,
    iconCard: hero.iconCard ?? images.icon_hero_card_webp ?? images.icon_hero_card ?? null,
  };
}

export const heroes = {
  async ready() {
    if (map) return;
    if (!loadPromise) loadPromise = load();
    await loadPromise;
  },

  /** Number of known heroes, for "n heroes baked in" style facts. */
  size() {
    return map?.size ?? 0;
  },

  /**
   * @param {number} heroId
   * @returns {{ name: string, icon: string|null, color: string, type: string|null, card: string|null } | null}
   */
  lookup(heroId) {
    const hero = map?.get(Number(heroId));
    if (!hero || !hero.name) return null;
    return {
      name: hero.name,
      icon: hero.icon,
      color: hero.color || '#97907f',
      type: hero.type,
      card: hero.iconCard,
    };
  },

  fallback(heroId) {
    return {
      name: `Hero #${heroId}`,
      icon: null,
      color: '#97907f',
      type: null,
      card: null,
    };
  },
};
