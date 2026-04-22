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

## Genre Breakdown

`computeGenreBreakdown()` (in `index.ts` and `preview.ts`) maps Spotify genre tags into five display buckets: Electronic, Indie, R&B, Brazilian, Other. Uses artist genres from `getTopArtistsWithGenres()`, not track-level data. Non-fatal if it fails.

## Deployment

The workflow runs automatically every Monday at 8:30am ET (`mikawvawn/monday-music` on GitHub). To trigger manually, use the GitHub API or Actions UI. All secrets are stored in GitHub repository secrets.

To push source changes:
```bash
npm run build  # catch TS errors locally first
git push origin main
```

## Known Issues

- **This Week Wrapped section is broken** — the section does not render correctly. Not yet diagnosed. Reproduce with a preview run before attempting a fix.
- **Playlist description line too long** — `longDescription` renders as an unbroken wall of text in the email. Needs `max-width` or text truncation in `src/email.ts`.

## Backlog (prioritized)

1. **Fix This Week Wrapped** — reproduce failure in preview, diagnose, fix.
2. **Remove NR source tags and Read More links** — one `src/email.ts` change. Hides the single-source exposure problem while source diversity is unsolved. Music News keeps its Read More buttons.
3. **Source expansion** — investigate rateyourmusic.com as primary new source; also audit the 4 broken feeds. Goal: genre diversity beyond Stereogum + Bandcamp Daily.
4. **Playlist description line length** — CSS/text fix in `src/email.ts`.
5. **Auto-generate playlist cover image** — use playlist name + theme + longDescription as image generation prompt; upload to Spotify as cover; use in email header. Needs image generation API integration + `uploadPlaylistCover()` Spotify endpoint.
6. **Overall email design** — tied to playlist image; the generated cover should anchor the visual identity of the email.
7. **Taste profiling / multi-user** — `TASTE_PROFILE` in `src/claude.ts` is currently hardcoded for Mike. Needs to become a per-user configurable input derived from listening data + onboarding. Tied to the multi-user backend work.

## Explicitly Deferred

- **Week-over-week dedup** — do not attempt file-based dedup. Requires a real persistence layer; design alongside the multi-user backend.
- **RSS source strategy deep-dive** — genre mapping per source, new-user onboarding flow, per-taste source selection. Separate initiative from simple source expansion above.
