import {
  getAccessToken,
  getRecentlyPlayed,
  getTopTracks,
  getRecentPlaylists,
  searchTrack,
  getUserId,
  createPlaylist,
  addTracksToPlaylist,
  getTopArtists,
  type Track,
} from "./spotify.js";
import { generatePlaylist, curateNewReleases, curateMoreReleases } from "./claude.js";
import { sendEmail } from "./email.js";
import { fetchNewReleases } from "./newReleases.js";
import { enrichAndFilterReleases, filterNewsByReleaseArtists, dedupeReleasesByArtist } from "./enrichReleases.js";

const NR_TARGET = 5;
const NEWS_TARGET = 5;

async function run() {
  console.log("Starting Monday Music...");

  const token = await getAccessToken();
  console.log("Spotify token obtained");

  // Fetch Spotify data + RSS feeds in parallel
  const [userId, recentTracks, topTracks, topTracksShortTerm, recentPlaylists, rawReleases] = await Promise.all([
    getUserId(token),
    getRecentlyPlayed(token),
    getTopTracks(token),
    getTopTracks(token, "short_term"),
    getRecentPlaylists(token),
    fetchNewReleases().then((r) => { console.log(`Fetched ${r.length} new releases from RSS`); return r; }),
  ]);
  console.log(`Got ${recentTracks.length} recent tracks, ${topTracks.length} top tracks`);

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))];
  const topArtists = [...new Set(topTracks.map((t) => t.artist))];
  const recentPlaylistNames = recentPlaylists.map((p) => p.name);

  // Claude + short-term favorites in parallel
  console.log("Asking Claude for playlist + new release curation...");
  const [plan, curated, topArtistsShortTerm] = await Promise.all([
    generatePlaylist(recentTracks, topTracks, recentPlaylistNames),
    curateNewReleases(rawReleases, recentArtists, topArtists),
    getTopArtists(token, "short_term").catch((err) => {
      console.warn("Short-term top artists fetch failed (non-fatal):", err.message);
      return [];
    }),
  ]);
  console.log(`Playlist: "${plan.name}" (${plan.theme}) | ${plan.tracks.length} tracks suggested`);
  console.log(`Release candidates: ${curated.releases.length} | News candidates: ${curated.news.length}`);
  console.log(`Short-term top artists fetched: ${topArtistsShortTerm.length}`);
  console.log(`Short-term top tracks fetched: ${topTracksShortTerm.length}`);

  // Search Spotify for each playlist track
  console.log("Searching Spotify for tracks...");
  const foundTracks: Track[] = [];
  for (const suggestion of plan.tracks) {
    const track = await searchTrack(`${suggestion.track} ${suggestion.artist}`, token);
    if (track) {
      foundTracks.push(track);
      console.log(`  ✓ ${track.artist} — ${track.name}`);
    } else {
      console.log(`  ✗ Not found: ${suggestion.artist} — ${suggestion.track}`);
    }
  }

  if (foundTracks.length < 5) {
    throw new Error(`Too few tracks found (${foundTracks.length}), aborting`);
  }

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

  // Filter News: drop any item whose artist already appears in New Releases. Cap at NEWS_TARGET.
  const news = filterNewsByReleaseArtists(curated.news, validatedReleases, NEWS_TARGET);
  console.log(`News final: ${news.length}`);

  // Create playlist
  const playlist = await createPlaylist(userId, plan.name, plan.description, token);
  await addTracksToPlaylist(playlist.id, foundTracks.map((t) => t.id), token);
  console.log(`Playlist created: ${playlist.url}`);

  // Send email
  await sendEmail(
    plan.name,
    plan.description,
    plan.longDescription,
    playlist.url,
    foundTracks,
    validatedReleases,
    news,
    topArtistsShortTerm,
    topTracksShortTerm,
  );

  console.log("Done!");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
