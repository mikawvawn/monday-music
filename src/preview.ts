import { writeFileSync } from "fs";
import {
  getAccessToken,
  getRecentlyPlayed,
  getTopTracks,
  getRecentPlaylists,
  searchTrack,
  getUserId,
  getTopArtists,
  type Track,
} from "./spotify.js";
import { generatePlaylist, curateNewReleases, curateMoreReleases } from "./claude.js";
import { buildEmailHtml } from "./email.js";
import { fetchNewReleases } from "./newReleases.js";
import { enrichAndFilterReleases, filterNewsByReleaseArtists, dedupeReleasesByArtist } from "./enrichReleases.js";

const NR_TARGET = 5;
const NEWS_TARGET = 5;

async function preview() {
  console.log("Starting preview (no playlist creation)...");

  const token = await getAccessToken();
  console.log("Spotify token obtained");

  const [, recentTracks, topTracks, topTracksShortTerm, recentPlaylists, rawReleases] = await Promise.all([
    getUserId(token),
    getRecentlyPlayed(token),
    getTopTracks(token),
    getTopTracks(token, "short_term"),
    getRecentPlaylists(token),
    fetchNewReleases().then((r) => { console.log(`Fetched ${r.length} releases from RSS`); return r; }),
  ]);

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))];
  const topArtists = [...new Set(topTracks.map((t) => t.artist))];
  const recentPlaylistNames = recentPlaylists.map((p) => p.name);

  console.log("Asking Claude...");
  const [plan, curated, topArtistsShortTerm] = await Promise.all([
    generatePlaylist(recentTracks, topTracks, recentPlaylistNames),
    curateNewReleases(rawReleases, recentArtists, topArtists),
    getTopArtists(token, "short_term").catch(() => []),
  ]);
  console.log(`Playlist: "${plan.name}" | Release candidates: ${curated.releases.length} | News candidates: ${curated.news.length}`);
  console.log(`Short-term top artists fetched: ${topArtistsShortTerm.length}`);
  console.log(`Short-term top tracks fetched: ${topTracksShortTerm.length}`);

  console.log("Searching Spotify for tracks...");
  const foundTracks: Track[] = [];
  for (const suggestion of plan.tracks) {
    const track = await searchTrack(`${suggestion.track} ${suggestion.artist}`, token);
    if (track) {
      foundTracks.push(track);
      console.log(`  ✓ ${track.artist} — ${track.name}`);
    }
  }

  console.log("Validating release candidates...");
  let { kept: validatedReleases, rejectedUrls } = await enrichAndFilterReleases(
    curated.releases,
    token,
    NR_TARGET,
  );
  if (validatedReleases.length < NR_TARGET) {
    console.log(`Only ${validatedReleases.length}/${NR_TARGET} releases kept — asking Claude for more candidates...`);
    const alreadySeenUrls = [...rejectedUrls, ...validatedReleases.map((r) => r.url)];
    const more = await curateMoreReleases(rawReleases, recentArtists, topArtists, alreadySeenUrls, 10).catch((e) => {
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

  const news = filterNewsByReleaseArtists(curated.news, validatedReleases, NEWS_TARGET);
  console.log(`News final: ${news.length}`);

  const html = buildEmailHtml(
    plan.name,
    plan.description,
    plan.longDescription,
    "https://open.spotify.com/playlist/preview",
    foundTracks,
    validatedReleases,
    news,
    topArtistsShortTerm,
    topTracksShortTerm,
  );

  const outPath = "/tmp/monday-music-preview.html";
  writeFileSync(outPath, html);
  console.log(`Preview written to ${outPath}`);
}

preview().catch((err) => {
  console.error("Preview error:", err);
  process.exit(1);
});
