# New-release source research

Goal: 10–15 candidate sources for the `newReleases.ts` pipeline, covering indie, pop, R&B, world, rap, and electronic. Already in the pipeline: Pitchfork, Stereogum, Bandcamp Daily.

Note: I could not curl candidate feeds from this environment (Cowork egress is locked to package hosts). Recommendations below are based on web research and source patterns; before merging any of these into the pipeline, run a one-off fetch with the project's User-Agent and inspect the body. Your current UA is the suspect for the existing failures — see "Root cause" below.

## Root cause for the 4 broken feeds

`src/newReleases.ts:64` sends `User-Agent: monday-music-bot/1.0`. That is almost certainly why Pitchfork, Resident Advisor, Paste, and Pigeons & Planes are 403/404-ing — Pitchfork in particular blocks non-browser UAs at the edge, and Cloudflare-fronted sites (RA, RYM) drop bot-shaped UAs. Two of these feeds are also pointing at stale URLs:

- **Pigeons & Planes** is using `complex.com/pigeons-and-planes/rss`. P&P spun out from Complex and **relaunched its standalone site in early 2026**. The Complex-hosted feed is dead; the new feed lives at `pigeonsandplanes.com` (verify on the site footer).
- **Resident Advisor** code points at `ra.co/xml/reviews.xml`. RA closed "The Feed" but kept news/features feeds. The reviews feed may simply not exist anymore — switch to the news feed.

**Recommended first fix, before adding any new sources:** swap the UA to a Chrome-shaped string (`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...`) and re-test all four. You may recover 3 of them with that change alone.

## Recommended source list

Tiered by confidence and integration cost. Total: 13 new sources + 3 existing = 16 endpoints, with explicit don't-bothers at the bottom.

### Tier A — add these first (high signal, simple RSS, fills genre gaps)

| # | Source | Genres | Vector | Notes |
|---|---|---|---|---|
| 1 | **Pigeons & Planes** (relaunched) | rap, indie pop, R&B | RSS — find on `pigeonsandplanes.com` footer | Already in your code at the wrong URL. Highest priority — covers rap discovery you're currently missing entirely. |
| 2 | **Brooklyn Vegan** | indie, rock, punk, some pop | `brooklynvegan.com/feed/` | High volume, well-formed WordPress feed, strong release-announcement coverage. |
| 3 | **The Line of Best Fit** | indie, alt-pop, electronic | `thelineofbestfit.com/news/rss` (verify on site) | UK-leaning indie/pop, decent R&B and electronic crossover. |
| 4 | **Crack Magazine** | electronic, rap, R&B, UK underground | `crackmagazine.net/feed/` (WordPress default) | Best single source for UK/European underground crossover. Strong genre breadth. |
| 5 | **Resident Advisor** | electronic, dance | News feed under `ra.co/xml/` — confirm exact path on the site | Already in your code; switch from reviews to news, fix UA. |
| 6 | **The Fader** | hip-hop, R&B, pop | `thefader.com/rss` | Critical for R&B + mainstream rap coverage; complements P&P. |
| 7 | **Reddit (r/indieheads + r/hiphopheads + r/popheads)** | indie, rap, pop | JSON: `reddit.com/r/{sub}/new.json` filtered by `[FRESH]` flair | Free, structured, very high signal. r/indieheads enforces `[FRESH]` tag for new releases — instant filter. Requires a real UA string (Reddit blocks default UAs hard). |
| 8 | **Bandcamp Daily — genre best-of pages** | jazz, electronic, hip-hop, afropop, soul, metal | Already have main feed; add monthly scrapes of `daily.bandcamp.com/best-{genre}/...` | The genre best-of monthlies are explicitly curated discovery lists, much higher signal-per-item than the main feed. Free, no auth, simple HTML. |

### Tier B — fills remaining genre gaps (world, pop, harder-to-source)

