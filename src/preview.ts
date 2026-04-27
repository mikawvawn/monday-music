import { writeFileSync } from "fs";
import {
  getAccessToken,
  getRecentlyPlayed,
  getTopTracks,
  getRecentPlaylists,
  getUserId,
  createPlaylist,
  addTracksToPlaylist,
  getPlaylistTracks,
  getTopArtists,
  buildDiscoveryPool,
  interleaveByArtist,
  type Track,
} from "./spotify.js";
import { generatePlaylist, describePlaylist, curateNewReleases, curateMoreReleases } from "./claude.js";
import { buildTasteProfile } from "./profile.js";
import { buildEmailHtml } from "./email.js";
import { fetchNewReleases } from "./newReleases.js";
import { enrichAndFilterReleases, filterNewsByReleaseArtists, dedupeReleasesByArtist } from "./enrichReleases.js";

const NR_TARGET = 5;
const NEWS_TARGET = 5;

async function preview() {
  console.log("Starting preview (no playlist creation)...");

  const token = await getAccessToken();
  console.log("Spotify token obtained");

  const [userId, recentTracks, topTracks, topTracksShortTerm, recentPlaylists, rawReleases, topArtistsMedium] = await Promise.all([
    getUserId(token),
    getRecentlyPlayed(token),
    getTopTracks(token),
    getTopTracks(token, "short_term"),
    getRecentPlaylists(token),
    fetchNewReleases().then((r) => { console.log(`Fetched ${r.length} releases from RSS`); return r; }),
    getTopArtists(token, "medium_term").catch(() => []),
  ]);

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))];
  const topArtists = [...new Set(topTracks.map((t) => t.artist))];
  const recentPlaylistNames = recentPlaylists.map((p) => p.name);
  const tasteProfile = buildTasteProfile(topArtistsMedium, "Mike");
  console.log(`Taste profile built from ${topArtistsMedium.length} top artists`);

  console.log("Asking Claude...");
  const [plan, curated, topArtistsShortTerm] = await Promise.all([
    generatePlaylist(recentTracks, topTracks, recentPlaylistNames, tasteProfile),
    curateNewReleases(rawReleases, recentArtists, topArtists, tasteProfile),
    getTopArtists(token, "short_term").catch(() => []),
  ]);
  console.log(`Playlist: "${plan.name}" (${plan.theme}) | discovery artists: ${plan.discoveryArtists.join(", ")}`);
  console.log(`Release candidates: ${curated.releases.length} | News candidates: ${curated.news.length}`);
  console.log(`Short-term top artists fetched: ${topArtistsShortTerm.length}`);
  console.log(`Short-term top tracks fetched: ${topTracksShortTerm.length}`);

  console.log("Building discovery pool...");
  const candidates = await buildDiscoveryPool(plan.discoveryArtists, token);
  console.log(`  ${candidates.length} candidate tracks in pool`);

  const foundTracks = interleaveByArtist(candidates, 20);
  console.log(`Playlist: ${foundTracks.length} tracks`);
  foundTracks.forEach((t) => console.log(`  ${t.artist} — ${t.name}`));

  const longDescription = await describePlaylist(foundTracks, plan.name, plan.theme);

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

  const news = filterNewsByReleaseArtists(curated.news, validatedReleases, NEWS_TARGET);
  console.log(`News final: ${news.length}`);

  // Create a real playlist so the link in the preview HTML is clickable and verifiable
  console.log("Creating Spotify playlist (preview — no email will be sent)...");
  const playlist = await createPlaylist(userId, plan.name, plan.description, token);
  await addTracksToPlaylist(playlist.id, foundTracks.map((t) => t.id), token);
  console.log(`Playlist created: ${playlist.url}`);

  const html = buildEmailHtml(
    plan.name,
    plan.description,
    longDescription,
    playlist.url,
    foundTracks,
    validatedReleases,
    news,
    topArtistsShortTerm,
    topTracksShortTerm,
  );

  const outPath = "/tmp/monday-music-preview.html";
  writeFileSync(outPath, html);
  console.log(`Preview written to ${outPath}`);

  // Verify playlist tracks were actually added to Spotify
  console.log("\nVerifying playlist contents against Spotify...");
  await new Promise((r) => setTimeout(r, 2000)); // brief pause for Spotify to index
  const liveTrackIds = await getPlaylistTracks(playlist.id, token);
  const expectedIds = foundTracks.map((t) => t.id);
  const missing = expectedIds.filter((id) => !liveTrackIds.includes(id));
  const extra = liveTrackIds.filter((id) => !expectedIds.includes(id));
  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ Playlist verified: all ${expectedIds.length} tracks present on Spotify`);
  } else {
    if (missing.length > 0) {
      console.error(`✗ Missing ${missing.length} track(s) from Spotify playlist:`);
      missing.forEach((id) => {
        const t = foundTracks.find((t) => t.id === id);
        console.error(`  - ${t ? `${t.artist} — ${t.name}` : id}`);
      });
    }
    if (extra.length > 0) {
      console.warn(`⚠ ${extra.length} unexpected track(s) in Spotify playlist (not in expected list)`);
    }
  }
  console.log(`\nExpected tracks (${foundTracks.length}):`);
  foundTracks.forEach((t, i) => console.log(`  ${i + 1}. ${t.artist} — ${t.name}`));
}

preview().catch((err) => {
  console.error("Preview error:", err);
  process.exit(1);
});
