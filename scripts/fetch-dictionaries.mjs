#!/usr/bin/env node
/**
 * Refreshes the baked dictionaries in data/baked/ from the Deadlock Community API.
 *
 * The site ships with these baked JSON files so it keeps working (and renders
 * human-readable names) even when the API is unreachable. Run this occasionally
 * — e.g. after a big game patch — to pick up new heroes or rank changes:
 *
 *   node scripts/fetch-dictionaries.mjs
 *
 * Sources:
 *   https://api.deadlock-api.com/v1/assets/heroes  (hero id -> name, icon, colour)
 *   https://api.deadlock-api.com/v1/assets/ranks   (rank tier -> name, colour, badge art)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data', 'baked');
const API = 'https://api.deadlock-api.com/v1';

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const heroesRaw = await getJson(`${API}/assets/heroes?only_active=true`);
  const heroes = heroesRaw.map((h) => ({
    id: h.id,
    name: h.name,
    className: h.class_name,
    type: h.hero_type ?? null,
    complexity: h.complexity ?? null,
    color: h.colors?.style_hex ?? null,
    icon: h.images?.icon_image_small_webp ?? h.images?.icon_image_small ?? null,
    iconCard: h.images?.icon_hero_card_webp ?? h.images?.icon_hero_card ?? null,
  }));
  heroes.sort((a, b) => a.id - b.id);
  const heroesPath = join(OUT_DIR, 'heroes.json');
  await writeFile(heroesPath, JSON.stringify(heroes, null, 2) + '\n', 'utf8');
  console.log(`heroes.json  -> ${heroes.length} heroes`);

  const ranksRaw = await getJson(`${API}/assets/ranks`);
  const ranks = ranksRaw.map((r) => ({
    tier: r.tier,
    name: r.name,
    color: r.color ?? null,
    badgeLarge: r.images?.large ?? null,
  }));
  ranks.sort((a, b) => a.tier - b.tier);
  const ranksPath = join(OUT_DIR, 'ranks.json');
  await writeFile(ranksPath, JSON.stringify(ranks, null, 2) + '\n', 'utf8');
  console.log(`ranks.json   -> ${ranks.length} tiers`);

  console.log('Done. Committed baked dictionaries are the site\u2019s offline fallback.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