| # | Source | Genres | Vector | Notes |
|---|---|---|---|---|
| 9 | **NPR Music** (All Songs Considered + New Music Friday + Alt.Latino) | indie, R&B, world, Latin | Podcast RSS feeds at `npr.org/podcasts/...` — episode descriptions list tracks | Best English-language source for world/Latin coverage. Episode descriptions are already structured "artist — track" lists, easy to parse. |
| 10 | **Hype Machine** | aggregator across ~800 indie/electronic/pop blogs | `hypem.com/popular` RSS (multiple variants exist — confirm on site) | A meta-source. Won't give you genre-tagged release notes the way a magazine does, but surfaces tracks gaining traction across the blog ecosystem. Useful as a cross-check signal. |
| 11 | **AOTY (albumoftheyear.org)** | all genres, weighted by critic score | RSS for new releases by score, e.g. their "Recent Releases" page | Best signal for "what's actually getting good reviews this week" across genres. Aggregates ~50 critic outlets. Verify ToS allows scraping; rate-limit. |
| 12 | **FACT Magazine** | electronic, experimental, rap | `factmag.com/feed/` | CLAUDE.md notes Fact returns 0 items — likely a parsing issue (their feed wraps differently) or the UA. Worth re-investigating; FACT is irreplaceable for left-field electronic. |
| 13 | **HipHopDX** *or* **HotNewHipHop** | rap | WordPress `/feed/` on either | Higher volume than P&P; lower curation. Pick one — you don't need both. |

### Tier C — explicit don't-bothers (with rationale, so you can skip relitigating)

- **RateYourMusic** — Skip. No API, Cloudflare-protected, IP bans within ~50 requests, ToS prohibits automated access. The popular Python scrapers (`rymscraper`) are broken as of 2024. Even if you got it working, you'd be one block-list update away from breakage every week. Not worth the pipeline fragility for what is a small marginal lift over AOTY (which solves the same "aggregated critic verdict" problem legally).
- **Dazed Digital** — `dazeddigital.com/rss` exists but is the firehose across fashion, beauty, art, film. Music is maybe 15% of items. You'd spend Claude tokens filtering noise. Only worth adding if you can find a music-section-only feed, and I couldn't confirm one exists.
- **Pitchfork** (currently) — Keep, but treat the UA fix as the unblock. Their feed at `pitchfork.com/feed/feed-album-reviews/rss` is canonical; the album-reviews path you currently use also works with a browser UA.
- **Twitter / TikTok / Instagram** — All require paid API access and impose volume caps incompatible with a weekly batch job. Skip.
- **Songlines** (world music) — Paywalled; not scrapeable.

## Genre coverage check

After Tier A + B, coverage looks like:

- **Indie**: Stereogum (have) + Brooklyn Vegan + Line of Best Fit + r/indieheads + Bandcamp Daily — strong, redundant.
- **Pop**: The Fader + r/popheads + Bandcamp Daily — adequate, less redundant. Idolator/Popjustice are options if you want more.
- **R&B**: The Fader + P&P + NPR Music + AOTY — adequate. RatedRnB.com is a deeper option but lower signal.
- **World music**: Bandcamp Daily genre lists (afropop, latin) + NPR Alt.Latino + Crack Magazine + AOTY. Genuinely the thinnest area in English-language music journalism. Consider Spotify's regional editorial playlists (Top 50 — Nigeria, Top 50 — Brazil, etc.) as a programmatic supplement; you already have Spotify auth.
- **Rap**: P&P + The Fader + r/hiphopheads + Bandcamp Daily best-hip-hop + HipHopDX. Strong.
- **Electronic**: Stereogum (have, light) + Crack + Resident Advisor + FACT + Bandcamp Daily best-electronic. Strong.

## Non-RSS discovery vectors worth considering

These don't fit the current `parseItems` shape but are stronger signal-per-token than several blogs:

- **Spotify editorial playlists**: "New Music Friday" (per region), "RapCaviar", "Are & Be", "Fresh Finds Indie", "mint", "Dance Rising", "Top 50 — Nigeria/Brazil/India/Korea". You already authenticate with Spotify; the `/playlists/{id}/items` endpoint gives you fresh, genre-tagged, taste-curated tracks weekly. Lowest-effort/highest-quality addition you could make to the pipeline. Treat each playlist as a "source" with the playlist name as the source label.
- **KEXP playlists**: KEXP exposes their on-air tracks via a public JSON API. Excellent for indie/world/electronic; their global rotation is a genuine tastemaker signal.
- **Anthony Fantano (theneedledrop) YouTube RSS**: `youtube.com/feeds/videos.xml?channel_id=UCt7fwAhXDy3oNFTAzF2o8Pw`. Won't tell you what just dropped, but tells you what one of the loudest critic voices is reviewing this week. Useful as a re-ranker, not a discovery feed.

## Suggested next step

Before adding any of these, do the UA fix and re-test the existing 4 broken feeds. If P&P, RA, and Pitchfork come back with the new UA, you go from 2 working sources to 5, which may already be enough volume to defer the broader expansion. Then add Tier A items 1–4 in priority order (P&P URL fix + Brooklyn Vegan + Crack + r/indieheads) — that one round alone should comfortably double your candidate volume and meaningfully expand genre coverage.
