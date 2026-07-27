import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  getAccessToken,
  getRecentlyPlayed,
  getTopTracks,
  getUserId,
  getTopArtists,
} from "./spotify.js";
import { curateNewReleases, curateMoreReleases } from "./claude.js";
import { buildTasteProfile } from "./profile.js";
import { buildSiteHtml } from "./render.js";
import { fetchNewReleases } from "./newReleases.js";
import { enrichAndFilterReleases, filterNewsByReleaseArtists, dedupeReleasesByArtist } from "./enrichReleases.js";

const NR_TARGET = 5;
const NEWS_TARGET = 5;
const OUT_PATH = process.env.OUT_PATH || "public/index.html";

async function run() {
  console.log("Building Monday Music site...");

  const token = await getAccessToken();
  console.log("Spotify token obtained");

  // Fetch Spotify data + RSS feeds in parallel
  const [userId, recentTracks, topTracks, topTracksShortTerm, rawReleases, topArtistsMedium] = await Promise.all([
    getUserId(token),
    getRecentlyPlayed(token),
    getTopTracks(token),
    getTopTracks(token, "short_term"),
    fetchNewReleases().then((r) => { console.log(`Fetched ${r.length} new releases from RSS`); return r; }),
    getTopArtists(token, "medium_term").catch(() => []),
  ]);
  console.log(`Got ${recentTracks.length} recent tracks, ${topTracks.length} top tracks (user ${userId})`);

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))];
  const topArtists = [...new Set(topTracks.map((t) => t.artist))];
  const tasteProfile = buildTasteProfile(topArtistsMedium, "Mike");
  console.log(`Taste profile built from ${topArtistsMedium.length} top artists`);

  // Claude curation + short-term top artists in parallel
  console.log("Asking Claude for new-release curation...");
  const [curated, topArtistsShortTerm] = await Promise.all([
    curateNewReleases(rawReleases, recentArtists, topArtists, tasteProfile),
    getTopArtists(token, "short_term").catch((err) => {
      console.warn("Short-term top artists fetch failed (non-fatal):", err.message);
      return [];
    }),
  ]);
  console.log(`Release candidates: ${curated.releases.length} | News candidates: ${curated.news.length}`);

  // Validate release candidates against Spotify (artist match + recency). Walk in ranked
  // order, keep first NR_TARGET that pass. If short, retry with additional candidates.
  console.log("Validating release candidates...");
  let { kept: validatedReleases, rejectedUrls } = await enrichAndFilterReleases(
    curated.releases,
    token,
    NR_TARGET,
  );
  if (validatedReleases.length < NR_TARGET) {
    console.log(`Only ${validatedReleases.length}/${NR_TARGET} releases kept — asking Claude for more candidates...`);
    const alreadySeenUrls = [...rejectedUrls, ...validatedReleases.map((r) => r.url)];
    const alreadyKeptArtists = validatedReleases.map((r) => r.artist).filter(Boolean);
    const more = await curateMoreReleases(rawReleases, recentArtists, topArtists, alreadySeenUrls, alreadyKeptArtists, 10, tasteProfile).catch((e) => {
      console.warn(`Retry curation failed: ${e.message}`);
      return [] as typeof curated.releases;
    });
    const needed = NR_TARGET - validatedReleases.length;
    const extra = await enrichAndFilterReleases(more, token, needed);
    validatedReleases = dedupeReleasesByArtist(validatedReleases, extra.kept).slice(0, NR_TARGET);
  }
  if (validatedReleases.length < NR_TARGET) {
    console.warn(`⚠ Only ${validatedReleases.length} releases after retry (target ${NR_TARGET}). Shipping with what we have.`);
  }
  console.log(`Releases final: ${validatedReleases.length}`);

  // Filter News: drop any item whose artist already appears in New Releases. Cap at NEWS_TARGET.
  const news = filterNewsByReleaseArtists(curated.news, validatedReleases, NEWS_TARGET);
  console.log(`News final: ${news.length}`);

  // Render the static site
  const html = buildSiteHtml(validatedReleases, news, topArtistsShortTerm, topTracksShortTerm);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, html);
  console.log(`Site written to ${OUT_PATH} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log("Done!");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
