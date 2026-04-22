# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # tsc → dist/
npm start          # run full pipeline (needs env vars)
npm run dev        # ts-node (skips build step, for quick iteration)
node dist/preview.js  # generate preview HTML only — no playlist created, no email sent
```

No linter or test runner is configured.

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

The pipeline runs in `src/index.ts` and has four stages:

**1. Parallel data fetch**
- Spotify: recent tracks (50), top tracks (50, medium-term), recent playlists, user ID, top artists with genres
- RSS: 7 music publications via `src/newReleases.ts` → `NewRelease[]`

**2. Parallel Claude calls** (`src/claude.ts`)
- `generatePlaylist()` → `PlaylistPlan` with `name`, `description`, `longDescription` (3-4 sentence blurb), `theme`, and 18 `tracks[]`
- `curateNewReleases()` → `CuratedRelease[]` (5-7 picks from RSS, with taste-matched blurbs)

**3. Sequential Spotify enrichment**
- Search each suggested track → build `foundTracks: Track[]`
- For each curated release, call `searchAlbumInfo()` to attach `imageUrl`, `spotifyUrl`, `releaseType`

**4. Create playlist + send email**
- `createPlaylist()` + `addTracksToPlaylist()` in Spotify
- `buildEmailHtml()` → POST to Resend API → mvaughandc@gmail.com

**Preview mode** (`src/preview.ts`) runs stages 1-3 but skips playlist creation and email, writing the rendered HTML to `/tmp/monday-music-preview.html` instead. The GitHub Actions workflow supports triggering preview via `workflow_dispatch` with `preview: true`, which uploads the HTML as an artifact.

## Key Types

```typescript
// src/spotify.ts
interface Track { id, name, artist, artistId, album, url }

// src/claude.ts
interface CuratedRelease { artist, title, blurb, source, url, imageUrl?, spotifyUrl?, releaseType? }
```

`CuratedRelease.releaseType` (e.g. "album", "single", "EP") comes from Spotify search, not the RSS feed.

## Genre Breakdown

`computeGenreBreakdown()` (in `index.ts` and `preview.ts`) maps Spotify's genre tags into five display buckets: Electronic, Indie, R&B, Brazilian, Other. It uses the artist genres returned by `getTopArtistsWithGenres()` (`/me/top/artists`), not the track-level data. If genre fetch fails (non-fatal), the email renders without the donut chart.

## Deployment

The workflow runs automatically every Monday at 8:30am ET (`mikawvawn/monday-music` on GitHub). To trigger manually, use the GitHub API or Actions UI. All secrets are stored in GitHub repository secrets — they cannot be read back via API, only set.

To push source changes and trigger a run:
```bash
# Build locally first to catch TS errors
npm run build

# Push via GitHub API (no direct push access to imprvhub/mcp-claude-spotify)
# See session history for curl-based push pattern using ghp_* token
```
