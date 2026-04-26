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
- RSS: 7 music publications via `src/newReleases.ts` → `NewRelease[]`
- **Note:** As of April 2026 only 2 of 7 feeds work: Stereogum and Bandcamp Daily (~55 items/week). Pitchfork, Resident Advisor, Paste, and Pigeons & Planes are 404/403-ing. Fact returns 0 items.

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

## Backlog (prioritized)

**Source expansion** — investigate rateyourmusic.com as primary new source; also audit the 4 broken feeds. Goal: genre diversity beyond Stereogum + Bandcamp Daily.
**Auto-generate playlist cover image** — use playlist name + theme + longDescription as image generation prompt; upload to Spotify as cover; use in email header. Needs image generation API integration + `uploadPlaylistCover()` Spotify endpoint.
**Overall email design** — tied to playlist image; the generated cover should anchor the visual identity of the email.
**Taste profiling / multi-user** — `TASTE_PROFILE` in `src/claude.ts` is currently hardcoded for Mike. Needs to become a per-user configurable input derived from listening data + onboarding. Tied to the multi-user backend work.



## Explicitly Deferred

- **Week-over-week dedup** — do not attempt file-based dedup. Requires a real persistence layer; design alongside the multi-user backend.
- **RSS source strategy deep-dive** — genre mapping per source, new-user onboarding flow, per-taste source selection. Separate initiative from simple source expansion above.
