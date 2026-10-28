# Soul Ledger - a Deadlock player lookup

A static, dependency-free website for looking up **Deadlock** players by Steam ID,
profile URL or display name. Enter `#/player/{account_id}` URLs, search from the
landing page, and read a player's rank, hero records and recent matches. Each
profile links to a dedicated `#/heroes/{account_id}` page with the complete
per-hero record, searchable and filterable by game mode.

**Live data** comes straight from the [Deadlock Community API](https://deadlock-api.com)
(CORS-open, no key required), so the site is pure static files and can be hosted
free on **GitHub Pages**. Personal project - not affiliated with Valve.

## Features

- **Search anything**: SteamID64 (`765611980…`), SteamID3 (`[U:1:…]`), bare
  account id, `steamcommunity.com/profiles/…` or `/id/vanity` URLs, or a plain
  display name (community search with live suggestions).
- **Full profile**: Steam identity, rank badge + tier, 30-day match count,
  lifetime win rate, heroes played.
- **Hero records**: top 10 most played heroes (games + win rate), linking to
  the full per-hero page.
- **Heroes page**: every hero played, aggregated client-side from the full
  match history — filter by game mode (Ranked, Unranked, Street Brawl, …),
  sort by games / win rate / name, search by hero name, per-hero average
  K/D/A and last-played times.
- **Match history**: result pills, K/D/A, souls (net worth), duration and
  ranked rating delta.
- **Match detail**: click any match row to expand it in place - hero level,
  queue label, full local timestamp, souls/min, last hits, denies, Street
  Brawl rounds, abandoned / low-priority / calibration flags, match ID with
  copy, plus both team rosters (per-player hero, name, K/D/A, souls, level,
  win/loss tags, combined souls; the queried player is highlighted) and
  calculated numbers: souls rank, kill participation, KDA ratio, shooting
  accuracy, and a gold net-worth sparkline. Rosters come from the match
  metadata endpoint, trimmed client-side and cached; very old matches that
  no longer carry metadata show row stats with an inline note.
- **Recents**: the last eight players you looked up, saved on this device only.
- **Optional Steam Web API key** (Settings, top right) for exact
  `steamcommunity.com/id/…` vanity resolution. Stored only in your browser's
  localStorage. Note: Steam's API does not send CORS headers, so browsers may
  block that call - the site falls back to the community-name search, which
  resolves most vanity URLs anyway.

## The dictionary system

The API returns raw integers everywhere (`hero_id: 67`, `rank badge: 52`,
`player_match_outcome: 1`). Nothing renders them raw: every value passes
through the translation layer in `src/lib/dictionaries/`:

| Module | Translates | Source |
|---|---|---|
| `heroes.js` | hero id → name, portrait, colour | baked JSON → live API refresh |
| `ranks.js` | badge (`tier*10+subrank`) → tier name + roman numeral + badge art | baked JSON → live API refresh |
| `modes.js` | `game_mode` / `match_mode` / `player_match_outcome` enums | confirmed values baked in code |
| `format.js` | numbers, durations, deltas, timestamps | code |
| `registry.js` | `translate(key, value)` - the one door every view uses | - |

Baked fallbacks live in `data/baked/*.json` so the site still renders readable
names even if the API is down. Refresh them after big game patches:

```
node scripts/fetch-dictionaries.mjs
```

At runtime each dictionary also keeps a 24h localStorage cache and silently
revalidates against the live API (stale-while-revalidate).

## Run it

Any static file server from the repo root works (ES modules need HTTP, not
`file://`):

```
python -m http.server 8080
# or
npx serve .
```

Then open <http://localhost:8080>.

## Deploy on GitHub Pages

1. Repo **Settings → Pages**.
2. **Build and deployment → Source: Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`. Save.
4. The site appears at `https://<user>.github.io/deadlock-website/`.

No build step, no workflow file, no secrets - the repo root is the whole site.

## Project layout

```
index.html                     page shell (top bar, footer, settings dialog)
styles/main.css                the whole design system (obsidian & gold)
src/main.js                    hash router + home view + recents
src/search.js                  input parsing + resolution pipeline
src/searchBox.js               live-suggestion search box (landing + top bar)
src/playerView.js              profile rendering (skeletons, retries, expandable match rows)
src/heroesView.js              per-player heroes page (filters, sorting, search)
src/settings.js                optional Steam Web API key storage
src/lib/api.js                 fetch layer (timeout, retry, cache)
src/lib/aggregate.js           match-history rows → per-hero records (shared source)
src/lib/util.js                tiny DOM helpers
src/lib/dictionaries/          the translation layer (see above)
data/baked/*.json              committed dictionary fallbacks
scripts/fetch-dictionaries.mjs regenerates the baked dictionaries
```
