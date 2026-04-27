# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build         # tsc → dist/
npm test              # tsc + node --test dist/*.test.js
npm start             # run full pipeline (needs env vars)
npm run dev           # ts-node (skips build step, for quick iteration)
node dist/preview.js  # generate preview HTML only — no playlist created, no email sent
npm run debug:releases  # full pipeline instrumentation — writes two CSVs to /tmp/
```

Source `.env` before running locally — the project does not use the dotenv package:
```bash
set -a && source .env && set +a && unset ANTHROPIC_BASE_URL && node dist/preview.js
set -a && source .env && set +a && unset ANTHROPIC_BASE_URL && npm run debug:releases
```

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

All five must be set to run the full pipeline:

| Var | Source |
|-----|--------|
| `SPOTIFY_CLIENT_ID` | Spotify developer app |
| `SPOTIFY_CLIENT_SECRET` | Spotify developer app |
| `SPOTIFY_REFRESH_TOKEN` | OAuth flow (cached in `~/.spotify-mcp/tokens.json` locally) |
| `ANTHROPIC_API_KEY` | Anthropic console |
| `RESEND_API_KEY` | Resend dashboard (stored at `~/.resend_api_key`) |

Preview mode only requires the Spotify vars + `ANTHROPIC_API_KEY` (no Resend needed).

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

The pipeline runs in `src/index.ts` and has five stages:

**1. Parallel data fetch**
- Spotify: recent tracks (50), top tracks (50, medium-term), recent playlists, user ID, top artists with genres
- RSS: source-configured publication feeds via `src/newReleases.ts` → `NewRelease[]`
- **Current state (late April 2026):** feeds currently configured include Pitchfork, Stereogum, Bandcamp Daily, Resident Advisor, Paste, Fact, Pigeons & Planes, Brooklyn Vegan, Crack Magazine, The Fader, and Line of Best Fit.
- **Observed reliability in latest preview/debug runs:** Pitchfork, Stereogum, Bandcamp Daily, Paste, Brooklyn Vegan, Crack, The Fader, and Line of Best Fit returned items; Resident Advisor and Pigeons & Planes still 404; Fact returns 0 items.

**2. Parallel Claude calls** (`src/claude.ts`)
- `generatePlaylist()` → `PlaylistPlan` with `name`, `description`, `longDescription`, `theme`, 18 `tracks[]`
- `curateNewReleases()` → `CuratedBuckets { releases, news }` — two separate arrays, no artist overlap between them. Claude proposes up to 20 release candidates (aims for 15) + up to 10 news candidates ranked by fit.
- Both functions receive a `tasteProfile` string built by `buildTasteProfile()` in `src/profile.ts` from the user's Spotify top 50 medium-term artists.

**3. Sequential Spotify enrichment + validation**
- Search each suggested track → build `foundTracks: Track[]`
- `enrichAndFilterReleases()` in `src/enrichReleases.ts` validates each release candidate: artist match via `searchAlbumInfo()` + 30-day recency via `isRecentRelease()`. Walks ranked candidates, stops at `NR_TARGET = 5`.
- If fewer than 5 pass: calls `curateMoreReleases()` for up to 10 more candidates (excluding already-seen URLs), re-validates, merges with `dedupeReleasesByArtist()`.
- `filterNewsByReleaseArtists()` drops any news item whose artist already appears in validated releases. Caps at `NEWS_TARGET = 5`.

**4. Create playlist + send email**
- `createPlaylist()` + `addTracksToPlaylist()` in Spotify
- `buildEmailHtml()` → POST to Resend API → mvaughandc@gmail.com

**Preview mode** (`src/preview.ts`) runs stages 1-3 but skips playlist creation and email, writing rendered HTML to `/tmp/monday-music-preview.html`.

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

The workflow runs automatically every Monday at 8:30am ET (`mikawvawn/monday-music` on GitHub). To trigger manually, use the GitHub API or Actions UI. All secrets are stored in GitHub repository secrets.

To push source changes:
```bash
npm run build  # catch TS errors locally first
git push origin main
```

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

1. **Fix artist matching false positives** — `artistsMatch()` in `src/spotify.ts` has a substring fallback (`na.includes(nb)`) causing false positives (e.g. "Dijon" → "Honey Dijon"). Remove or gate the substring path.
2. **Audit broken feeds** — Resident Advisor (404), Pigeons & Planes (404), Fact (0 items, pivoted away from music reviews). Replace with active sources in the same taste lane.
3. **Multi-user onboarding** — per-user config file (displayName, Spotify credentials). `buildTasteProfile()` already makes the Claude side user-agnostic; the remaining work is credential management and routing.
4. **Harden roundup extraction** — Paste/Brooklyn Vegan/Fader roundup items ("12 new albums to stream", "notable releases of the week") contain multiple releases but extract poorly. Improve artist/title parsing for these formats.
5. **Auto-generate playlist cover image** — prompt → image → upload via Spotify cover endpoint; reuse in email header.
6. **Email design** — audit layout, album art sizing, section spacing; tie design to cover art when that's ready.

## Explicitly Deferred

- **Week-over-week dedup** — do not attempt file-based dedup. Requires a real persistence layer; design alongside the multi-user backend.
- **RSS source strategy deep-dive** — genre mapping per source, new-user onboarding flow, per-taste source selection. Separate initiative from simple source expansion above.
