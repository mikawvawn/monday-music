# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build         # tsc → dist/
npm test              # tsc + node --test dist/*.test.js
npm start             # run pipeline → writes public/index.html (the static site)
npm run dev           # ts-node (skips build step, for quick iteration)
npm run debug:releases  # full pipeline instrumentation — writes two CSVs to /tmp/
fly deploy --remote-only  # build nginx image from public/ + deploy to Fly
```

Source `.env` before running locally — the project does not use the dotenv package:
```bash
set -a && source .env && set +a && unset ANTHROPIC_BASE_URL && node dist/index.js
set -a && source .env && set +a && unset ANTHROPIC_BASE_URL && npm run debug:releases
```

The generated site is `public/index.html` (gitignored — regenerated each run). Preview
it locally with any static server, e.g. `python3 -m http.server 8899 --directory public`.

### Debug / diagnostic tools

**Release pipeline debugger** (`npm run debug:releases`):
Instruments every stage of the new-release funnel and writes two CSV files to `/tmp/`:
- `monday-music-debug-candidates-YYYY-MM-DD.csv` — one row per RSS item, traced through every filter stage with drop reasons and code refs
- `monday-music-debug-summary-YYYY-MM-DD.csv` — stage-level counts (items in/out/dropped) with notes and code refs

Upload to Google Sheets for analysis. Key columns: `RSS_PASS`, `CLAUDE_PROPOSED`, `SPOTIFY_MATCH`, `RECENCY_CHECK`, `FINAL_STATUS`.

**Taste profile check** (quick node one-liner):
```bash
set -a && source .env && set +a && node -e "
const { getAccessToken, getTopArtists } = require('./dist/spotify.js');
const { buildTasteProfile } = require('./dist/profile.js');
getAccessToken().then(t => getTopArtists(t, 'medium_term')).then(a => console.log(buildTasteProfile(a, 'Mike')));
"
```
Shows the exact taste profile string that will be sent to Claude on the next run.

## Environment Variables

Four vars are required to generate the site:

| Var | Source |
|-----|--------|
| `SPOTIFY_CLIENT_ID` | Spotify developer app |
| `SPOTIFY_CLIENT_SECRET` | Spotify developer app |
| `SPOTIFY_REFRESH_TOKEN` | OAuth flow (cached in `~/.spotify-mcp/tokens.json` locally) |
| `ANTHROPIC_API_KEY` | Anthropic console |

There is no email step anymore — `RESEND_API_KEY` is unused. Deploying to Fly (CI only)
additionally needs `FLY_API_TOKEN` (GitHub repo secret; a Fly deploy token for the app).

## Spotify API Rules

You are helping build an application using the Spotify Web API. Follow these rules:

- OpenAPI spec: Refer to the Spotify OpenAPI specification at https://developer.spotify.com/reference/web-api/open-api-schema.yaml for all endpoint paths, parameters, and response schemas. Do not guess endpoints or field names.
- Authorization: Use the Authorization Code with PKCE flow (https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow) for any user-specific data. If the app has a secure backend, the Authorization Code flow (https://developer.spotify.com/documentation/web-api/tutorials/code-flow) is also acceptable. Only use Client Credentials for public, non-user data. Never use the Implicit Grant flow; it is deprecated.
- Redirect URIs: Always use HTTPS redirect URIs, except `http://127.0.0.1` for local development. Never use `http://localhost` or wildcard URIs. See https://developer.spotify.com/documentation/web-api/concepts/redirect_uri for requirements.
- Scopes: Request only the minimum scopes (https://developer.spotify.com/documentation/web-api/concepts/scopes) needed for the features being built. Do not request broad scopes preemptively.
- Token management: Store tokens securely. Never expose the Client Secret in client-side code. Implement token refresh (https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens) so the app does not break when access tokens expire.
- Rate limits: Implement exponential backoff and respect the `Retry-After` header when receiving HTTP 429 responses. Do not retry immediately or in tight loops.
- Deprecated endpoints: Do not use deprecated endpoints. Prefer `/playlists/{id}/items` over `/playlists/{id}/tracks`, and use `/me/library` over the type-specific library endpoints.
- Error handling: Handle all HTTP error codes documented in the OpenAPI schema. Read the returned error message and use it to provide meaningful feedback to the user.
- Developer Terms of Service: Comply with the Spotify Developer Terms (https://developer.spotify.com/terms). In particular: do not cache Spotify content beyond what is needed for immediate use, always attribute content to Spotify, and do not use the API to train machine learning models on Spotify data.

## Architecture

The pipeline runs in `src/index.ts` and produces a static web page (`public/index.html`).
There is no Spotify playlist creation and no email — those were removed. Stages:

**1. Parallel data fetch**
- Spotify: recent tracks (50), top tracks (50, medium-term), recent playlists, user ID, top artists with genres
- RSS: source-configured publication feeds via `src/newReleases.ts` → `NewRelease[]`
- **Current state (late April 2026):** feeds currently configured include Pitchfork, Stereogum, Bandcamp Daily, Resident Advisor, Paste, Fact, Pigeons & Planes, Brooklyn Vegan, Crack Magazine, The Fader, and Line of Best Fit.
- **Observed reliability in latest preview/debug runs:** Pitchfork, Stereogum, Bandcamp Daily, Paste, Brooklyn Vegan, Crack, The Fader, and Line of Best Fit returned items; Resident Advisor and Pigeons & Planes still 404; Fact returns 0 items.

**2. Claude curation** (`src/claude.ts`)
- `curateNewReleases()` → `CuratedBuckets { releases, news }` — two separate arrays, no artist overlap between them. Claude proposes up to 20 release candidates (aims for 15) + up to 10 news candidates ranked by fit.
- Receives a `tasteProfile` string built by `buildTasteProfile()` in `src/profile.ts` from the user's Spotify top 50 medium-term artists.

**3. Sequential Spotify enrichment + validation**
- Search each suggested track → build `foundTracks: Track[]`
- `enrichAndFilterReleases()` in `src/enrichReleases.ts` validates each release candidate: artist match via `searchAlbumInfo()` + 30-day recency via `isRecentRelease()`. Walks ranked candidates, stops at `NR_TARGET = 5`.
- If fewer than 5 pass: calls `curateMoreReleases()` for up to 10 more candidates (excluding already-seen URLs), re-validates, merges with `dedupeReleasesByArtist()`.
- `filterNewsByReleaseArtists()` drops any news item whose artist already appears in validated releases. Caps at `NEWS_TARGET = 5`.

**4. Render static site**
- `buildSiteHtml()` in `src/render.ts` → standalone HTML with three sections: Recent Favorites (top short-term artists/tracks), New Releases, Music News. No playlist section.
- Written to `public/index.html`. `nginx:alpine` (see `Dockerfile` + `deploy/nginx.conf`) serves it on Fly.

## Key Types

```typescript
// src/spotify.ts
interface Track { id, name, artist, artistId, album, url }

// src/claude.ts
interface CuratedRelease { artist, title, blurb, source, url, imageUrl?, spotifyUrl?, releaseType? }
interface CuratedBuckets { releases: CuratedRelease[]; news: CuratedRelease[] }
```

`CuratedRelease.releaseType` (e.g. "album", "single", "EP") comes from Spotify search, not the RSS feed.

## Key Helpers (`src/spotify.ts`)

- `normalizeArtist(name)` — strips diacritics, leading "the", collab suffixes (feat./ft./x/&); used for fuzzy artist matching
- `artistsMatch(a, b)` — normalized equality; requires exact match for strings < 4 chars to avoid false positives
- `isRecentRelease(dateStr, days, now?)` — true if date is within `days` of now (allows 7-day future window for scheduled drops)
- `searchAlbumInfo(artist, title, token)` — searches Spotify, returns first result where artist matches; returns `EMPTY_INFO` on no match

## Deployment

The site is hosted on Fly as app **`monday-music-mv`** → https://monday-music-mv.fly.dev
(nginx serving `public/index.html`, scaled to zero when idle).

The GitHub Actions workflow (`.github/workflows/monday-music.yml`, repo `mikawvawn/monday-music`)
runs every Monday at 8:30am ET: it regenerates `public/index.html` and runs `flyctl deploy`,
so the site refreshes weekly with no dependency on any local machine. Trigger manually from the
Actions tab (workflow_dispatch) or `gh workflow run "Monday Music"`. Secrets in GitHub: the four
Spotify/Anthropic vars + `FLY_API_TOKEN` (Fly deploy token).

To push source changes:
```bash
npm run build  # catch TS errors locally first
git push origin main
```

## Session Notes (Jul 2026)

### Session 2026-07-27 — Pivot: email → static site on Fly; killed the playlist

- **Root cause of "won't run anymore":** the pipeline actually ran fine end-to-end; it only crashed on a final verification call (`getPlaylistTracks` → deprecated `GET /playlists/{id}/tracks` → 403). And the local `.env` had no `RESEND_API_KEY`, so the email step would have failed anyway.
- **Killed the playlist entirely** (per user): removed `generatePlaylist`/`describePlaylist` (`claude.ts`) and `createPlaylist`/`addTracksToPlaylist`/`getPlaylistTracks`/`buildDiscoveryPool` (`spotify.ts`). Kept `interleaveByArtist` (still unit-tested) and the generic search helpers.
- **Killed email:** deleted `email.ts` + `preview.ts`. New `src/render.ts` → `buildSiteHtml()` renders a standalone responsive page (Recent Favorites → New Releases → Music News). `src/index.ts` rewritten to fetch → curate → validate → write `public/index.html`.
- **Hosting:** new Fly app `monday-music-mv` (nginx:alpine, `Dockerfile` + `deploy/nginx.conf`, `fly.toml`, scale-to-zero). First deploy done manually; weekly refresh via the rewritten GitHub Action (`FLY_API_TOKEN` secret added).
- **Design reused** the editorial email markup verbatim (serif headers, numbered list, album art) — just dropped the playlist section and made the wrapper responsive.

## Session Notes (Apr 2026)

### Session 2026-04-27 — Funnel instrumentation + Claude curation improvements

**What changed:**

- **Pipeline debugger** (`src/debugReleases.ts`, new): full per-item funnel trace with CSV output. Run via `npm run debug:releases`. Instruments every stage — RSS filter, Claude curation, per-source cap, Spotify match, recency check — with drop reasons and code refs per row.
- **RSS include filters stripped**: removed all `includeTitlePatterns` from Stereogum, Brooklyn Vegan, Crack, Fader, Line of Best Fit, Data Transmission, Dummy. These were cutting too many legitimate items before Claude could see them. Only exclude patterns remain (tour, festival, live, obituary). Bandcamp Daily keeps its URL include filter (`album-of-the-day`, `essential-releases`).
- **RSS window** extended from 8 → 14 days (`fetchNewReleases` cutoff).
- **Dynamic taste profile** (`src/profile.ts`, new): `buildTasteProfile()` builds the taste description from the user's Spotify top 50 medium-term artists (names only — Spotify deprecated genre data from this endpoint). Replaces the hardcoded `TASTE_PROFILE` constant in `claude.ts`. All callers (`preview.ts`, `index.ts`, `debugReleases.ts`) now fetch medium-term top artists in the initial parallel batch and pass the profile to every Claude call.
- **Per-source cap** raised: 2 → 4 in `BUCKET_RULES` prompt and `capItemsPerSource` code (was misaligned at 2/3).
- **Candidate target** raised: up to 20 releases, aim for 15 (was up to 15, aim for 10).
- **"For fans of..." constraint** updated: blurbs now draw from taste profile artists, not just recent/top Spotify listening lists.
- **Retry improvement**: `curateMoreReleases()` now receives `excludedArtists` so it doesn't re-propose artists already in this week's validated releases.

**Learnings:**

- RSS include filters were the hidden bottleneck — Stereogum was keeping only 4/40 items, Fader 3/20. Stripping them let 151/178 items reach Claude.
- After changes: debug run produced 10 Claude proposals → 7 validated (exceeds NR_TARGET=5).
- Spotify genre arrays from `/me/top/artists` are always empty (deprecated). `/artists?ids=...` returns 403. Flat artist-name list works well — Claude knows these artists from training data.
- Key taste insight from Spotify top 50: Alex G, Snail Mail, Wednesday, Frank Ocean, Milton Nascimento, Frog, Anthony Naples, Hiatus Kaiyote, Ichiko Aoba, The Cure — broad mix of indie/noise-pop, world, soul, electronic.
- Wishlist analysis (from annotated CSV): Claude was missing Purelink, Kehlani, Boards of Canada, Massive Attack, Lucy Dacus, Frog — most now covered by expanded taste profile and looser candidate cap.

**Current funnel state (2026-04-27 debug run):**
- RSS items in 14-day window: 178
- Pass source filter: 151
- Claude proposed: 10–20 (target 15+)
- Spotify matched + recency pass: 7 (exceeds NR_TARGET=5 ✓)

## Backlog (prioritized)

1. **Multi-user onboarding (product goal)** — deploy once, share it: users land on an onboarding
   screen, **Connect Spotify** (OAuth — not an API key) + enter email, then get a personalized
   digest emailed every Monday automatically. Requires a backend + datastore + per-user weekly
   job (reintroduces email delivery, per user). `buildTasteProfile()` + the generation core are
   already user-agnostic. **Full design + phasing + gotchas (Spotify quota mode, Resend domain
   verification, token storage) in [`notes/multi-user-onboarding.md`](notes/multi-user-onboarding.md).**
2. **Fix artist matching false positives** — `artistsMatch()` in `src/spotify.ts` has a substring fallback (`na.includes(nb)`) causing false positives (e.g. "Dijon" → "Honey Dijon"). Remove or gate the substring path.
3. **Audit broken feeds** — Resident Advisor (404), Pigeons & Planes (404), Fact (0 items, pivoted away from music reviews). Replace with active sources in the same taste lane.
4. **Harden roundup extraction** — Paste/Brooklyn Vegan/Fader roundup items ("12 new albums to stream", "notable releases of the week") contain multiple releases but extract poorly. Improve artist/title parsing for these formats.
5. **Site design polish** — audit `render.ts` layout, album art sizing, section spacing; consider an auto-generated header image.

## Explicitly Deferred

- **Week-over-week dedup** — do not attempt file-based dedup. Requires a real persistence layer; design alongside the multi-user backend.
- **RSS source strategy deep-dive** — genre mapping per source, new-user onboarding flow, per-taste source selection. Separate initiative from simple source expansion above.
