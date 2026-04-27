# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build         # tsc → dist/
npm test              # tsc + node --test dist/*.test.js
npm start             # run full pipeline (needs env vars)
npm run dev           # ts-node (skips build step, for quick iteration)
node dist/preview.js  # generate preview HTML only — no playlist created, no email sent
```

Source `.env` before running locally — the project does not use the dotenv package:
```bash
set -a && source .env && set +a && unset ANTHROPIC_BASE_URL && node dist/preview.js
```

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
- `curateNewReleases()` → `CuratedBuckets { releases, news }` — two separate arrays, no artist overlap between them. Claude proposes ~15 release candidates + ~10 news candidates ranked by fit.

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

### What changed this session

- Added environment setup workflow:
  - `.env.example`
  - `scripts/setup-env.sh`
  - `npm run setup:env`
- Expanded and updated release-source ingestion in `src/newReleases.ts`:
  - Added/updated source endpoints and source-specific include/exclude filters
  - Added HTML entity decoding
  - Added `enrichArtistTitle()` to recover artist/title from announcement-style titles and URL structure
- Updated curation behavior in `src/claude.ts`:
  - Interleave release-list prompt input across sources (reduces source-order bias)
  - Keep hard cap of 2 picks per source in parsed model output
  - Prompt allows extracting one concrete release from roundup/list items
  - Prompt asks for a larger release candidate set when possible

### Learnings from debug + preview runs

- Biggest bottleneck is still not RSS fetch volume, but release-candidate contraction:
  - raw fetched items were around ~60 in recent runs
  - Claude often returned 4-5 release candidates
  - Spotify validation + recency + dedupe frequently cut this to 3 final releases
- Retry behavior currently underperforms because retry candidates often repeat already-kept artists and are removed by `dedupeReleasesByArtist()`.
- Paste/Fader/Brooklyn Vegan are now feeding items, but their mixed "news + roundup + review" nature requires stronger extraction/normalization to convert into valid artist/title release candidates.
- Spotify link correctness depends heavily on artist matching strictness:
  - observed false positive example: "Dijon" matched "Honey Dijon" because of substring fallback in `artistsMatch()`.
  - this is known and not yet fixed.
- `preview.ts` successfully generates `/tmp/monday-music-preview.html`, but post-create playlist verification can fail with Spotify 403 on `getPlaylistTracks()`. This does not block HTML generation.

### Current status

- Source expansion and parser hardening are in progress and merged to `main`.
- Environment setup friction is reduced (bootstrap script + example env).
- Preview generation is functional for review loops.
- New Releases section quality improved but still frequently lands below target (`NR_TARGET = 5`), commonly ending at 3.

## Backlog (prioritized)

1. **Stabilize New Releases count to 5+ reliably** — improve candidate funnel so release candidates survive curation + validation + dedupe.
2. **Fix artist matching false positives in Spotify enrichment** — tighten `artistsMatch()` token logic (remove unsafe substring matching behavior).
3. **Improve retry strategy in `curateMoreReleases()`** — exclude already-kept artists explicitly (not only URLs) and request enough truly novel candidates.
4. **Harden source extraction quality** — better parse/normalize for roundup-heavy feeds (Paste/Fader/Brooklyn Vegan) and stronger per-source artist/title heuristics.
5. **Audit broken feeds** — revalidate/replace Resident Advisor and Pigeons & Planes endpoints; decide whether to keep Fact.
6. **Auto-generate playlist cover image** — use playlist name + theme + longDescription prompt; upload via Spotify cover endpoint; reuse in email header.
7. **Overall email design** — tie design to generated cover art.
8. **Taste profiling / multi-user** — move away from hardcoded taste profile to user-derived config + onboarding, tied to multi-user backend.



## Explicitly Deferred

- **Week-over-week dedup** — do not attempt file-based dedup. Requires a real persistence layer; design alongside the multi-user backend.
- **RSS source strategy deep-dive** — genre mapping per source, new-user onboarding flow, per-taste source selection. Separate initiative from simple source expansion above.
