import {
  getAccessToken,
  getRecentlyPlayed,
  getTopTracks,
  getRecentPlaylists,
  searchTrack,
  getUserId,
  createPlaylist,
  addTracksToPlaylist,
  type Track,
} from "./spotify.js";
import { generatePlaylist, curateNewReleases } from "./claude.js";
import { sendEmail } from "./email.js";
import { fetchNewReleases } from "./newReleases.js";

async function run() {
  console.log("Starting Monday Music...");

  const token = await getAccessToken();
  console.log("Spotify token obtained");

  // Fetch Spotify data + RSS feeds in parallel
  const [userId, recentTracks, topTracks, recentPlaylists, rawReleases] = await Promise.all([
    getUserId(token),
    getRecentlyPlayed(token),
    getTopTracks(token),
    getRecentPlaylists(token),
    fetchNewReleases().then((r) => { console.log(`Fetched ${r.length} new releases from RSS`); return r; }),
  ]);
  console.log(`Got ${recentTracks.length} recent tracks, ${topTracks.length} top tracks`);

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))];
  const topArtists = [...new Set(topTracks.map((t) => t.artist))];
  const recentPlaylistNames = recentPlaylists.map((p) => p.name);

  // Ask Claude for playlist plan + new release curation in parallel
  console.log("Asking Claude for playlist + new release curation...");
  const [plan, curatedReleases] = await Promise.all([
    generatePlaylist(recentTracks, topTracks, recentPlaylistNames),
    curateNewReleases(rawReleases, recentArtists, topArtists),
  ]);
  console.log(`Playlist: "${plan.name}" (${plan.theme}) | ${plan.tracks.length} tracks suggested`);
  console.log(`New releases curated: ${curatedReleases.length}`);

  // Search Spotify for each track
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

  // Create playlist
  const playlist = await createPlaylist(userId, plan.name, plan.description, token);
  await addTracksToPlaylist(playlist.id, foundTracks.map((t) => t.id), token);
  console.log(`Playlist created: ${playlist.url}`);

  // Send email
  await sendEmail(plan.name, plan.description, playlist.url, foundTracks, curatedReleases);

  console.log("Done!");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
