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
import { generatePlaylist } from "./claude.js";
import { sendEmail } from "./email.js";

async function run() {
  console.log("Starting Monday Music...");

  // Auth
  const token = await getAccessToken();
  console.log("Spotify token obtained");

  // Gather listening data in parallel
  const [recentTracks, topTracks, recentPlaylists, userId] = await Promise.all([
    getRecentlyPlayed(token),
    getTopTracks(token),
    getRecentPlaylists(token),
    getUserId(token),
  ]);
  console.log(`Got ${recentTracks.length} recent tracks, ${topTracks.length} top tracks`);

  // Ask Claude to plan the playlist
  const recentPlaylistNames = recentPlaylists.map((p) => p.name);
  console.log("Generating playlist plan with Claude...");
  const plan = await generatePlaylist(recentTracks, topTracks, recentPlaylistNames);
  console.log(`Theme: ${plan.theme} | Playlist: "${plan.name}" | ${plan.tracks.length} tracks suggested`);

  // Search Spotify for each suggested track
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

  // Create playlist and add tracks
  const playlist = await createPlaylist(userId, plan.name, plan.description, token);
  await addTracksToPlaylist(playlist.id, foundTracks.map((t) => t.id), token);
  console.log(`Playlist created: ${playlist.url}`);

  // Send email
  await sendEmail(plan.name, plan.description, playlist.url, foundTracks);

  console.log("Done!");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
