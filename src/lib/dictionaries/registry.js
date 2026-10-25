/**
 * The dictionary registry — the site's integer → human-readable translation layer.
 *
 * No component ever renders a raw API integer directly. Data passes through
 * `translate(dictKey, value)`, which returns a normalised entry:
 *
 *   { name: 'Infernus', icon: 'https://…', color: '#C93C26', unknown: false }
 *
 * Every dictionary degrades gracefully: if a value is missing from the map,
 * `translate()` still returns something presentable (`Hero #67`), so the UI
 * keeps working even when Valve adds content the dictionaries don't know yet.
 *
 * Dictionaries register themselves:
 *
 *   register('heroes', heroesDict)   // src/lib/dictionaries/heroes.js
 *   register('ranks',  ranksDict)    // src/lib/dictionaries/ranks.js
 *   register('modes',  modesDict)    // src/lib/dictionaries/modes.js
 */

const registry = new Map();

/** Register a dictionary module under a key. */
export function register(key, module) {
  registry.set(key, module);
}

/** Resolve every registered dictionary (fetch/parse) before first use. */
export async function ready(keys = [...registry.keys()]) {
  await Promise.all(
    keys.map((key) => {
      const mod = registry.get(key);
      return mod?.ready?.().catch((err) => {
        console.warn(`[dictionaries] ${key} failed to load:`, err);
      });
    })
  );
}

/**
 * Translate a raw value into a display entry.
 * @param {string} key  dictionary key, e.g. 'heroes'
 * @param {number|string|null} value  the raw integer (or string) from the API
 * @param {object} [extra]  per-dictionary context (e.g. { subrank })
 * @returns {{ name: string, icon?: string, color?: string, url?: string, unknown: boolean }}
 */
export function translate(key, value, extra) {
  if (value == null || value === '') return { name: '\u2014', unknown: true };
  const mod = registry.get(key);
  if (!mod) return { name: String(value), unknown: true };
  const entry = mod.lookup(value, extra);
  if (entry) return { unknown: false, ...entry };
  return { ...(mod.fallback ? mod.fallback(value) : { name: String(value) }), unknown: true };
}
